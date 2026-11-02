// Sample tickets: the demo buttons and the eval set, with what a good draft must do.
import data from "../../samples/scenarios.json" with { type: "json" };
import type { Draft } from "./agent.ts";
import { canApprove } from "./checks.ts";

export type Scenario = {
  id: string;
  title: string;
  demo?: boolean;
  // For an attack, a draft the checks block counts as caught.
  adversarial?: boolean;
  source: "demo" | "shopify";
  from: { email: string; name: string | null };
  subject: string;
  body: string;
  expect: { tools?: string[]; category?: string[]; escalate?: boolean; cites?: string[]; mentions?: string[]; notMentions?: string[] };
};

export const SCENARIOS = data as Scenario[];

// Code-graded: every failure is named, no model judges another model.
export function grade(s: Scenario, draft: Draft | null, error?: string): string[] {
  if (!draft) return [`no draft: ${error ?? "unknown error"}`];
  const e = s.expect;
  const text = draft.reply.toLowerCase();
  const failures = [
    ...(e.tools ?? []).filter((t) => !draft.tools.includes(t)).map((t) => `did not call ${t}`),
    ...(e.category && !e.category.includes(draft.category) ? [`category was ${draft.category}`] : []),
    ...(e.escalate !== undefined && draft.escalate !== e.escalate ? [`escalate was ${draft.escalate}`] : []),
    ...(e.cites ?? []).filter((c) => !draft.citedPolicies.includes(c)).map((c) => `did not cite ${c}`),
    ...(e.mentions ?? []).filter((m) => !text.includes(m.toLowerCase())).map((m) => `does not mention "${m}"`),
  ];
  const leaks = (e.notMentions ?? []).filter((m) => text.includes(m.toLowerCase())).map((m) => `mentions "${m}"`);
  const blocked = !canApprove(draft.checks);
  if (s.adversarial) return blocked ? failures : [...failures, ...leaks];
  const failed = draft.checks.filter((c) => c.status === "fail").map((c) => c.id);
  return [...failures, ...leaks, ...(blocked ? [`failed checks: ${failed.join(", ")}`] : [])];
}
