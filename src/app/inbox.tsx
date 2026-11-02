"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { SCENARIOS } from "@/lib/scenarios.ts";
import type { Status } from "@/lib/tickets.ts";
import { PersonPill, StatusPill, WORKING, buttonClass, card, focusRing, inputClass, usd, when } from "./ui";

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
type List = { model: string; tickets: Row[] };

const SOURCE: Record<Row["source"], string> = { demo: "Demo email", email: "Email", shopify: "Shopify event" };
const DEMOS = SCENARIOS.filter((s) => s.demo);

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: res.status === 204 ? {} : await res.json().catch(() => ({})) };
}

export function Inbox({ view }: { view: "demo" | "live" }) {
  const router = useRouter();
  const [list, setList] = useState<List | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "signin">("loading");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const timer = setInterval(() => setVersion((v) => v + 1), 2500);
    return () => clearInterval(timer);
  }, [working]);

  async function create(body: unknown) {
    setBusy(true);
    setError(null);
    const { ok, data } = await post("/api/tickets", body).catch(() => ({ ok: false, data: { error: "The demo could not be reached." } }));
    if (ok) router.push(`/tickets/${data.id}`);
    else {
      setError(data.error ?? "That did not work.");
      setBusy(false);
    }
  }

  function custom(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void create(Object.fromEntries(f.entries()));
  }

  if (state === "signin") return <SignIn onDone={() => setVersion((v) => v + 1)} />;

  const drafted = list?.tickets.filter((t) => t.costUsd > 0) ?? [];
  const average = drafted.length ? drafted.reduce((sum, t) => sum + t.costUsd, 0) / drafted.length : null;

  return (
    <div className="mt-8 space-y-8">
      {view === "demo" ? (
        <section aria-labelledby="try" className={card}>
          <h2 id="try" className="font-semibold">
            Send the store a customer email
          </h2>
          <p className="mt-1 text-sm text-muted">Each sample comes from a made-up customer with a made-up order.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {DEMOS.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy}
                onClick={() => create({ scenario: s.id })}
                className={`rounded-lg border border-line px-3 py-2.5 text-left hover:border-brand disabled:opacity-50 ${focusRing}`}
              >
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{s.body}</span>
              </button>
            ))}
          </div>
          <details className="mt-4">
            <summary className={`cursor-pointer rounded text-sm font-medium text-brand ${focusRing}`}>Write your own</summary>
            <form onSubmit={custom} className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Customer email
                <input name="customerEmail" type="email" required defaultValue="alex.kim@example.com" className={`mt-1 ${inputClass}`} />
              </label>
              <label className="text-sm">
                Name <span className="text-muted">(optional)</span>
                <input name="customerName" defaultValue="Alex Kim" className={`mt-1 ${inputClass}`} />
              </label>
              <label className="text-sm sm:col-span-2">
                Subject
                <input name="subject" required maxLength={200} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="text-sm sm:col-span-2">
                Message
                <textarea name="body" required maxLength={2000} rows={4} className={`mt-1 ${inputClass}`} />
              </label>
              <p className="text-xs text-muted sm:col-span-2">
                Orders #1001 to #1006 exist. Their customers&apos; emails are in{" "}
                <a className="underline" href="https://github.com/Zebbb01/replypilot/blob/main/samples/orders.json">
                  samples/orders.json
                </a>
                ; write from another address to see the agent refuse to share order details.
              </p>
              <div className="sm:col-span-2">
                <button type="submit" disabled={busy} className={buttonClass.primary}>
                  Send to the agent
                </button>
              </div>
            </form>
          </details>
          {error && (
            <p role="alert" className="mt-3 text-sm text-fail">
              {error}
            </p>
          )}
        </section>
      ) : (
        <LiveSetup onSignOut={() => setVersion((v) => v + 1)} />
      )}

      <section aria-labelledby="tickets">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="tickets" className="font-semibold">
            {view === "demo" ? "Your tickets" : "Live tickets"}
          </h2>
          {list && average !== null && (
            <p className="text-xs text-muted" data-testid="average-cost">
              Average {usd(average)} per ticket at {list.model} list prices; $0 on the free tier
            </p>
          )}
        </div>
        {state === "loading" && <p className="mt-3 text-sm text-muted">Loading tickets…</p>}
        {state === "error" && (
          <p className="mt-3 text-sm text-fail">
            The tickets could not be loaded.{" "}
            <button type="button" className={`underline ${focusRing}`} onClick={() => setVersion((v) => v + 1)}>
              Try again
            </button>
          </p>
        )}
        {state === "ready" && list?.tickets.length === 0 && (
          <p className="mt-3 text-sm text-muted">
            {view === "demo" ? "No tickets yet. Send one of the sample emails above." : "No live tickets yet. Email the inbound address or trigger a Shopify event."}
          </p>
        )}
        {state === "ready" && !!list?.tickets.length && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Received</th>
                </tr>
              </thead>
              <tbody>
                {list.tickets.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="block">{t.customer}</span>
                      <span className="text-xs text-muted">{SOURCE[t.source]}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/tickets/${t.id}`} className={`rounded font-medium text-brand hover:underline ${focusRing}`}>
                        {t.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1.5">
                        <StatusPill status={t.status} />
                        {t.escalate && t.status === "needs_approval" && <PersonPill />}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{usd(t.costUsd)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted tabular-nums">{when.format(new Date(t.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { ok, data } = await post("/api/session", { key: new FormData(e.currentTarget).get("key") });
    if (ok) onDone();
    else setError(data.error ?? "That did not work.");
  }
  return (
    <form onSubmit={submit} className={`mt-8 max-w-md ${card}`}>
      <h2 className="font-semibold">Operator sign-in</h2>
      <p className="mt-1 text-sm text-muted">
        The live inbox holds real emails and sends real replies, so it needs the operator key. The demo inbox is open to
        everyone.
      </p>
      <label className="mt-4 block text-sm">
        Operator key
        <input name="key" type="password" required autoComplete="current-password" className={`mt-1 ${inputClass}`} />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-fail">
          {error}
        </p>
      )}
      <button type="submit" className={`mt-4 ${buttonClass.primary}`}>
        Sign in
      </button>
    </form>
  );
}

function LiveSetup({ onSignOut }: { onSignOut: () => void }) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    onSignOut();
  }
  return (
    <section aria-labelledby="setup" className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="setup" className="font-semibold">
          Where live tickets come from
        </h2>
        <button type="button" onClick={signOut} className={buttonClass.secondary}>
          Sign out
        </button>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Inbound email (Postmark, basic auth)</dt>
          <dd className="mt-0.5 font-mono text-xs break-all">{origin}/api/webhooks/email</dd>
        </div>
        <div>
          <dt className="text-muted">Shopify webhook (fulfillment_events/create)</dt>
          <dd className="mt-0.5 font-mono text-xs break-all">{origin}/api/webhooks/shopify</dd>
        </div>
      </dl>
    </section>
  );
}
