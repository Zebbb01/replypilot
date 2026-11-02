// The ticket workflow: intake, the draft and send jobs with retries, and the
// person's review. Every change of state writes an audit event.
import { randomUUID } from "node:crypto";
import { draftReply, type AgentDeps, type Draft, type TicketInput } from "./agent.ts";
import { checkReply } from "./checks.ts";
import { dayKey, take, type Db } from "./db.ts";
import { backoffMs, claim, complete, dbSteps, enqueue, retryLater, type Job } from "./jobs.ts";
import { LlmError } from "./llm.ts";
import type { Mail, Sent } from "./mail.ts";
import type { FindOrders } from "./orders.ts";

export const LIVE = "live";

export type Status = "queued" | "drafting" | "needs_approval" | "approved" | "sent" | "rejected" | "failed";

export type NewTicket = TicketInput & { workspace: string; externalId?: string | null; threadId?: string | null };

export type WorkerDeps = {
  llm: AgentDeps["llm"];
  findOrders: (workspace: string) => FindOrders;
  searchPolicies: AgentDeps["searchPolicies"];
  send: (workspace: string, mail: Mail) => Promise<Sent>;
  store: string;
  model: string;
  dailyDraftCap: number;
};

export class ReviewError extends Error {}

export async function logEvent(db: Db, ticketId: string, actor: string, type: string, data: object = {}) {
  await db.query(`insert into events (ticket_id, actor, type, data) values ($1, $2, $3, $4)`, [ticketId, actor, type, JSON.stringify(data)]);
}

// A redelivered webhook (same source and external ID) returns the existing ticket.
export async function createTicket(db: Db, t: NewTicket): Promise<{ id: string; created: boolean }> {
  const { rows } = await db.query(
    `insert into tickets (id, workspace, source, external_id, customer_email, customer_name, subject, body, thread_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (source, external_id) do nothing
     returning id`,
    [randomUUID(), t.workspace, t.source, t.externalId ?? null, t.customerEmail, t.customerName, t.subject.slice(0, 200), t.body.slice(0, 8000), t.threadId ?? null],
  );
  if (!rows[0]) {
    const existing = await db.query(`select id from tickets where source = $1 and external_id = $2`, [t.source, t.externalId]);
    return { id: existing.rows[0].id, created: false };
  }
  const id = rows[0].id as string;
  await logEvent(db, id, "system", "ticket.received", { source: t.source });
  await enqueue(db, id, "draft");
  return { id, created: true };
}

async function draftJob(db: Db, job: Job, deps: WorkerDeps) {
  const { rows } = await db.query(
    `update tickets set status = 'drafting', updated_at = now() where id = $1 and status in ('queued', 'drafting') returning *`,
    [job.ticketId],
  );
  const t = rows[0];
  if (!t) return; // rejected or redrafted in the meantime
  if (job.attempts === 1) {
    if (!(await take(db, dayKey("drafts", "all"), deps.dailyDraftCap))) {
      throw new LlmError("Today's free model allowance for this demo is used up. Try again tomorrow.", false);
    }
    await logEvent(db, t.id, "system", "draft.started", { run: t.run });
  }
  const draft = await draftReply(
    { source: t.source, customerEmail: t.customer_email, customerName: t.customer_name, subject: t.subject, body: t.body, note: t.note },
    {
      step: dbSteps(db, t.id, t.run, deps.model),
      llm: deps.llm,
      findOrders: deps.findOrders(t.workspace),
      searchPolicies: deps.searchPolicies,
      store: deps.store,
      today: new Date().toISOString().slice(0, 10),
    },
  );
  const saved = await db.query(
    `update tickets set status = 'needs_approval', draft = $2, error = null, updated_at = now() where id = $1 and status = 'drafting' and run = $3`,
    [t.id, JSON.stringify(draft), t.run],
  );
  if (saved.rowCount) {
    await logEvent(db, t.id, "agent", "draft.ready", {
      run: t.run,
      turns: draft.turns,
      escalate: draft.escalate,
      failedChecks: draft.checks.filter((c) => c.status === "fail").map((c) => c.id),
    });
  }
}

