"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Draft } from "@/lib/agent.ts";
import { canApprove, checkReply, type Check } from "@/lib/checks.ts";
import type { ToolCall } from "@/lib/llm.ts";
import type { Status } from "@/lib/tickets.ts";
import { PersonPill, StatusPill, WORKING, buttonClass, card, focusRing, inputClass, usd, when } from "../../ui";

type View = {
  ticket: {
    id: string;
    source: "demo" | "email" | "shopify";
    customerEmail: string;
    customerName: string | null;
    subject: string;
    body: string;
    status: Status;
    run: number;
    note: string | null;
    draft: Draft | null;
    reply: string | null;
    error: string | null;
    createdAt: string;
    live: boolean;
  };
  events: { at: string; actor: string; type: string; data: Record<string, unknown> }[];
  steps: { run: number; name: string; output: unknown; tokensIn: number; tokensOut: number; costUsd: number; ms: number }[];
  cost: { usd: number; tokensIn: number; tokensOut: number; llmCalls: number };
};

const LOOK: Record<Check["status"], { word: string; mark: string; tone: string }> = {
  pass: { word: "Passed", mark: "✓", tone: "text-pass" },
  fail: { word: "Blocks sending", mark: "✕", tone: "text-fail" },
  warn: { word: "Check", mark: "!", tone: "text-warn" },
};

