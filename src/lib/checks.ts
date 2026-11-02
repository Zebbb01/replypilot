// Code checks on every draft, run again whenever a person edits it. Nothing the
// model writes is trusted unchecked: a failed check blocks approval.
// Pure functions, so the review screen runs the same checks as the reviewer types.
export const CATEGORIES = ["where_is_my_order", "return_refund", "damaged_item", "cancel_change", "product_question", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Check = { id: string; title: string; status: "pass" | "warn" | "fail"; detail: string | null };

// What the tools returned during the run: the only facts a reply may state.
export type Evidence = { verifiedOrders: string[]; knownAmounts: string[]; policiesSeen: string[] };
export type DraftFacts = { category: Category; escalate: boolean; escalationReason: string | null; citedPolicies: string[] };

const NEEDS_POLICY: Category[] = ["return_refund", "damaged_item", "cancel_change"];

const cents = (amount: string) => {
  const [whole, dec = "0"] = amount.replace(/,/g, "").split(".");
  return Number(whole) * 100 + Number(dec.padEnd(2, "0").slice(0, 2));
};
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const unique = <T,>(xs: T[]) => [...new Set(xs)];

export function checkReply(reply: string, facts: DraftFacts, evidence: Evidence): Check[] {
  const check = (id: string, title: string, problem: string | null, level: "warn" | "fail" = "fail"): Check => ({
    id,
    title,
    status: problem ? level : "pass",
    detail: problem,
  });

  const placeholder = reply.match(/\[[^\]\n]{1,40}\]|\{\{[^}]*\}\}|<insert[^>]*>|\bXXX\b|lorem ipsum/i)?.[0];

  const verified = new Set(evidence.verifiedOrders.map((n) => n.replace(/\D/g, "")));
  const named = unique([...reply.matchAll(/#(\d{3,10})\b|\border\s+(?:number\s+|no\.?\s*)?(\d{3,10})\b/gi)].map((m) => m[1] ?? m[2]));
  const strangers = named.filter((n) => !verified.has(n));

  const known = new Set(evidence.knownAmounts.map(cents));
  const amounts = unique([...reply.matchAll(/(?:US\$|\$|USD\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/gi)].map((m) => cents(`${m[1]}.${m[2] ?? "00"}`)));
  const ungrounded = amounts.filter((c) => !known.has(c));

  const unseen = facts.citedPolicies.filter((id) => !evidence.policiesSeen.includes(id));
  const words = reply.trim().split(/\s+/).filter(Boolean).length;

  return [
    check("placeholders", "No placeholders", placeholder ? `Contains "${placeholder}".` : null),
    check(
      "orders",
      "Orders verified",
      strangers.length ? `Mentions order ${strangers.map((n) => `#${n}`).join(", ")}, which was not verified for this customer.` : null,
    ),
    check(
      "amounts",
      "Amounts grounded",
      ungrounded.length ? `Mentions ${ungrounded.map(dollars).join(", ")}, which is not in the order data.` : null,
    ),
    unseen.length
      ? check("citations", "Policy cited", `Cites ${unseen.join(", ")}, which the agent never looked up.`)
      : check(
          "citations",
          "Policy cited",
          NEEDS_POLICY.includes(facts.category) && !facts.citedPolicies.length ? "No store policy is cited for this kind of request." : null,
          "warn",
        ),
    check("length", "Length", words < 12 ? `Only ${words} words.` : words > 220 ? `${words} words; aim for under 200.` : null, "warn"),
    check("escalation", "Escalation", facts.escalate ? (facts.escalationReason ?? "The agent asks for a person.") : null, "warn"),
  ];
}

export const canApprove = (checks: Check[]) => !checks.some((c) => c.status === "fail");
