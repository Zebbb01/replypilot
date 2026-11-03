"use client";

// The ticket's side rail: the order the agent verified, the checks on the reply,
// what it cost, and the history (agent trace and audit log) behind a tab strip.
import { useState, type KeyboardEvent } from "react";
import type { Check } from "@/lib/checks.ts";
import type { ToolCall } from "@/lib/llm.ts";
import type { Order } from "@/lib/orders.ts";
import { Icon, focusRing, timeOfDay, usd } from "../ui";

export type Step = { run: number; name: string; output: unknown; tokensIn: number; tokensOut: number; costUsd: number; ms: number };
export type AuditEvent = { at: string; actor: string; type: string; data: Record<string, unknown> };
export type Cost = { usd: number; tokensIn: number; tokensOut: number; llmCalls: number };

const num = new Intl.NumberFormat("en");
const label = "text-2xs font-semibold tracking-wider text-muted uppercase";

export function eventText(e: AuditEvent): string {
  const d = e.data;
  switch (e.type) {
    case "ticket.received":
      return `Received from ${d.source === "shopify" ? "Shopify" : d.source === "email" ? "inbound email" : "the demo"}`;
    case "draft.started":
      return d.run === 1 ? "Agent started the draft" : `Agent started draft ${d.run}`;
    case "job.retry":
      return `Attempt ${d.attempt} of the ${d.kind} step failed: ${d.error} Retrying in ${Math.round(Number(d.retryInMs) / 1000)} s.`;
    case "job.failed":
      return `The ${d.kind} step gave up after attempt ${d.attempt}: ${d.error}`;
    case "draft.ready": {
      const failed = (d.failedChecks as string[] | undefined)?.length ?? 0;
      return `Draft ready after ${d.turns} model calls${failed ? `, ${failed} check${failed > 1 ? "s" : ""} failing` : ""}${d.escalate ? ", flagged for a person" : ""}`;
    }
    case "reply.edited":
      return "Reply edited before approval";
    case "reply.approved":
      return "Reply approved";
    case "reply.rejected":
      return `Draft rejected${d.reason ? `: ${d.reason}` : ""}`;
    case "draft.requested":
      return `New draft requested${d.note ? `: ${d.note}` : ""}`;
    case "reply.sent":
      return d.transport === "smtp" ? `Emailed to ${d.to}` : "Saved to the outbox (not emailed)";
    case "job.requeued":
      return "Run again from where it stopped";
    default:
      return e.type;
  }
}

// The first order a lookup verified for this sender, from the stored tool results.
export function verifiedOrder(steps: Step[]): { order: Order | null; refused: boolean } {
  let refused = false;
  for (const s of steps) {
    const o = (s.output ?? {}) as { found?: boolean; verified?: boolean; order?: Order; orders?: Order[] };
    if (o.verified && o.order) return { order: o.order, refused };
    if (Array.isArray(o.orders) && o.orders.length) return { order: o.orders[0], refused };
    if (o.found && o.verified === false) refused = true;
  }
  return { order: null, refused };
}

const words = (s: string) => s.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

type Trace = { key: string; title: string; detail: string; meta: string | null };

function summarize(name: string, output: unknown): string {
  const o = (output ?? {}) as { found?: boolean; verified?: boolean; order?: { number: string }; orders?: { number: string }[]; policies?: { title: string }[]; error?: string };
  if (o.error) return o.error;
  if (name === "lookup_order") {
    if (!o.found) return "No such order.";
    return o.verified ? `Order ${o.order?.number}: verified for this customer.` : "The order belongs to another email address. Nothing was shared with the model.";
  }
  if (name === "recent_orders") return o.orders?.length ? `Orders found: ${o.orders.map((x) => x.number).join(", ")}.` : "No orders for this email address.";
  if (name === "search_policies") return o.policies?.length ? `Found: ${o.policies.map((p) => p.title).join(", ")}.` : "No matching policy.";
  return "";
}

export function traceOf(steps: Step[]): Trace[] {
  const calls = new Map<string, ToolCall>();
  return steps.map((s) => {
    if (s.name.startsWith("llm-")) {
      const tc = ((s.output as { message?: { tool_calls?: ToolCall[] } })?.message?.tool_calls ?? []) as ToolCall[];
      tc.forEach((c) => calls.set(c.id, c));
      return {
        key: s.name,
        title: `Model call ${s.name.slice(4)}`,
        detail: tc.length ? `Asked for ${tc.map((c) => c.function.name).join(", ")}` : "Answered without a tool",
        meta: `${num.format(s.tokensIn)} in · ${num.format(s.tokensOut)} out · ${(s.ms / 1000).toFixed(1)} s`,
      };
    }
    if (s.name === "send") {
      return { key: s.name, title: "Send", detail: (s.output as { transport?: string })?.transport === "smtp" ? "Emailed over SMTP." : "Written to the outbox.", meta: null };
    }
    const c = calls.get(s.name.split("-").slice(2).join("-"));
    const args = c?.function.arguments && c.function.arguments !== "{}" ? ` ${c.function.arguments}` : "";
    return { key: s.name, title: `${c?.function.name ?? "Tool"}${args}`, detail: summarize(c?.function.name ?? "", s.output), meta: `${s.ms} ms` };
  });
}

