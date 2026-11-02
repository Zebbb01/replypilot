import { dayKey, getDb, take } from "@/lib/db.ts";
import { clientKey, fail } from "@/lib/http.ts";
import { llmOptions } from "@/lib/runtime.ts";
import { SCENARIOS } from "@/lib/scenarios.ts";
import { viewer } from "@/lib/session.ts";
import { createTicket, listTickets, LIVE } from "@/lib/tickets.ts";

const EMAIL = /^[^\s"\\@<>]+@[^\s"\\@<>]+\.[^\s"\\@<>]+$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function GET(req: Request) {
  const v = await viewer();
  const live = new URL(req.url).searchParams.get("view") === "live";
  if (live && !v.operator) return fail(401, "Sign in with the operator key to see the live inbox.");
  return Response.json({ model: llmOptions().model, tickets: await listTickets(await getDb(), live ? LIVE : v.ws) });
}

// A demo ticket: one of the sample emails ({ scenario }) or the visitor's own
// ({ customerEmail, customerName, subject, body }). Replies to these only reach the outbox.
export async function POST(req: Request) {
  const v = await viewer();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail(400, "Send a JSON object.");

  let input;
  if (typeof body.scenario === "string") {
    const s = SCENARIOS.find((x) => x.id === body.scenario && x.demo);
    if (!s) return fail(400, "Unknown sample.");
    input = { customerEmail: s.from.email, customerName: s.from.name, subject: s.subject, body: s.body };
  } else {
    input = {
      customerEmail: text(body.customerEmail, 200).toLowerCase(),
      customerName: text(body.customerName, 100) || null,
      subject: text(body.subject, 200),
      body: text(body.body, 2000),
    };
    if (!EMAIL.test(input.customerEmail)) return fail(400, "Enter the customer's email address.");
    if (!input.subject || !input.body) return fail(400, "Enter a subject and a message.");
  }

  // Each draft spends the shared free model allowance.
  const db = await getDb();
  const allowed =
    (await take(db, dayKey("demo-ws", v.ws), Number(process.env.DAILY_DEMO_PER_WORKSPACE ?? 15))) &&
    (await take(db, dayKey("demo-ip", clientKey(req)), Number(process.env.DAILY_DEMO_PER_ADDRESS ?? 30)));
  if (!allowed) return fail(429, "Today's limit for this free demo is reached. Come back tomorrow.");

  const { id } = await createTicket(db, { ...input, source: "demo", workspace: v.ws });
  return Response.json({ id }, { status: 201 });
}
