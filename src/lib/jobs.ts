// Durable execution in PostgreSQL: a job queue (FOR UPDATE SKIP LOCKED) with
// retries and backoff, and step results stored so a retried run resumes.
import type { Step } from "./agent.ts";
import type { Db } from "./db.ts";
import { costUsd } from "./llm.ts";

export type Job = { id: string; ticketId: string; kind: "draft" | "send"; attempts: number; maxAttempts: number };

export async function enqueue(db: Db, ticketId: string, kind: Job["kind"]) {
  await db.query(`insert into jobs (ticket_id, kind) values ($1, $2)`, [ticketId, kind]);
}

// Locks the oldest due job for lockMs. A worker that dies mid-job loses the lock,
// and the job runs again (counted as another attempt).
export async function claim(db: Db, lockMs = 120_000): Promise<Job | null> {
  const { rows } = await db.query(
    `update jobs set attempts = attempts + 1, locked_until = now() + make_interval(secs => $1::double precision / 1000)
     where id = (
       select id from jobs
       where done_at is null and run_at <= now() and (locked_until is null or locked_until < now())
       order by run_at
       for update skip locked
       limit 1
     )
     returning id, ticket_id, kind, attempts, max_attempts`,
    [lockMs],
  );
  const r = rows[0];
  return r ? { id: String(r.id), ticketId: r.ticket_id, kind: r.kind, attempts: r.attempts, maxAttempts: r.max_attempts } : null;
}

export async function complete(db: Db, id: string, error?: string) {
  await db.query(`update jobs set done_at = now(), locked_until = null, last_error = coalesce($2, last_error) where id = $1`, [id, error ?? null]);
}

// Returns false when that was the last attempt; the job is then closed.
export async function retryLater(db: Db, job: Job, error: string, delayMs: number): Promise<boolean> {
  const again = job.attempts < job.maxAttempts;
  await db.query(
    `update jobs set last_error = $2, locked_until = null,
       run_at = case when $3 then now() + make_interval(secs => $4::double precision / 1000) else run_at end,
       done_at = case when $3 then null else now() end
     where id = $1`,
    [job.id, error.slice(0, 500), again, delayMs],
  );
  return again;
}

// 5 s, 10 s, 20 s, 40 s: the five attempts fit in the few minutes a scaled-to-zero
// Container App stays awake after a request.
export const backoffMs = (attempt: number, retryAfterMs = 0) => Math.min(60_000, Math.max(retryAfterMs, 5000 * 2 ** (attempt - 1)));

export function dbSteps(db: Db, ticketId: string, run: number, model: string): Step {
  return async (name, fn, usage) => {
    const { rows } = await db.query(`select output from steps where ticket_id = $1 and run = $2 and name = $3`, [ticketId, run, name]);
    if (rows[0]) return rows[0].output;
    const started = Date.now();
    const value = await fn();
    const u = usage?.(value) ?? { tokensIn: 0, tokensOut: 0 };
    await db.query(
      `insert into steps (ticket_id, run, name, output, tokens_in, tokens_out, cost_usd, ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
      [ticketId, run, name, JSON.stringify(value ?? null), u.tokensIn, u.tokensOut, costUsd(model, u), Date.now() - started],
    );
    return value;
  };
}
