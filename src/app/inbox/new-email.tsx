"use client";

import { useState, type FormEvent } from "react";
import { SCENARIOS } from "@/lib/scenarios.ts";
import { Avatar, Button, Dialog, Field, Segmented, Spinner, focusRing, inputClass } from "../ui";
import { postJson } from "./events";

const DEMOS = SCENARIOS.filter((s) => s.demo);

// Sends the store a demo email: one of the samples, or the visitor's own.
export function NewEmailDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<"samples" | "custom">("samples");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(body: unknown, key: string) {
    setPending(key);
    setError(null);
    const { ok, data } = await postJson("/api/tickets", body);
    setPending(null);
    if (ok) onCreated(String(data.id));
    else setError(String(data.error ?? "That did not work. Try again."));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void create(Object.fromEntries(new FormData(e.currentTarget).entries()), "custom");
  }

  return (
    <Dialog open={open} onClose={onClose} title="New test email" description="Write to the store as one of its made-up customers." wide>
      <Segmented
        label="Email"
        value={mode}
        onChange={setMode}
        options={[
          { value: "samples", label: "Samples" },
          { value: "custom", label: "Write your own" },
        ]}
      />

      {mode === "samples" ? (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-md border border-line">
          {DEMOS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => create({ scenario: s.id }, s.id)}
                className={`flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-subtle disabled:cursor-wait ${focusRing} focus-visible:-outline-offset-2`}
              >
                <Avatar name={s.from.name ?? s.from.email} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {s.title}
                    {pending === s.id && <Spinner className="text-brand" />}
                  </span>
                  <span className="block truncate text-xs text-muted">{s.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form onSubmit={submit} className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer email" htmlFor="customer-email">
              <input id="customer-email" name="customerEmail" type="email" required defaultValue="alex.kim@example.com" className={inputClass} />
            </Field>
            <Field label="Name" hint="optional" htmlFor="customer-name">
              <input id="customer-name" name="customerName" defaultValue="Alex Kim" className={inputClass} />
            </Field>
          </div>
          <Field label="Subject" htmlFor="subject">
            <input id="subject" name="subject" required maxLength={200} className={inputClass} />
          </Field>
          <Field label="Message" htmlFor="message">
            <textarea id="message" name="body" required maxLength={2000} rows={4} className={inputClass} />
          </Field>
          <p className="text-xs text-muted">
            Orders #1001 to #1006 belong to the sample customers. Use made-up details only: messages go to the Gemini
            API&apos;s free tier.
          </p>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={pending === "custom"} disabled={pending !== null}>
              Send to agent
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-fail">
          {error}
        </p>
      )}
    </Dialog>
  );
}
