import { getDb } from "@/lib/db.ts";
import { fail } from "@/lib/http.ts";
import { basicAuthOk, parseInboundEmail } from "@/lib/intake.ts";
import { createTicket, LIVE } from "@/lib/tickets.ts";

// Inbound email for the live inbox, in Postmark's inbound JSON format. Postmark
// sends the credentials put in the webhook URL as HTTP basic auth.
export async function POST(req: Request) {
  if (!basicAuthOk(req.headers.get("authorization"), process.env.INBOUND_EMAIL_SECRET ?? "")) return fail(401, "Unauthorized.");
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) return fail(413, "Message too large.");
  const email = parseInboundEmail(await req.json().catch(() => null));
  if (!email) return fail(422, "No sender address or message text.");
  const { id, created } = await createTicket(await getDb(), { ...email, source: "email", workspace: LIVE });
  return Response.json({ id, created }, { status: created ? 201 : 200 });
}
