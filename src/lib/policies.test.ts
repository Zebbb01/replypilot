import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePolicies, searchPolicies } from "./policies.ts";

const policies = parsePolicies(readFileSync("policies/store-policies.md", "utf8"));

describe("parsePolicies", () => {
  it("makes one section per second-level heading, with a slug id", () => {
    expect(policies.map((p) => p.id)).toContain("damaged-or-wrong-items");
    const returns = policies.find((p) => p.id === "returns")!;
    expect(returns.title).toBe("Returns");
    expect(returns.body).toMatch(/^Unused items/);
    expect(returns.body).not.toContain("## ");
  });

  it("skips the text before the first section", () => {
    expect(policies.some((p) => p.body.includes("fictional online store"))).toBe(false);
  });
});

describe("searchPolicies", () => {
  it("ranks the matching section first and matches word forms", () => {
    expect(searchPolicies(policies, "my mug arrived cracked and damaged")[0].id).toBe("damaged-or-wrong-items");
    expect(searchPolicies(policies, "can I cancel my order?")[0].id).toBe("cancelling-or-changing-an-order");
    expect(searchPolicies(policies, "refunded")[0].id).toBe("refunds");
  });

  it("returns at most three sections", () => {
    expect(searchPolicies(policies, "order refund return shipping damaged warranty").length).toBe(3);
  });

  it("returns nothing for a query with no useful words", () => {
    expect(searchPolicies(policies, "the and of ?!")).toEqual([]);
    expect(searchPolicies(policies, "zebra")).toEqual([]);
  });
});
