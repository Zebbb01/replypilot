// A rule-based stand-in for the model, speaking the OpenAI chat-completions format
// with tool calls. It lets the app and the end-to-end tests run without a model.
// A customer message containing "[flaky]" gets one 429 first, to show retries.
import { createServer, type ServerResponse } from "node:http";

type Msg = { role: string; content: string | null };
type Order = { number: string; fulfillmentStatus: string; shipments: { status: string; carrier: string | null; trackingNumber: string | null }[] };
type Result = { found?: boolean; verified?: boolean; order?: Order; orders?: Order[]; policies?: { id: string; title: string; body: string }[] };

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const call = (name: string, args: object, i: number) => ({ id: `call_${name}_${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } });

function lookups(customer: string) {
  const number = customer.match(/#?(\d{4})\b/)?.[1];
  const calls = [number ? call("lookup_order", { order_number: `#${number}` }, 1) : call("recent_orders", {}, 1)];
  if (/return|refund|damag|crack|broken|cancel|late|delay|ship|warrant/i.test(customer)) calls.push(call("search_policies", { query: customer.slice(0, 200) }, 2));
  return calls;
}

function draft(ticket: string, customer: string, results: Result[]) {
  const name = ticket.match(/^From: (.+?) </m)?.[1]?.split(" ")[0] ?? "there";
  const lookup = results.find((r) => "found" in r || "orders" in r);
  const order = lookup?.verified ? lookup.order : lookup?.orders?.[0];
  const policy = results.flatMap((r) => r.policies ?? [])[0];
  const escalate = /chargeback|lawyer|legal|dispute/i.test(customer);
  const lines = [`Hi ${name},`, "Thanks for getting in touch."];
  if (lookup?.found && !lookup.verified) {
    lines.push("For your privacy we can only discuss an order with the email address used at checkout, so please write to us from that address.");
  } else if (order) {
    const s = order.shipments[0];
    const state = (s?.status ?? order.fulfillmentStatus).replaceAll("_", " ").toLowerCase();
    lines.push(`Your order ${order.number} is ${state}${s?.trackingNumber ? ` (${s.carrier} tracking ${s.trackingNumber})` : ""}.`);
  }
  if (policy) lines.push(`Our ${policy.title.toLowerCase()} policy says: ${policy.body.split(". ")[0]}.`);
  if (escalate) lines.push("I have passed this to a team lead, who will reply within 1 business day.");
  lines.push("Kettle & Pine Support");
  const category = /crack|broken|damag/i.test(customer)
    ? "damaged_item"
    : /cancel/i.test(customer)
      ? "cancel_change"
      : /return|refund/i.test(customer)
        ? "return_refund"
        : order || lookup
          ? "where_is_my_order"
          : "other";
  return call(
    "submit_draft",
    {
      reply: lines.join("\n\n"),
      category,
      escalate,
      escalation_reason: escalate ? "The customer threatens a chargeback." : "",
      cited_policies: policy ? [policy.id] : [],
    },
    9,
  );
}

export function createMockLlm() {
  const flaky = new Set<string>();
  const server = createServer(async (req, res) => {
    if (req.url === "/health") return json(res, 200, { ok: true });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { messages } = JSON.parse(raw) as { messages: Msg[] };
    const ticket = messages.filter((m) => m.role === "user")[0]?.content ?? "";
    const customer = ticket.split("<<<")[1]?.split(">>>")[0] ?? ticket;
    if (customer.includes("[flaky]") && !flaky.has(ticket)) {
      flaky.add(ticket);
      return json(res, 429, { error: { message: "Rate limit (mock)" } }, { "retry-after": "1" });
    }
    const results = messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content ?? "{}") as Result);
    const tool_calls = results.length ? [draft(ticket, customer, results)] : lookups(customer);
    json(res, 200, {
      choices: [{ message: { role: "assistant", content: null, tool_calls } }],
      usage: { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: 40 * tool_calls.length },
    });
  });
  return { server };
}
