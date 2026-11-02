import type { Status } from "@/lib/tickets.ts";

export const STATUS_LABEL: Record<Status, string> = {
  queued: "Queued",
  drafting: "Drafting",
  needs_approval: "Needs approval",
  approved: "Sending",
  sent: "Sent",
  rejected: "Rejected",
  failed: "Failed",
};

const STATUS_TONE: Record<Status, string> = {
  queued: "border-line text-muted",
  drafting: "border-line text-muted",
  needs_approval: "border-brand/50 text-brand",
  approved: "border-line text-muted",
  sent: "border-pass/50 text-pass",
  rejected: "border-line text-muted",
  failed: "border-fail/50 text-fail",
};

export const WORKING: Status[] = ["queued", "drafting", "approved"];

const pill = "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium";

export function StatusPill({ status, testId }: { status: Status; testId?: string }) {
  return (
    <span data-testid={testId} className={`${pill} ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PersonPill() {
  return <span className={`${pill} border-warn/50 text-warn`}>Needs a person</span>;
}

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export const buttonClass = {
  primary: `inline-flex min-h-10 items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  secondary: `inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
};
export const focusRing = focus;
export const inputClass = `w-full rounded-lg border border-line bg-surface px-3 py-2 text-base sm:text-sm ${focus}`;
export const card = "rounded-xl border border-line bg-surface p-4 sm:p-5";

export const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(5) : n.toFixed(4)}`;

export const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Logo() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="text-brand">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="m8.5 9.5 2.2 2.2 4.8-4.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
