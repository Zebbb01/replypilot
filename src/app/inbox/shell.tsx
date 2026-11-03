"use client";

// The inbox: a ticket list on the left and the open ticket on the right, like any
// mail client. On a phone the list and the ticket take turns.
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import type { Status } from "@/lib/tickets.ts";
import { toast } from "../toast";
import { Avatar, Badge, Button, Dialog, Field, Icon, Segmented, Skeleton, StatusBadge, WORKING, ago, focusRing, inputClass, usd } from "../ui";
import { postJson, ticketsChanged, useTicketsChanged } from "./events";
import { NewEmailDialog } from "./new-email";

type Row = {
  id: string;
  source: "demo" | "email" | "shopify";
  customer: string;
  subject: string;
  status: Status;
  escalate: boolean;
  costUsd: number;
  createdAt: string;
};
type View = "demo" | "live";
type Filter = "all" | "open" | "done";

const OPEN: Status[] = ["queued", "drafting", "needs_approval", "failed"];
export const ticketHref = (view: View, id: string) => (view === "live" ? `/live/tickets/${id}` : `/tickets/${id}`);

export function InboxShell({ view, children }: { view: View; children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  return (
    <div className="flex h-[calc(100dvh-3rem)] overflow-hidden">
      <aside
        aria-label={view === "demo" ? "Demo tickets" : "Live tickets"}
        className={`${id ? "hidden lg:flex" : "flex"} w-full flex-col border-line bg-surface lg:w-85 lg:shrink-0 lg:border-r`}
      >
        <TicketList view={view} selected={id} />
      </aside>
      <main id="main" className={`${id ? "flex" : "hidden lg:flex"} min-w-0 flex-1 flex-col overflow-y-auto`}>
        {children}
      </main>
    </div>
  );
}

function TicketList({ view, selected }: { view: View; selected?: string }) {
  const router = useRouter();
  const [list, setList] = useState<{ model: string; tickets: Row[] } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "signin">("loading");
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useTicketsChanged(refresh);

  useEffect(() => {
    let live = true;
    fetch(`/api/tickets${view === "live" ? "?view=live" : ""}`, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 401) return setState("signin");
        if (!res.ok) return setState("error");
        setList(await res.json());
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [view, version]);

  const working = list?.tickets.some((t) => WORKING.includes(t.status));
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [working, refresh]);

  if (state === "signin") return <SignIn onDone={refresh} />;

  const tickets = list?.tickets ?? [];
  const isOpen = (t: Row) => OPEN.includes(t.status);
  const shown = tickets.filter((t) => filter === "all" || (filter === "open") === isOpen(t));
  const drafted = tickets.filter((t) => t.costUsd > 0);
  const average = drafted.length ? drafted.reduce((sum, t) => sum + t.costUsd, 0) / drafted.length : null;

  return (
    <>
      <div className="border-b border-line px-3 pt-3 pb-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Kettle &amp; Pine</h2>
            <p className="truncate text-xs text-muted">
              {view === "demo" ? "Fictional store" : "Real email and Shopify events"}
              {average !== null && (
                <>
                  {" · avg "}
                  <span data-testid="average-cost" className="tabular-nums">
                    {usd(average)}
                  </span>
                  {" a ticket"}
                </>
              )}
            </p>
          </div>
          {view === "demo" ? (
            <Button variant="primary" size="sm" onClick={() => setComposing(true)}>
              <Icon name="plus" size={14} />
              New email
            </Button>
          ) : (
            <SignOut onDone={refresh} />
          )}
        </div>
        {tickets.length > 0 && (
          <div className="mt-2.5">
            <Segmented
              label="Show tickets"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: tickets.length },
                { value: "open", label: "Open", count: tickets.filter(isOpen).length },
                { value: "done", label: "Done", count: tickets.filter((t) => !isOpen(t)).length },
              ]}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && <ListSkeleton />}
        {state === "error" && (
          <div className="p-4 text-sm">
            <p className="text-ink">The tickets could not be loaded.</p>
            <Button size="sm" className="mt-2" onClick={refresh}>
              Try again
            </Button>
          </div>
        )}
        {state === "ready" && tickets.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Icon name="inbox" size={20} className="mx-auto text-muted" />
            <p className="mt-2 text-sm font-medium">{view === "demo" ? "No tickets yet" : "No live tickets yet"}</p>
            <p className="mt-1 text-xs text-muted">
              {view === "demo" ? "Send the store a sample email to watch the agent work." : "They arrive by email or from Shopify."}
            </p>
          </div>
        )}
        {state === "ready" && tickets.length > 0 && shown.length === 0 && (
          <div className="px-4 py-10 text-center text-sm">
            <p className="text-ink">No {filter === "open" ? "open" : "finished"} tickets.</p>
            <button type="button" onClick={() => setFilter("all")} className={`mt-1 rounded-sm text-brand hover:underline ${focusRing}`}>
              Show all
            </button>
          </div>
        )}
        {state === "ready" && shown.length > 0 && (
          <ul>
            {shown.map((t) => (
              <li key={t.id}>
                <Link
                  href={ticketHref(view, t.id)}
                  aria-current={t.id === selected ? "page" : undefined}
                  className={`flex gap-3 border-b border-line px-3 py-2.5 ${focusRing} focus-visible:-outline-offset-2 ${
                    t.id === selected ? "bg-selected shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-subtle"
                  }`}
                >
                  <Avatar name={t.customer} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-ink">{t.customer}</span>
                      <Time date={t.createdAt} />
                    </div>
                    <p className="truncate text-sm text-ink-2">{t.subject}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <StatusBadge status={t.status} />
                      {t.escalate && t.status === "needs_approval" && <Badge tone="warn">Needs a person</Badge>}
                      <span className="ml-auto flex items-center gap-1 text-xs text-muted tabular-nums">
                        <Icon name={t.source === "shopify" ? "bag" : "mail"} size={12} />
                        {usd(t.costUsd)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="border-t border-line px-3 py-2 text-2xs text-muted">
        {view === "demo" ? "Made-up customers. Demo replies stay in an outbox." : "Approved replies here are emailed to customers."}
      </p>

      {view === "demo" && (
        <NewEmailDialog
          open={composing}
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            ticketsChanged();
            router.push(ticketHref("demo", id));
          }}
        />
      )}
    </>
  );
}

// Relative time, rendered only in the browser so it never mismatches the server.
function Time({ date }: { date: string }) {
  const now = useSyncExternalStore(
    () => () => {},
    () => Math.floor(Date.now() / 60_000),
    () => 0,
  );
  return (
    <time dateTime={date} className="ml-auto shrink-0 text-xs text-muted tabular-nums">
      {now ? ago(date, now * 60_000) : ""}
    </time>
  );
}

function ListSkeleton() {
  return (
    <ul aria-label="Loading tickets">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex gap-3 border-b border-line px-3 py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const { ok, data } = await postJson("/api/session", { key: new FormData(e.currentTarget).get("key") });
    setBusy(false);
    if (!ok) return setError(String(data.error ?? "That did not work. Try again."));
    toast("Signed in to the live inbox", "pass");
    onDone();
  }
  return (
    <form onSubmit={submit} className="p-4">
      <h1 className="text-lg font-semibold">Live inbox</h1>
      <p className="mt-1 text-sm text-muted">It holds real customer email, so it needs the operator key.</p>
      <div className="mt-4">
        <Field label="Operator key" htmlFor="operator-key">
          <input id="operator-key" name="key" type="password" required autoComplete="current-password" className={inputClass} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-fail">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={busy} className="mt-3 w-full">
        Sign in
      </Button>
    </form>
  );
}

function SignOut({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await fetch("/api/session", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setOpen(false);
    toast("Signed out");
    router.push("/live");
    onDone();
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Icon name="logout" size={14} />
        Sign out
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Sign out of the live inbox?"
        description="You will need the operator key to see live tickets again."
        footer={
          <>
            <Button autoFocus onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={signOut}>
              Sign out
            </Button>
          </>
        }
      />
    </>
  );
}

// What the right pane shows before a ticket is picked.
export function NoTicket({ view }: { view: View }) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  if (view === "live") {
    return (
      <div className="m-auto w-full max-w-md p-6">
        <h1 className="text-lg font-semibold">Where live tickets come from</h1>
        <dl className="mt-4 grid gap-4 text-sm">
          {[
            ["Inbound email", "Postmark inbound webhook, HTTP basic auth", "/api/webhooks/email"],
            ["Shopify", "fulfillment_events/create webhook, HMAC-signed", "/api/webhooks/shopify"],
          ].map(([name, how, path]) => (
            <div key={path}>
              <dt className="font-medium text-ink">{name}</dt>
              <dd className="text-xs text-muted">{how}</dd>
              <dd className="mt-1 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs break-all text-ink-2">
                {origin}
                {path}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="m-auto max-w-sm p-6 text-center">
      <Icon name="mail" size={24} className="mx-auto text-muted" />
      <h1 className="mt-3 text-lg font-semibold">Pick a ticket to review</h1>
      <p className="mt-1 text-sm text-muted">Or send the store an email and watch the agent look up the order and draft a reply.</p>
      <Button variant="primary" className="mt-4" onClick={() => setComposing(true)}>
        <Icon name="plus" size={14} />
        New email
      </Button>
      <NewEmailDialog
        open={composing}
        onClose={() => setComposing(false)}
        onCreated={(id) => {
          setComposing(false);
          ticketsChanged();
          router.push(ticketHref("demo", id));
        }}
      />
    </div>
  );
}
