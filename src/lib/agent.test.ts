import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { draftReply, memorySteps, type AgentDeps, type TicketInput } from "./agent.ts";
import type { AssistantMessage, Message } from "./llm.ts";
import { fixtureOrders, type Order } from "./orders.ts";
import { parsePolicies, searchPolicies } from "./policies.ts";

const orders = JSON.parse(readFileSync("samples/orders.json", "utf8")) as Order[];
const policies = parsePolicies(readFileSync("policies/store-policies.md", "utf8"));

const call = (id: string, name: string, args: object) => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
const say = (...tool_calls: ReturnType<typeof call>[]): AssistantMessage => ({ role: "assistant", content: null, tool_calls });

const reply =
  "Hi Alex, your order #1002 (Conical Burr Grinder, $149.00) is on its way with USPS, tracking 9400100000000000001002. Standard shipping takes 3 to 7 business days after dispatch. Kettle & Pine Support";
const submit = (overrides: object = {}) =>
  call("s", "submit_draft", { reply, category: "where_is_my_order", escalate: false, escalation_reason: "", cited_policies: ["shipping-times"], ...overrides });

// A scripted model: answers each call with the next message and keeps what it was sent.
function script(...answers: (AssistantMessage | Error)[]) {
  const seen: Message[][] = [];
  const llm = vi.fn(async (messages: Message[]) => {
    seen.push(structuredClone(messages));
    const next = answers.shift();
    if (!next) throw new Error("No more scripted answers.");
    if (next instanceof Error) throw next;
    return { message: next, usage: { tokensIn: 100, tokensOut: 20 } };
  });
  return { llm, seen };
}

const ticket: TicketInput = { source: "demo", customerEmail: "alex.kim@example.com", customerName: "Alex Kim", subject: "Where is my grinder?", body: "Hi, where is order #1002?" };

function deps(llm: AgentDeps["llm"], step = memorySteps().step): AgentDeps {
  return { step, llm, findOrders: vi.fn(fixtureOrders(orders)), searchPolicies: (q) => searchPolicies(policies, q), store: "Kettle & Pine", today: "2026-11-01" };
}

describe("draftReply", () => {
  it("looks the order up, searches the policies and returns a checked draft", async () => {
    const { llm, seen } = script(
      say(call("a", "lookup_order", { order_number: "#1002" }), call("b", "search_policies", { query: "shipping time" })),
      say(submit()),
    );

    const draft = await draftReply(ticket, deps(llm));

    expect(draft).toMatchObject({ reply, category: "where_is_my_order", escalate: false, citedPolicies: ["shipping-times"], turns: 2 });
    expect(draft.tools).toEqual(["lookup_order", "search_policies"]);
    expect(draft.evidence.verifiedOrders).toEqual(["#1002"]);
    expect(draft.evidence.policiesSeen).toContain("shipping-times");
    expect(draft.checks.every((c) => c.status === "pass")).toBe(true);
    const toolMessages = seen[1].filter((m) => m.role === "tool");
    expect(toolMessages[0].content).toContain("9400100000000000001002");
    expect(seen[0][0].content).toContain("2026-11-01");
    expect(seen[0][1].content).toContain("Hi, where is order #1002?");
  });

  it("never shows the model another customer's order", async () => {
    const { llm, seen } = script(say(call("a", "lookup_order", { order_number: "1002" })), say(submit()));

    const draft = await draftReply({ ...ticket, customerEmail: "stranger@example.com" }, deps(llm));

    const result = seen[1].find((m) => m.role === "tool")!.content;
    expect(JSON.parse(result)).toMatchObject({ found: true, verified: false });
    expect(result).not.toMatch(/Alex|Grinder|9400|Austin/);
    expect(draft.evidence.verifiedOrders).toEqual([]);
    expect(draft.checks.find((c) => c.id === "orders")?.status).toBe("fail");
  });

  it("looks up the sender's own orders when no number is given", async () => {
    const { llm, seen } = script(say(call("a", "recent_orders", {})), say(submit()));
    const d = deps(llm);
    await draftReply(ticket, d);
    expect(d.findOrders).toHaveBeenCalledWith({ email: "alex.kim@example.com" });
    expect(JSON.parse(seen[1].at(-1)!.content as string).orders.map((o: Order) => o.number)).toEqual(["#1002", "#1005"]);
  });

  it("replays finished steps instead of calling the model or Shopify again", async () => {
    const { step } = memorySteps();
    const first = script(say(call("a", "lookup_order", { order_number: "#1002" })), say(submit()));
    const draft = await draftReply(ticket, deps(first.llm, step));

    const again = script();
    const d = deps(again.llm, step);
    expect(await draftReply(ticket, d)).toEqual(draft);
    expect(again.llm).not.toHaveBeenCalled();
    expect(d.findOrders).not.toHaveBeenCalled();
  });

  it("resumes after a failed model call from the step that failed", async () => {
    const { step } = memorySteps();
    const first = script(say(call("a", "lookup_order", { order_number: "#1002" })), new Error("503"));
    await expect(draftReply(ticket, deps(first.llm, step))).rejects.toThrow("503");

    const second = script(say(submit()));
    const draft = await draftReply(ticket, deps(second.llm, step));
    expect(second.llm).toHaveBeenCalledTimes(1);
    expect(draft.evidence.verifiedOrders).toEqual(["#1002"]);
  });

  it("asks again when the model answers in plain text instead of calling a tool", async () => {
    const { llm, seen } = script({ role: "assistant", content: "Your grinder is on its way!" }, say(submit()));
    const draft = await draftReply(ticket, deps(llm));
    expect(draft.turns).toBe(2);
    expect(seen[1].at(-1)).toEqual({ role: "user", content: "Finish by calling submit_draft." });
  });

  it("sends an invalid draft back to the model to fix", async () => {
    const { llm, seen } = script(say(submit({ reply: "" })), say(submit()));
    const draft = await draftReply(ticket, deps(llm));
    expect(draft.turns).toBe(2);
    expect(seen[1].at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("reply") });
  });

  it("gives up without retrying when the model never submits a draft", async () => {
    const { llm } = script(...Array.from({ length: 6 }, (_, i) => say(call(`r${i}`, "recent_orders", {}))));
    await expect(draftReply(ticket, deps(llm))).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/did not finish/) });
  });

  it("passes a reviewer's note to the model as its own message", async () => {
    const { llm, seen } = script(say(submit()));
    await draftReply({ ...ticket, note: "Offer express shipping on the replacement." }, deps(llm));
    expect(seen[0].at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("Offer express shipping") });
  });

  it("records each model call's tokens through the step runner", async () => {
    const steps = memorySteps();
    await draftReply(ticket, deps(script(say(call("a", "recent_orders", {})), say(submit())).llm, steps.step));
    expect(steps.usage).toEqual([
      { tokensIn: 100, tokensOut: 20 },
      { tokensIn: 100, tokensOut: 20 },
    ]);
  });
});
