import { describe, expect, it } from "vitest";
import { canApprove, checkReply, type DraftFacts, type Evidence } from "./checks.ts";

const evidence: Evidence = { verifiedOrders: ["#1002"], knownAmounts: ["149.00", "0.00"], policiesSeen: ["shipping-times"] };
const facts: DraftFacts = { category: "where_is_my_order", escalate: false, escalationReason: null, citedPolicies: ["shipping-times"] };
const good =
  "Hi Alex, thanks for reaching out. Your order #1002 (the $149.00 Conical Burr Grinder) is on its way with USPS, tracking 9400100000000000001002. Standard shipping takes 3 to 7 business days. Kettle & Pine Support";

const status = (reply: string, f: Partial<DraftFacts> = {}, e: Partial<Evidence> = {}) =>
  Object.fromEntries(checkReply(reply, { ...facts, ...f }, { ...evidence, ...e }).map((c) => [c.id, c.status]));

describe("checkReply", () => {
  it("passes a grounded reply", () => {
    const checks = checkReply(good, facts, evidence);
    expect(checks.every((c) => c.status === "pass")).toBe(true);
    expect(canApprove(checks)).toBe(true);
  });

  it("fails on template placeholders", () => {
    expect(status(good.replace("Alex", "[Customer Name]")).placeholders).toBe("fail");
    expect(status(good + " {{signature}}").placeholders).toBe("fail");
  });

  it("fails when the reply names an order the agent did not verify", () => {
    expect(status(good.replace("#1002", "#1003")).orders).toBe("fail");
    expect(status(good, {}, { verifiedOrders: [] }).orders).toBe("fail");
    expect(status(good.replace("order #1002", "order 1002")).orders).toBe("pass");
    expect(status(good.replace("order #1002", "order 1003")).orders).toBe("fail");
  });

  it("fails on money amounts that are not in the order or policy data", () => {
    const checks = checkReply(`${good} We have refunded $500 to your card.`, facts, evidence);
    expect(checks.find((c) => c.id === "amounts")).toMatchObject({ status: "fail", detail: expect.stringContaining("$500.00") });
    expect(canApprove(checks)).toBe(false);
    expect(status(good.replace("$149.00", "$149")).amounts).toBe("pass");
    expect(status(good.replace("$149.00", "USD 1,490.00")).amounts).toBe("fail");
  });

  it("fails on a cited policy the agent never looked at, and warns when one is missing", () => {
    expect(status(good, { citedPolicies: ["refunds"] }).citations).toBe("fail");
    expect(status(good, { category: "return_refund", citedPolicies: [] }).citations).toBe("warn");
    expect(status(good, { category: "product_question", citedPolicies: [] }).citations).toBe("pass");
  });

  it("warns on a very short or very long reply", () => {
    expect(status("Thanks, on its way.").length).toBe("warn");
    expect(status(`${good} ${"more words ".repeat(120)}`).length).toBe("warn");
  });

  it("flags an escalation for a person without blocking approval", () => {
    const checks = checkReply(good, { ...facts, escalate: true, escalationReason: "Chargeback threat" }, evidence);
    expect(checks.find((c) => c.id === "escalation")).toMatchObject({ status: "warn", detail: "Chargeback threat" });
    expect(canApprove(checks)).toBe(true);
  });
});