const LOOK: Record<Check["status"], { word: string; icon: "check" | "x" | "alert"; tone: string }> = {
  pass: { word: "Passed", icon: "check", tone: "text-pass" },
  fail: { word: "Blocks sending", icon: "x", tone: "text-fail" },
  warn: { word: "Check", icon: "alert", tone: "text-warn" },
};

export function TicketRail({ steps, events, cost, checks, run }: { steps: Step[]; events: AuditEvent[]; cost: Cost; checks: Check[] | null; run: number }) {
  const [tab, setTab] = useState<"trace" | "activity">("trace");
  const { order, refused } = verifiedOrder(steps);
  const trace = traceOf(steps);
  const tabs = [
    { key: "trace" as const, name: "Trace" },
    { key: "activity" as const, name: "Activity" },
  ];
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tab === "trace" ? "activity" : "trace";
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div className="grid content-start gap-5">
      <section aria-labelledby="order-label">
        <h2 id="order-label" className={label}>
          Order
        </h2>
        {order ? (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Number</dt>
            <dd className="font-medium">{order.number}</dd>
            <dt className="text-muted">Items</dt>
            <dd className="truncate">{order.items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.title}` : i.title)).join(", ")}</dd>
            <dt className="text-muted">Status</dt>
            <dd>{words(order.shipments[0]?.status ?? order.fulfillmentStatus)}</dd>
            {order.shipments[0]?.trackingNumber && (
              <>
                <dt className="text-muted">Tracking</dt>
                <dd className="truncate font-mono text-xs leading-5">
                  {order.shipments[0].carrier} {order.shipments[0].trackingNumber}
                </dd>
              </>
            )}
            <dt className="text-muted">Total</dt>
            <dd className="tabular-nums">${order.total}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {refused ? "The order belongs to another email address, so nothing about it was shared." : "No order looked up yet."}
          </p>
        )}
      </section>

      {checks && (
        <section aria-labelledby="checks-label">
          <h2 id="checks-label" className={label}>
            Checks
          </h2>
          <ul aria-label="Checks" className="mt-2 grid gap-1.5">
            {checks.map((c) => (
              <li key={c.id} className="flex gap-2 text-sm">
                <Icon name={LOOK[c.status].icon} size={14} className={`mt-0.5 ${LOOK[c.status].tone}`} />
                <span className="min-w-0">
                  <span className="text-ink">{c.title}</span>{" "}
                  <span className={`text-xs ${c.status === "pass" ? "sr-only" : LOOK[c.status].tone}`}>{LOOK[c.status].word}</span>
                  {c.detail && <span className="block text-xs text-muted">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="cost-label">
        <h2 id="cost-label" className={label}>
          Cost
        </h2>
        <p className="mt-2 flex items-baseline gap-2 text-sm">
          <span data-testid="ticket-cost" className="text-lg font-semibold tabular-nums">
            {usd(cost.usd)}
          </span>
          <span className="text-muted">at list price</span>
        </p>
        <p className="text-xs text-muted tabular-nums">
          {cost.llmCalls} model calls · {num.format(cost.tokensIn + cost.tokensOut)} tokens · $0 on the free tier
        </p>
      </section>

      <section>
        <div role="tablist" aria-label="History" className="flex gap-4 border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.key}
              id={`tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={onKey}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium ${focusRing} ${tab === t.key ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="panel-trace" aria-labelledby="tab-trace" hidden={tab !== "trace"} className="pt-3">
          {run > 1 && <p className="mb-2 text-xs font-medium text-muted">Run {run}</p>}
          {trace.length ? (
            <ol className="grid gap-3 border-l border-line pl-3">
              {trace.map((s) => (
                <li key={s.key} className="relative text-sm before:absolute before:top-1.5 before:-left-[15px] before:size-1.5 before:rounded-full before:bg-line-strong">
                  <span className="block font-mono text-xs break-words text-ink">{s.title}</span>
                  {s.detail && <span className="block text-ink-2">{s.detail}</span>}
                  {s.meta && <span className="block text-xs text-muted tabular-nums">{s.meta}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No steps yet.</p>
          )}
        </div>

        <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" hidden={tab !== "activity"} className="pt-3">
          <ol className="grid gap-2" data-testid="audit-log">
            {events.map((e, i) => (
              <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm">
                <time className="text-xs leading-5 text-muted tabular-nums" dateTime={e.at}>
                  {timeOfDay.format(new Date(e.at))}
                </time>
                <span className="text-ink-2">
                  {eventText(e)} <span className="text-xs text-muted">· {e.actor}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
