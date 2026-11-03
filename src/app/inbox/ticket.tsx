"use client";

// One ticket: the customer's message, the agent's draft in a reply box with its
// checks, and the decision. Polls while the agent or the sender is working.
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Draft } from "@/lib/agent.ts";
import { canApprove, checkReply, type Check } from "@/lib/checks.ts";
import type { Status } from "@/lib/tickets.ts";
import { toast } from "../toast";
import { Avatar, Badge, Button, Dialog, Field, Icon, Skeleton, Spinner, StatusBadge, WORKING, focusRing, fullTime, inputClass } from "../ui";
import { postJson, ticketsChanged } from "./events";
import { TicketRail, verifiedOrder, type AuditEvent, type Cost, type Step } from "./rail";

type Ticket = {
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
type Data = { ticket: Ticket; events: AuditEvent[]; steps: Step[]; cost: Cost };
type Action = "approve" | "reject" | "regenerate" | "retry";

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const back = usePathname().startsWith("/live") ? "/live" : "/";
  const [data, setData] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);
  const [version, setVersion] = useState(0);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState<number | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"reject" | "redraft" | "send" | null>(null);
  const [note, setNote] = useState("");
  const lastStatus = useRef<Status | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/tickets/${id}`, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setMissing(true);
        if (!res.ok) return;
        const next = (await res.json()) as Data;
        if (lastStatus.current && lastStatus.current !== next.ticket.status) ticketsChanged();
        lastStatus.current = next.ticket.status;
        setData(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, version]);

  const t = data?.ticket;
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

  async function act(body: { action: Action } & Record<string, string>, done: string) {
    setBusy(body.action);
    const { ok, data: res } = await postJson(`/api/tickets/${id}`, body);
    setBusy(null);
    if (!ok) {
      setError(String(res.error ?? "That did not work. Try again."));
      return;
    }
    setError(null);
    setDialog(null);
    setNote("");
    toast(done, "pass");
    setVersion((v) => v + 1);
    ticketsChanged();
  }

  if (missing) {
    return (
      <div className="m-auto p-6 text-center text-sm">
        <p className="font-medium text-ink">Ticket not found.</p>
        <p className="mt-1 text-muted">It may belong to another browser, or demo tickets are deleted after 7 days.</p>
        <Link href={back} className={`mt-3 inline-block rounded-sm text-brand hover:underline ${focusRing}`}>
          Back to the inbox
        </Link>
      </div>
    );
  }
  if (!data || !t) return <DetailSkeleton />;

  const draft = t.draft;
  const checks = draft ? checkReply(text, draft, draft.evidence) : null;
  const reviewing = t.status === "needs_approval" && draft && checks;
  const name = t.customerName ?? t.customerEmail;
  const sent = data.events.findLast((e) => e.type === "reply.sent");

  function approve() {
    if (t?.live) return setDialog("send");
    void act({ action: "approve", reply: text }, "Reply approved and saved to the outbox");
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3">
        <Link href={back} className={`mb-1 inline-flex items-center gap-1 rounded-sm text-sm text-muted hover:text-ink lg:hidden ${focusRing}`}>
          <Icon name="back" size={14} />
          Inbox
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{t.subject}</h1>
          <StatusBadge status={t.status} testId="ticket-status" />
          {draft?.escalate && t.status === "needs_approval" && <Badge tone="warn">Needs a person</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {t.source === "shopify" ? "Shopify event" : t.source === "email" ? "Email" : "Demo email"} · {name} · {fullTime.format(new Date(t.createdAt))}
        </p>
      </div>

      <div className="grid flex-1 gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-4">
          <article className="rounded-lg border border-line bg-surface">
            <header className="flex items-center gap-3 border-b border-line px-3 py-2">
              {t.source === "shopify" ? (
                <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-subtle text-ink-2 ring-1 ring-line">
                  <Icon name="bag" size={15} />
                </span>
              ) : (
                <Avatar name={name} />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.source === "shopify" ? "Shopify event" : name}</p>
                <p className="truncate text-xs text-muted">{t.source === "shopify" ? `For ${name} · ${t.customerEmail}` : t.customerEmail}</p>
              </div>
            </header>
            <p className="max-w-[72ch] px-3 py-3 leading-relaxed whitespace-pre-wrap">{t.body}</p>
          </article>

          {draft?.escalate && t.status === "needs_approval" && (
            <p className="flex gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              <Icon name="alert" size={15} className="mt-0.5" />
              <span>
                <span className="font-medium">Needs a person:</span> {draft.escalationReason ?? "the agent gave no reason."}
              </span>
            </p>
          )}

          {(t.status === "queued" || t.status === "drafting") && <Drafting steps={data.steps} events={data.events} />}

          {t.status === "failed" && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-fail-soft px-3 py-2.5 text-sm text-fail">
              <Icon name="alert" size={15} />
              <span className="min-w-0 flex-1">{t.error ?? "This ticket failed."}</span>
              <Button size="sm" loading={busy === "retry"} onClick={() => act({ action: "retry" }, "Running again")}>
                Run again
              </Button>
            </div>
          )}

          {reviewing && (
            <section aria-labelledby="reply-heading" className="rounded-lg border border-line bg-surface focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                <h2 id="reply-heading" className="truncate text-sm font-medium">
                  Reply to {name}
                </h2>
                <span className="shrink-0 text-xs text-muted">Draft {t.run} · by the agent</span>
              </div>
              <textarea
                aria-label="Reply"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="block min-h-48 w-full resize-y bg-transparent px-3 py-3 text-lg leading-relaxed text-ink [field-sizing:content] focus:outline-none sm:text-base"
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
                <CheckSummary checks={checks} />
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setDialog("redraft")}>
                    <Icon name="redo" size={14} />
                    Redraft
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDialog("reject")}>
                    Reject
                  </Button>
                  <Button size="sm" variant="primary" disabled={!canApprove(checks) || !text.trim()} loading={busy === "approve"} onClick={approve}>
                    <Icon name="send" size={14} />
                    {t.live ? "Approve and email" : "Approve and send"}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {(t.status === "approved" || t.status === "sent") && (
            <article className="rounded-lg border border-line bg-surface">
              <header className="flex items-center gap-3 border-b border-line px-3 py-2">
                <Avatar name="Kettle Pine" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Kettle &amp; Pine Support</p>
                  <p className="text-xs text-muted">To {t.customerEmail}</p>
                </div>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                  {t.status === "approved" ? (
                    <>
                      <Spinner /> Sending
                    </>
                  ) : sent?.data.transport === "smtp" ? (
                    <>
                      <Icon name="check" size={14} className="text-pass" /> Emailed
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={14} className="text-pass" /> In the outbox, not emailed
                    </>
                  )}
                </span>
              </header>
              <p data-testid="final-reply" className="max-w-[72ch] px-3 py-3 leading-relaxed whitespace-pre-wrap">
                {t.reply}
              </p>
            </article>
          )}

          {t.status === "rejected" && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-subtle px-3 py-2.5 text-sm text-ink-2">
              <span className="flex-1">Rejected. Nothing was sent.</span>
              <Button size="sm" onClick={() => setDialog("redraft")}>
                <Icon name="redo" size={14} />
                Redraft
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-fail">
              {error}
            </p>
          )}
        </div>

        <aside aria-label="Ticket details" className="min-w-0 xl:border-l xl:border-line xl:pl-6">
          <TicketRail steps={data.steps} events={data.events} cost={data.cost} checks={reviewing ? checks : null} run={t.run} />
        </aside>
      </div>

      <Dialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title="Reject this draft?"
        description="Nothing is sent. You can ask for a new draft afterwards."
        footer={
          <>
            <Button autoFocus onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy === "reject"} onClick={() => act({ action: "reject", reason: note }, "Draft rejected")}>
              Reject draft
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="optional, kept in the audit log" htmlFor="reject-reason">
          <textarea id="reject-reason" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass} />
        </Field>
      </Dialog>

      <Dialog
        open={dialog === "redraft"}
        onClose={() => setDialog(null)}
        title="Ask for a new draft"
        description="The agent starts again with your note."
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" loading={busy === "regenerate"} onClick={() => act({ action: "regenerate", note }, "Redrafting")}>
              Redraft
            </Button>
          </>
        }
      >
        <Field label="What should change?" hint="optional" htmlFor="redraft-note">
          <textarea
            id="redraft-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Offer express shipping on the replacement"
            className={inputClass}
          />
        </Field>
      </Dialog>

      <Dialog
        open={dialog === "send"}
        onClose={() => setDialog(null)}
        title="Email this reply?"
        description={
          <>
            It goes to <span className="font-medium text-ink">{t.customerEmail}</span> and cannot be unsent.
          </>
        }
        footer={
          <>
            <Button autoFocus onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === "approve"} onClick={() => act({ action: "approve", reply: text }, "Reply approved and sending")}>
              <Icon name="send" size={14} />
              Send email
            </Button>
          </>
        }
      />
    </div>
  );
}

function CheckSummary({ checks }: { checks: Check[] }) {
  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  if (failed.length) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-fail">
        <Icon name="x" size={14} />
        <span className="truncate">
          {failed.length === 1 ? "1 check blocks sending" : `${failed.length} checks block sending`}: {failed[0].detail}
        </span>
      </p>
    );
  }
  return (
    <p className={`flex items-center gap-1.5 text-xs ${warned.length ? "text-warn" : "text-pass"}`}>
      <Icon name={warned.length ? "alert" : "check"} size={14} />
      {warned.length ? `${warned.length} to look at, nothing blocking` : `All ${checks.length} checks pass`}
    </p>
  );
}

// What the agent has done so far, from the steps stored for this run.
function Drafting({ steps, events }: { steps: Step[]; events: AuditEvent[] }) {
  const done = steps
    .filter((s) => s.name.startsWith("tool-"))
    .map((s) => {
      const o = (s.output ?? {}) as { policies?: unknown[]; orders?: unknown[]; found?: boolean };
      if (o.policies) return "Searched the store policies";
      if (o.orders) return "Listed the customer's orders";
      return o.found ? "Looked up the order" : "Looked for the order";
    });
  const order = verifiedOrder(steps).order;
  const retry = events.at(-1)?.type === "job.retry" ? events.at(-1) : null;
  return (
    <section role="status" aria-label="Drafting" className="rounded-lg border border-line bg-surface px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Spinner className="text-brand" />
        The agent is drafting a reply
      </p>
      <ol className="mt-2 grid gap-1 text-sm text-ink-2">
        {[...new Set(done)].map((d) => (
          <li key={d} className="flex items-center gap-2">
            <Icon name="check" size={14} className="text-pass" />
            {d}
            {d.startsWith("Looked up") && order ? ` ${order.number}` : ""}
          </li>
        ))}
        {retry && (
          <li className="flex items-center gap-2 text-warn">
            <Icon name="alert" size={14} />
            The model is busy; retrying in {Math.round(Number(retry.data.retryInMs) / 1000)} s
          </li>
        )}
      </ol>
      <div className="mt-3 grid gap-2">
        <Skeleton className="h-2.5 w-11/12" />
        <Skeleton className="h-2.5 w-10/12" />
        <Skeleton className="h-2.5 w-7/12" />
      </div>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-label="Loading the ticket" className="grid gap-4 p-4">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-3 w-1/4" />
      <div className="grid gap-2 rounded-lg border border-line bg-surface p-3">
        <Skeleton className="h-3 w-1/5" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <div className="grid gap-2 rounded-lg border border-line bg-surface p-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