const re = (subject: string) => (/^re:/i.test(subject) ? subject : `Re: ${subject}`);

async function sendJob(db: Db, job: Job, deps: WorkerDeps) {
  const { rows } = await db.query(`select * from tickets where id = $1 and status = 'approved'`, [job.ticketId]);
  const t = rows[0];
  if (!t) return; // already sent: a duplicate job does nothing
  // A stored send step means the mail went out before a crash; it is not sent again.
  const sent = await dbSteps(db, t.id, t.run, deps.model)("send", () =>
    deps.send(t.workspace, { to: t.customer_email, subject: re(t.subject), text: t.reply, inReplyTo: t.thread_id }),
  );
  await db.query(`update tickets set status = 'sent', updated_at = now() where id = $1 and status = 'approved'`, [t.id]);
  await logEvent(db, t.id, "system", "reply.sent", { transport: sent.transport, to: sent.to, messageId: sent.messageId });
}

// Runs one due job. Returns false when there was none.
export async function runNextJob(db: Db, deps: WorkerDeps): Promise<boolean> {
  const job = await claim(db);
  if (!job) return false;
  try {
    await (job.kind === "draft" ? draftJob(db, job, deps) : sendJob(db, job, deps));
    await complete(db, job.id);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const retryable = !(e instanceof LlmError) || e.retryable;
    const delay = backoffMs(job.attempts, e instanceof LlmError ? e.retryAfterMs : 0);
    if (retryable && (await retryLater(db, job, error, delay))) {
      await logEvent(db, job.ticketId, "system", "job.retry", { kind: job.kind, attempt: job.attempts, error, retryInMs: delay });
    } else {
      await complete(db, job.id, error);
      await db.query(
        `update tickets set status = 'failed', error = $2, updated_at = now() where id = $1 and status in ('queued', 'drafting', 'approved')`,
        [job.ticketId, error],
      );
      await logEvent(db, job.ticketId, "system", "job.failed", { kind: job.kind, attempt: job.attempts, error });
    }
  }
  return true;
}

async function load(db: Db, id: string) {
  return (await db.query(`select * from tickets where id = $1`, [id])).rows[0];
}

export async function approve(db: Db, id: string, reply: string, actor: string) {
  const t = await load(db, id);
  if (t?.status !== "needs_approval") throw new ReviewError("This ticket is not waiting for approval.");
  const text = reply.trim();
  if (!text) throw new ReviewError("The reply is empty.");
  const draft = t.draft as Draft;
  const failed = checkReply(text, draft, draft.evidence).filter((c) => c.status === "fail");
  if (failed.length) throw new ReviewError(failed.map((c) => c.detail).join(" "));

  const { rowCount } = await db.query(
    `update tickets set status = 'approved', reply = $2, updated_at = now() where id = $1 and status = 'needs_approval'`,
    [id, text],
  );
  if (!rowCount) throw new ReviewError("This ticket is not waiting for approval.");
  if (text !== draft.reply.trim()) await logEvent(db, id, actor, "reply.edited", { before: draft.reply, after: text });
  await logEvent(db, id, actor, "reply.approved");
  await enqueue(db, id, "send");
}

export async function reject(db: Db, id: string, reason: string, actor: string) {
  const { rowCount } = await db.query(
    `update tickets set status = 'rejected', updated_at = now() where id = $1 and status in ('needs_approval', 'failed')`,
    [id],
  );
  if (!rowCount) throw new ReviewError("Only a draft or a failed ticket can be rejected.");
  await logEvent(db, id, actor, "reply.rejected", { reason: reason.slice(0, 500) });
}

