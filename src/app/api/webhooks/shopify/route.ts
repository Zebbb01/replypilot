import { getDb } from "@/lib/db.ts";
import { fail } from "@/lib/http.ts";
import { ticketFromShopifyEvent } from "@/lib/intake.ts";
import { verifyWebhook } from "@/lib/orders.ts";
import { liveOrders } from "@/lib/runtime.ts";
import { createTicket, LIVE } from "@/lib/tickets.ts";

// Shopify webhooks for the live store. The signature is checked over the raw body
// before anything is parsed; redeliveries carry the same webhook ID.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_CLIENT_SECRET ?? "")) {
    return fail(401, "Invalid signature.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(400, "Invalid JSON.");
  }
  const ticket = await ticketFromShopifyEvent(req.headers.get("x-shopify-topic"), payload, liveOrders());
  if (!ticket) return Response.json({ ignored: true }); // a 200, so Shopify does not send it again
  const { id, created } = await createTicket(await getDb(), {
    ...ticket,
    workspace: LIVE,
    externalId: req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id"),
  });
  return Response.json({ id, created }, { status: created ? 201 : 200 });
}
