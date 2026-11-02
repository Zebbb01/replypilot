import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { setupDb } from "../test/db.ts";
import { LlmError, type AssistantMessage, type Message } from "./llm.ts";
import { outbox, type Mail } from "./mail.ts";
import { fixtureOrders, type Order } from "./orders.ts";
import { parsePolicies, searchPolicies } from "./policies.ts";
import { approve, createTicket, regenerate, reject, retry, runNextJob, ticketView, type WorkerDeps } from "./tickets.ts";

const db = setupDb();
const orders = JSON.parse(readFileSync("samples/orders.json", "utf8")) as Order[];
const policies = parsePolicies(readFileSync("policies/store-policies.md", "utf8"));

const reply =
  "Hi Alex, your order #1002 (Conical Burr Grinder) is on its way with USPS, tracking 9400100000000000001002. Standard shipping takes 3 to 7 business days. Kettle & Pine Support";
const lookup: AssistantMessage = {
  role: "assistant",
  content: null,
  tool_calls: [{ id: "a", type: "function", function: { name: "lookup_order", arguments: '{"order_number":"#1002"}' } }],
};
const submit: AssistantMessage = {
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id: "s",
      type: "function",
      function: {
        name: "submit_draft",
        arguments: JSON.stringify({ reply, category: "where_is_my_order", escalate: false, escalation_reason: "", cited_policies: [] }),
      },
    },
  ],
};

// The model answers lookup, then submit; `fail` queues errors to throw first.
function setup(fail: Error[] = []) {
  const seen: Message[][] = [];
  const llm = vi.fn(async (messages: Message[]) => {
    seen.push(structuredClone(messages));
    const error = fail.shift();
    if (error) throw error;
    return { message: messages.some((m) => m.role === "tool") ? submit : lookup, usage: { tokensIn: 1000, tokensOut: 50 } };
  });
  const send = vi.fn(async (_workspace: string, mail: Mail) => outbox(mail));
  const deps: WorkerDeps = {
    llm,
    findOrders: () => fixtureOrders(orders),
    searchPolicies: (q) => searchPolicies(policies, q),
    send,
    store: "Kettle & Pine",
    model: "gemini-3.5-flash-lite",
    dailyDraftCap: 100,
  };
  return { deps, llm, send, seen };
}

let n = 0;
const newTicket = (over: Partial<Parameters<typeof createTicket>[1]> = {}) =>
  createTicket(db(), {
    workspace: "ws-1",
    source: "email",
    externalId: `msg-${++n}`,
    customerEmail: "alex.kim@example.com",
    customerName: "Alex Kim",
    subject: "Where is my grinder?",
    body: "Hi, where is order #1002?",
    threadId: `<msg-${n}@mail.example>`,
    ...over,
  });

const status = async (id: string) => (await db().query(`select status, error from tickets where id = $1`, [id])).rows[0];
const types = async (id: string) => (await ticketView(db(), id))!.events.map((e) => e.type);
const due = () => db().query(`update jobs set run_at = now() - interval '1 second' where done_at is null`);
const drain = async (deps: WorkerDeps) => {
  while (await runNextJob(db(), deps));
};

describe("createTicket", () => {
  it("queues a draft and ignores a redelivered message", async () => {
    const first = await newTicket({ externalId: "same" });
    const again = await newTicket({ externalId: "same" });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    const { rows } = await db().query(`select count(*)::int n from jobs where ticket_id = $1`, [first.id]);
    expect(rows[0].n).toBe(1);
    expect(await types(first.id)).toEqual(["ticket.received"]);
  });
});