const num = new Intl.NumberFormat("en");
const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function eventText(e: View["events"][number]): string {
  const d = e.data;
  switch (e.type) {
    case "ticket.received":
      return `Ticket received (${d.source === "shopify" ? "Shopify event" : d.source === "email" ? "inbound email" : "demo email"})`;
    case "draft.started":
      return `Agent started drafting (run ${d.run})`;
    case "job.retry":
      return `Attempt ${d.attempt} of the ${d.kind} step failed: ${d.error} Retrying in ${Math.round(Number(d.retryInMs) / 1000)} s.`;
    case "job.failed":
      return `The ${d.kind} step gave up after attempt ${d.attempt}: ${d.error}`;
    case "draft.ready": {
      const failed = (d.failedChecks as string[] | undefined)?.length ?? 0;
      return `Draft ready in ${d.turns} model calls${failed ? `, ${failed} check${failed > 1 ? "s" : ""} failing` : ""}${d.escalate ? ", flagged for a person" : ""}`;
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

function traceOf(steps: View["steps"]): Trace[] {
  const calls = new Map<string, ToolCall>();
  return steps.map((s) => {
    if (s.name.startsWith("llm-")) {
      const tc = ((s.output as { message?: { tool_calls?: ToolCall[] } })?.message?.tool_calls ?? []) as ToolCall[];
      tc.forEach((c) => calls.set(c.id, c));
      return {
        key: s.name,
        title: `Model call ${s.name.slice(4)}`,
        detail: tc.length ? `Asked for ${tc.map((c) => c.function.name).join(", ")}` : "No tool call",
        meta: `${num.format(s.tokensIn)} in · ${num.format(s.tokensOut)} out · ${usd(s.costUsd)} · ${(s.ms / 1000).toFixed(1)} s`,
      };
    }
    if (s.name === "send") return { key: s.name, title: "Send", detail: (s.output as { transport?: string })?.transport === "smtp" ? "Emailed over SMTP." : "Written to the outbox.", meta: null };
    const c = calls.get(s.name.split("-").slice(2).join("-"));
    const args = c?.function.arguments && c.function.arguments !== "{}" ? ` ${c.function.arguments}` : "";
    return { key: s.name, title: `${c?.function.name ?? "Tool"}${args}`, detail: summarize(c?.function.name ?? "", s.output), meta: `${s.ms} ms` };
  });
}

export function TicketView() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [version, setVersion] = useState(0);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/tickets/${id}`, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setMissing(true);
        if (res.ok) setView(await res.json());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, version]);

  const t = view?.ticket;
  // Fills the editor once per draft, so polling never overwrites a person's edit.
  if (t?.draft && t.status === "needs_approval" && loaded !== t.run) {
    setLoaded(t.run);
    setText(t.draft.reply);
  }

  const working = t && WORKING.includes(t.status);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setVersion((v) => v + 1), 2000);
    return () => clearInterval(timer);
  }, [working]);

  async function act(body: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tickets/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) setError((await res?.json().catch(() => null))?.error ?? "That did not work. Try again.");
    else setNote("");
    setBusy(false);
    setVersion((v) => v + 1);
  }

  if (missing)
    return (
      <p className="text-sm">
        Ticket not found.{" "}
        <Link href="/" className="text-brand underline">
          Back to the inbox
        </Link>
      </p>
    );
  if (!view || !t) return <p className="text-sm text-muted">Loading the ticket…</p>;

  const draft = t.draft;
  const checks = draft ? checkReply(text, draft, draft.evidence) : [];
  const reviewing = t.status === "needs_approval" && draft;
  const trace = traceOf(view.steps);

  return (
    <div className="space-y-6">
      <div>
        <Link href={t.live ? "/live" : "/"} className={`rounded text-sm text-muted hover:text-ink ${focusRing}`}>
          ← {t.live ? "Live inbox" : "Demo inbox"}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.subject}</h1>
          <StatusPill status={t.status} testId="ticket-status" />
          {draft?.escalate && t.status === "needs_approval" && <PersonPill />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section aria-labelledby="message" className={card}>
            <h2 id="message" className="text-sm font-semibold">
              {t.source === "shopify" ? "Shopify event" : "Customer message"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t.customerName ? `${t.customerName} <${t.customerEmail}>` : t.customerEmail} · {when.format(new Date(t.createdAt))}
            </p>
            <p className="mt-3 max-w-[70ch] text-sm leading-relaxed whitespace-pre-wrap">{t.body}</p>
          </section>

          <section aria-labelledby="reply" className={card}>
            <h2 id="reply" className="text-sm font-semibold">
              {t.status === "sent" ? "Reply sent" : "Draft reply"}
            </h2>

            {(t.status === "queued" || t.status === "drafting") && (
              <p className="mt-3 text-sm text-muted" role="status">
                The agent is looking up the order and the store policies…
              </p>
            )}

            {t.status === "failed" && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-fail" role="alert">
                  {t.error ?? "This ticket failed."}
                </p>
                <button type="button" disabled={busy} onClick={() => act({ action: "retry" })} className={buttonClass.primary}>
                  Run again
                </button>
              </div>
            )}

            {reviewing && (
              <>
                {draft.escalate && (
                  <p className="mt-3 rounded-lg border border-warn/50 px-3 py-2 text-sm text-warn">
                    The agent asks for a person: {draft.escalationReason ?? "no reason given"}
                  </p>
                )}
                <label htmlFor="reply-text" className="sr-only">
                  Reply
                </label>
                <textarea
                  id="reply-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  className={`mt-3 font-sans leading-relaxed ${inputClass}`}
                />
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2" aria-label="Checks">
                  {checks.map((c) => (
                    <li key={c.id} className="flex gap-2 text-sm">
                      <span aria-hidden="true" className={`w-4 shrink-0 text-center font-semibold ${LOOK[c.status].tone}`}>
                        {LOOK[c.status].mark}
                      </span>
                      <span>
                        <span className="font-medium">{c.title}</span> <span className={LOOK[c.status].tone}>{LOOK[c.status].word}</span>
                        {c.detail && <span className="block text-xs text-muted">{c.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !canApprove(checks) || !text.trim()}
                    onClick={() => act({ action: "approve", reply: text })}
                    className={buttonClass.primary}
                  >
                    {t.live ? "Approve and email" : "Approve and send"}
                  </button>
                </div>
                <div className="mt-5 border-t border-line pt-4">
                  <label htmlFor="note" className="text-sm font-medium">
                    Note for the agent, or why you reject it <span className="font-normal text-muted">(optional)</span>
                  </label>
                  <input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`mt-1 ${inputClass}`} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => act({ action: "regenerate", note })} className={buttonClass.secondary}>
                      Draft again
                    </button>
                    <button type="button" disabled={busy} onClick={() => act({ action: "reject", reason: note })} className={buttonClass.secondary}>
                      Reject
                    </button>
                  </div>
                </div>
              </>
            )}

            {(t.status === "approved" || t.status === "sent") && (
              <p className="mt-3 max-w-[70ch] text-sm leading-relaxed whitespace-pre-wrap" data-testid="final-reply">
                {t.reply}
              </p>
            )}
            {t.status === "rejected" && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-muted">Rejected. Nothing was sent.</p>
                <button type="button" disabled={busy} onClick={() => act({ action: "regenerate", note })} className={buttonClass.secondary}>
                  Draft again
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-fail">
                {error}
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="cost" className={card}>
            <h2 id="cost" className="text-sm font-semibold">
              Cost of this ticket
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Model calls</dt>
              <dd className="text-right tabular-nums">{view.cost.llmCalls}</dd>
              <dt className="text-muted">Tokens in / out</dt>
              <dd className="text-right tabular-nums">
                {num.format(view.cost.tokensIn)} / {num.format(view.cost.tokensOut)}
              </dd>
              <dt className="text-muted">At list price</dt>
              <dd className="text-right font-medium tabular-nums" data-testid="ticket-cost">
                {usd(view.cost.usd)}
              </dd>
            </dl>
            <p className="mt-2 text-xs text-muted">Actual cost is $0: the model runs on GitHub Models&apos; free tier.</p>
          </section>

          <section aria-labelledby="trace" className={card}>
            <h2 id="trace" className="text-sm font-semibold">
              Agent trace {t.run > 1 && <span className="font-normal text-muted">(run {t.run})</span>}
            </h2>
            {trace.length ? (
              <ol className="mt-3 space-y-3">
                {trace.map((s) => (
                  <li key={s.key} className="text-sm">
                    <span className="block font-mono text-xs break-all">{s.title}</span>
                    {s.detail && <span className="block text-muted">{s.detail}</span>}
                    {s.meta && <span className="block text-xs text-muted tabular-nums">{s.meta}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-muted">No steps yet.</p>
            )}
          </section>

          <section aria-labelledby="audit" className={card}>
            <h2 id="audit" className="text-sm font-semibold">
              Audit log
            </h2>
            <ol className="mt-3 space-y-2" data-testid="audit-log">
              {view.events.map((e, i) => (
                <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm">
                  <time className="text-xs text-muted tabular-nums" dateTime={e.at}>
                    {time.format(new Date(e.at))}
                  </time>
                  <span>
                    {eventText(e)} <span className="text-xs text-muted">· {e.actor}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
