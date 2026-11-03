"use client";

// Transient confirmations of what the person just did. At most three, gone after
// 3.5 s; anything that needs action is shown inline instead.
import { useSyncExternalStore } from "react";
import { Icon } from "./ui";

type Toast = { id: number; text: string; tone: "pass" | "neutral" };

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const NONE: Toast[] = [];
let next = 0;

function emit() {
  for (const l of listeners) l();
}

export function toast(text: string, tone: Toast["tone"] = "neutral") {
  const t = { id: ++next, text, tone };
  toasts = [...toasts, t].slice(-3);
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, 3500);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => NONE,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:top-14 sm:right-4 sm:bottom-auto sm:items-end">
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex animate-slide-in items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink shadow-float"
        >
          {t.tone === "pass" && <Icon name="check" size={14} className="text-pass" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