describe("runNextJob", () => {
  it("drafts a reply, waits for approval and records the cost", async () => {
    const { deps } = setup();
    const { id } = await newTicket();
    await drain(deps);

    const view = (await ticketView(db(), id))!;
    expect(view.ticket.status).toBe("needs_approval");
    expect(view.ticket.draft).toMatchObject({ reply, evidence: { verifiedOrders: ["#1002"] } });
    expect(view.cost).toMatchObject({ llmCalls: 2, tokensIn: 2000, tokensOut: 100 });
    expect(view.cost.usd).toBeCloseTo(0.00085, 8);
    expect(view.steps.map((s) => s.name)).toEqual(["llm-1", "tool-1-a", "llm-2"]);
    expect(await types(id)).toEqual(["ticket.received", "draft.started", "draft.ready"]);
  });

  it("retries a failed model call and resumes without repeating finished steps", async () => {
    const { deps, llm } = setup([new LlmError("The model returned 503.", true)]);
    const { id } = await newTicket();

    expect(await runNextJob(db(), deps)).toBe(true);
    expect(await status(id)).toMatchObject({ status: "drafting" });
    expect(await runNextJob(db(), deps)).toBe(false); // the retry is not due yet
    await due();
    await drain(deps);

    expect(await status(id)).toMatchObject({ status: "needs_approval" });
    expect(llm).toHaveBeenCalledTimes(3);
    const view = (await ticketView(db(), id))!;
    expect(view.events.find((e) => e.type === "job.retry")?.data).toMatchObject({ attempt: 1, error: "The model returned 503." });
  });

  it("fails at once when retrying cannot help", async () => {
    const { deps } = setup([new LlmError("The free model allowance is used up for now. Try again later.", false)]);
    const { id } = await newTicket();
    await drain(deps);
    expect(await status(id)).toEqual({ status: "failed", error: "The free model allowance is used up for now. Try again later." });
    expect(await types(id)).toContain("job.failed");
  });

  it("gives up after five attempts", async () => {
    const { deps } = setup(Array.from({ length: 5 }, () => new Error("socket hang up")));
    const { id } = await newTicket();
    for (let i = 0; i < 5; i++) {
      await drain(deps);
      await due();
    }
    expect(await status(id)).toMatchObject({ status: "failed" });
    expect((await types(id)).filter((t) => t === "job.retry")).toHaveLength(4);
  });

  it("stops drafting once the daily allowance is used", async () => {
    const { deps, llm } = setup();
    const { id } = await newTicket();
    await drain({ ...deps, dailyDraftCap: 0 });
    expect(await status(id)).toMatchObject({ status: "failed", error: expect.stringMatching(/allowance/) });
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("review", () => {
  async function drafted() {
    await drain(setup().deps); // jobs left over from earlier tests
    const s = setup();
    const { id } = await newTicket();
    await drain(s.deps);
    return { ...s, id };
  }

  it("sends an approved reply once, threaded to the customer's email", async () => {
    const { deps, send, id } = await drafted();
    await approve(db(), id, `${reply} `, "operator");
    await drain(deps);

    expect(await status(id)).toMatchObject({ status: "sent" });
    expect(send).toHaveBeenCalledWith("ws-1", {
      to: "alex.kim@example.com",
      subject: "Re: Where is my grinder?",
      text: reply,
      inReplyTo: expect.stringMatching(/^<msg-\d+@mail\.example>$/),
    });

    // A duplicate send job (say, after a crash) replays the stored send step.
    await db().query(`insert into jobs (ticket_id, kind) values ($1, 'send')`, [id]);
    await drain(deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await types(id)).toEqual(["ticket.received", "draft.started", "draft.ready", "reply.approved", "reply.sent"]);
  });

  it("records a person's edit and refuses an edit that fails a check", async () => {
    const { id } = await drafted();
    await expect(approve(db(), id, `${reply} We have refunded $500 to your card.`, "operator")).rejects.toThrow(/\$500\.00/);
    expect(await status(id)).toMatchObject({ status: "needs_approval" });

    await approve(db(), id, reply.replace("Hi Alex", "Hello Alex"), "operator");
    const view = (await ticketView(db(), id))!;
    expect(view.ticket.reply).toMatch(/^Hello Alex/);
    expect(view.events.slice(-2).map((e) => e.type)).toEqual(["reply.edited", "reply.approved"]);
  });

  it("rejects a draft without sending anything", async () => {
    const { deps, send, id } = await drafted();
    await reject(db(), id, "Wrong tone", "operator");
    await drain(deps);
    expect(await status(id)).toMatchObject({ status: "rejected" });
    expect(send).not.toHaveBeenCalled();
    await expect(approve(db(), id, reply, "operator")).rejects.toThrow(/waiting for approval/);
  });

  it("drafts again with the reviewer's note as a new run", async () => {
    const { deps, seen, id } = await drafted();
    await regenerate(db(), id, "Mention the 3 to 7 day window.", "operator");
    await drain(deps);

    const view = (await ticketView(db(), id))!;
    expect(view.ticket).toMatchObject({ status: "needs_approval", run: 2 });
    expect(JSON.stringify(seen.at(-2))).toContain("Mention the 3 to 7 day window.");
    expect(view.steps.every((s) => s.run === 2)).toBe(true);
    expect(view.cost.llmCalls).toBe(4);
  });

  it("runs a failed ticket again from where it stopped", async () => {
    const { deps, llm } = setup([new LlmError("bad request", false)]);
    const { id } = await newTicket();
    await drain(deps);
    expect(await status(id)).toMatchObject({ status: "failed" });

    await retry(db(), id, "operator");
    await drain(deps);
    expect(await status(id)).toMatchObject({ status: "needs_approval", error: null });
    expect(llm).toHaveBeenCalledTimes(3);
  });
});

describe("audit log", () => {
  it("cannot be edited", async () => {
    const { id } = await newTicket();
    await expect(db().query(`update events set type = 'x' where ticket_id = $1`, [id])).rejects.toThrow(/append-only/);
  });
});
