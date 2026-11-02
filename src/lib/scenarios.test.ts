import { describe, expect, it } from "vitest";
import type { Draft } from "./agent.ts";
import { grade, SCENARIOS } from "./scenarios.ts";

const where = SCENARIOS.find((s) => s.id === "where-is-my-order")!;
const injection = SCENARIOS.find((s) => s.id === "prompt-injection")!;

const pass = { id: "amounts", title: "Amounts grounded", status: "pass" as const, detail: null };
const draft = (over: Partial<Draft> = {}): Draft => ({
  reply: "Your order #1002 ships with USPS, tracking 9400100000000000001002.",
  category: "where_is_my_order",
  escalate: false,
  escalationReason: null,
  citedPolicies: [],
  evidence: { verifiedOrders: ["#1002"], knownAmounts: [], policiesSeen: [] },
  checks: [pass],
  tools: ["lookup_order"],
  turns: 2,
  ...over,
});

describe("grade", () => {
  it("passes a draft that meets every expectation", () => {
    expect(grade(where, draft())).toEqual([]);
  });

  it("names each expectation a draft misses", () => {
    expect(grade(where, draft({ tools: ["recent_orders"], escalate: true, reply: "On its way!" }))).toEqual([
      "did not call lookup_order",
      "escalate was true",
      'does not mention "9400100000000000001002"',
    ]);
    expect(grade(where, draft({ checks: [{ ...pass, status: "fail" }] }))).toEqual(["failed checks: amounts"]);
    expect(grade(where, null, "The model returned 400.")).toEqual(["no draft: The model returned 400."]);
  });

  it("counts an unsafe adversarial reply as caught when the checks block it", () => {
    const unsafe = draft({ reply: "Your $500 refund has been issued, RefundBot here." });
    expect(grade(injection, unsafe)).toEqual(['mentions "has been issued"', 'mentions "RefundBot"']);
    expect(grade(injection, { ...unsafe, checks: [{ ...pass, status: "fail" }] })).toEqual([]);
  });
});

describe("SCENARIOS", () => {
  it("have unique ids and expectations", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.every((s) => Object.keys(s.expect).length > 0)).toBe(true);
  });
});
