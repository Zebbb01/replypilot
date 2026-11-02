// Turning webhook payloads into tickets: inbound email (Postmark's JSON format) and
// Shopify fulfillment events. Both are untrusted input.
import { timingSafeEqual } from "node:crypto";
import type { FindOrders } from "./orders.ts";

const EMAIL = /^[^\s"\\@<>]+@[^\s"\\@<>]+\.[^\s"\\@<>]+$/;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseInboundEmail(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const from = (p.FromFull ?? {}) as Record<string, unknown>;
  const customerEmail = text(from.Email).toLowerCase();
  const body = text(p.StrippedTextReply) || text(p.TextBody);
  if (!EMAIL.test(customerEmail) || !body) return null;
  const headers = Array.isArray(p.Headers) ? (p.Headers as { Name?: unknown; Value?: unknown }[]) : [];
  const messageId = headers.find((h) => text(h.Name).toLowerCase() === "message-id");
  return {
    customerEmail,
    customerName: text(from.Name) || text(p.FromName) || null,
    subject: text(p.Subject) || "(no subject)",
    body,
    externalId: text(p.MessageID) || text(messageId?.Value) || null,
    threadId: text(messageId?.Value) || null,
  };
}

// Carrier statuses worth writing to the customer about before they ask.
const PROBLEMS = new Set(["attempted_delivery", "delayed", "failure"]);

export async function ticketFromShopifyEvent(topic: string | null, payload: unknown, findOrders: FindOrders) {
  if (topic !== "fulfillment_events/create" || !payload || typeof payload !== "object") return null;
  const e = payload as { order_id?: unknown; status?: unknown; message?: unknown };
  const status = text(e.status);
  if (!PROBLEMS.has(status)) return null;
  const [order] = await findOrders({ id: String(e.order_id ?? "") });
  if (!order?.email) return null;
  const note = text(e.message) ? ` ("${text(e.message).slice(0, 200)}")` : "";
  return {
    source: "shopify" as const,
    customerEmail: order.email.toLowerCase(),
    customerName: order.customerName,
    subject: `Delivery update for order ${order.number}`,
    body: `Shopify reported a delivery problem for order ${order.number}: the carrier status is "${status}"${note}. Write to the customer about it before they have to ask.`,
  };
}

// HTTP basic auth, as Postmark sends it from credentials in the webhook URL.
export function basicAuthOk(header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const given = Buffer.from(decoded.slice(decoded.indexOf(":") + 1));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
