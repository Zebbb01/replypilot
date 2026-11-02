import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { setupDb } from "../test/db.ts";
import { take } from "./db.ts";
import { backoffMs, claim, complete, dbSteps, enqueue, retryLater } from "./jobs.ts";

const db = setupDb();

async function ticket() {
  const id = randomUUID();
  await db().query(
    `insert into tickets (id, workspace, source, customer_email, subject, body) values ($1, 'w', 'demo', 'a@example.com', 's', 'b')`,
    [id],
  );
  return id;
}

// Moves a job's schedule into the past, as if time had passed.
const due = (id: string) => db().query(`update jobs set run_at = now() - interval '1 second' where id = $1`, [id]);

describe("job queue", () => {
  it("hands a due job to one worker at a time", async () => {
    const t = await ticket();
    await enqueue(db(), t, "draft");

    const job = await claim(db());
    expect(job).toMatchObject({ ticketId: t, kind: "draft", attempts: 1 });
    expect(await claim(db())).toBeNull();

    await complete(db(), job!.id);
    expect(await claim(db())).toBeNull();
  });

  it("gives a job back after its lock expires, counting the attempt", async () => {
    const t = await ticket();
    await enqueue(db(), t, "send");
    const job = (await claim(db()))!;
    await db().query(`update jobs set locked_until = now() - interval '1 second' where id = $1`, [job.id]);

    expect(await claim(db())).toMatchObject({ id: job.id, attempts: 2 });
    await complete(db(), job.id);
  });

  it("schedules a retry later and stops after the last attempt", async () => {
    const t = await ticket();
    await enqueue(db(), t, "draft");

    for (let attempt = 1; attempt <= 4; attempt++) {
      const job = (await claim(db()))!;
      expect(job.attempts).toBe(attempt);
      expect(await retryLater(db(), job, "boom", 30_000)).toBe(true);
      expect(await claim(db())).toBeNull(); // not due yet
      await due(job.id);
    }
    const last = (await claim(db()))!;
    expect(last.attempts).toBe(5);
    expect(await retryLater(db(), last, "boom", 30_000)).toBe(false);
    await due(last.id);
    expect(await claim(db())).toBeNull();
    const { rows } = await db().query(`select last_error, done_at from jobs where id = $1`, [last.id]);
    expect(rows[0].last_error).toBe("boom");
    expect(rows[0].done_at).not.toBeNull();
  });
});

describe("backoffMs", () => {
  it("doubles from 5 seconds, honors Retry-After and caps at a minute", () => {
    expect([1, 2, 3, 4].map((a) => backoffMs(a))).toEqual([5000, 10000, 20000, 40000]);
    expect(backoffMs(1, 12_000)).toBe(12_000);
    expect(backoffMs(9)).toBe(60_000);
  });
});

describe("dbSteps", () => {
  it("runs a step once and replays its stored result, with token cost", async () => {
    const t = await ticket();
    const step = dbSteps(db(), t, 1, "gemini-3.5-flash-lite");
    const work = vi.fn(async () => ({ answer: 42, usage: { tokensIn: 1000, tokensOut: 100 } }));

    expect(await step("llm-1", work, (r) => r.usage)).toEqual({ answer: 42, usage: { tokensIn: 1000, tokensOut: 100 } });
    expect(await step("llm-1", work, (r) => r.usage)).toEqual({ answer: 42, usage: { tokensIn: 1000, tokensOut: 100 } });
    expect(work).toHaveBeenCalledTimes(1);

    const { rows } = await db().query(`select tokens_in, tokens_out, cost_usd from steps where ticket_id = $1`, [t]);
    expect(rows).toEqual([{ tokens_in: 1000, tokens_out: 100, cost_usd: expect.closeTo(0.00055, 8) }]);
  });

  it("does not store a failed step, so the next run tries it again", async () => {
    const t = await ticket();
    const step = dbSteps(db(), t, 1, "m");
    await expect(step("tool-1-a", async () => Promise.reject(new Error("timeout")))).rejects.toThrow("timeout");
    expect(await step("tool-1-a", async () => "ok")).toBe("ok");
  });

  it("keeps runs apart", async () => {
    const t = await ticket();
    await dbSteps(db(), t, 1, "m")("llm-1", async () => "first");
    expect(await dbSteps(db(), t, 2, "m")("llm-1", async () => "second")).toBe("second");
  });
});

describe("take", () => {
  it("counts up to the limit and refuses beyond it", async () => {
    const key = `k-${randomUUID()}`;
    expect(await take(db(), key, 2)).toBe(true);
    expect(await take(db(), key, 2)).toBe(true);
    expect(await take(db(), key, 2)).toBe(false);
  });
});