// A new run: earlier steps stay for the cost and audit, but are not replayed.
export async function regenerate(db: Db, id: string, note: string, actor: string) {
  const { rowCount } = await db.query(
    `update tickets set status = 'queued', run = run + 1, note = $2, draft = null, reply = null, error = null, updated_at = now()
     where id = $1 and status in ('needs_approval', 'rejected', 'failed')`,
    [id, note.trim().slice(0, 500) || null],
  );
  if (!rowCount) throw new ReviewError("This ticket is still being worked on.");
  await logEvent(db, id, actor, "draft.requested", { note: note.trim().slice(0, 500) });
  await enqueue(db, id, "draft");
}

// Picks a failed ticket up where it stopped: the same run, so finished steps replay.
export async function retry(db: Db, id: string, actor: string) {
  const { rows } = await db.query(
    `update tickets set status = case when reply is null then 'queued' else 'approved' end, error = null, updated_at = now()
     where id = $1 and status = 'failed' returning status`,
    [id],
  );
  if (!rows[0]) throw new ReviewError("Only a failed ticket can be run again.");
  await logEvent(db, id, actor, "job.requeued");
  await enqueue(db, id, rows[0].status === "approved" ? "send" : "draft");
}

export async function ticketView(db: Db, id: string) {
  const t = await load(db, id);
  if (!t) return null;
  const [events, steps, cost] = await Promise.all([
    db.query(`select at, actor, type, data from events where ticket_id = $1 order by id`, [id]),
    db.query(
      `select run, name, output, tokens_in, tokens_out, cost_usd, ms from steps where ticket_id = $1 and run = $2 order by finished_at, name`,
      [id, t.run],
    ),
    db.query(
      `select coalesce(sum(cost_usd), 0) usd, coalesce(sum(tokens_in), 0)::int tokens_in, coalesce(sum(tokens_out), 0)::int tokens_out,
         (count(*) filter (where name like 'llm-%'))::int llm_calls
       from steps where ticket_id = $1`,
      [id],
    ),
  ]);
  const c = cost.rows[0];
  return {
    ticket: {
      id: t.id as string,
      workspace: t.workspace as string,
      source: t.source as TicketInput["source"],
      customerEmail: t.customer_email as string,
      customerName: t.customer_name as string | null,
      subject: t.subject as string,
      body: t.body as string,
      status: t.status as Status,
      run: t.run as number,
      note: t.note as string | null,
      draft: t.draft as Draft | null,
      reply: t.reply as string | null,
      error: t.error as string | null,
      createdAt: t.created_at as Date,
    },
    events: events.rows as { at: Date; actor: string; type: string; data: Record<string, unknown> }[],
    steps: steps.rows.map((s) => ({ run: s.run as number, name: s.name as string, output: s.output, tokensIn: s.tokens_in, tokensOut: s.tokens_out, costUsd: s.cost_usd, ms: s.ms })),
    cost: { usd: c.usd as number, tokensIn: c.tokens_in as number, tokensOut: c.tokens_out as number, llmCalls: c.llm_calls as number },
  };
}

export async function listTickets(db: Db, workspace: string) {
  const { rows } = await db.query(
    `select t.id, t.source, t.customer_email, t.customer_name, t.subject, t.status, t.created_at,
       (t.draft->>'escalate')::boolean escalate, coalesce(sum(s.cost_usd), 0) cost_usd
     from tickets t left join steps s on s.ticket_id = t.id
     where t.workspace = $1
     group by t.id order by t.created_at desc limit 50`,
    [workspace],
  );
  return rows.map((r) => ({
    id: r.id as string,
    source: r.source as TicketInput["source"],
    customer: (r.customer_name as string | null) ?? (r.customer_email as string),
    subject: r.subject as string,
    status: r.status as Status,
    escalate: Boolean(r.escalate),
    costUsd: r.cost_usd as number,
    createdAt: r.created_at as Date,
  }));
}

// Demo tickets and old counters are removed after 7 days; live tickets stay.
export async function purge(db: Db) {
  await db.query(`delete from tickets where workspace <> $1 and created_at < now() - interval '7 days'`, [LIVE]);
  await db.query(`delete from usage where expires_at < now()`);
}
