"use client";

// Shared interface parts. Plain React on native elements (<dialog>, <button>), so
// focus handling, Esc and focus return come from the browser.
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Status } from "@/lib/tickets.ts";

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

// ---------------------------------------------------------------- icons

const PATHS: Record<string, ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="m15 18-6-6 6-6" />,
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m21 7-9 6-9-6" />
    </>
  ),
  bag: (
    <>
      <path d="M6 3 3 7v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-3-4Z" />
      <path d="M3 7h18M16 11a4 4 0 0 1-8 0" />
    </>
  ),
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  redo: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  send: <path d="m22 2-7 20-4-9-9-4ZM22 2 11 13" />,
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z" />
    </>
  ),
  github: (
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.5-1-3.5.3-1.2.3-2.4 0-3.5 0 0-1 0-3 1.5-2.6-.5-5.4-.5-8 0C6 2 5 2 5 2c-.3 1.1-.3 2.3 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.4.5-.7 1-.8 1.6-.2.6-.2 1.3-.2 1.9v4M9 18c-4.5 2-5-2-7-2" />
  ),
  shield: <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z" />,
};

export function Icon({ name, size = 16, className = "" }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="text-brand">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5Z" fill="currentColor" />
      <path d="m8.5 9.5 2.2 2.2 4.8-4.7" fill="none" stroke="var(--color-surface)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className={`animate-spin-slow ${className}`}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse-soft rounded-sm bg-subtle ${className}`} />;
}

// ---------------------------------------------------------------- buttons

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-strong",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-subtle",
  ghost: "text-ink-2 hover:bg-subtle hover:text-ink",
  danger: "bg-fail text-white hover:opacity-90 dark:text-canvas",
};

export const buttonClass = (variant: Variant = "secondary", size: "sm" | "md" = "md") =>
  `relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    size === "sm" ? "h-7 px-2 text-xs pointer-coarse:h-10" : "h-8 px-3 text-sm pointer-coarse:h-11"
  } ${VARIANT[variant]} ${focusRing}`;

// While loading, the label stays (invisible) so the button keeps its width.
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={`${buttonClass(variant, size)} ${className}`}>
      <span className={`inline-flex items-center gap-1.5 ${loading ? "invisible" : ""}`}>{children}</span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- badges

export const STATUS_LABEL: Record<Status, string> = {
  queued: "Queued",
  drafting: "Drafting",
  needs_approval: "Needs approval",
  approved: "Sending",
  sent: "Sent",
  rejected: "Rejected",
  failed: "Failed",
};

type Tone = "neutral" | "brand" | "pass" | "fail" | "warn";

const TONE: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2",
  brand: "bg-brand-soft text-brand",
  pass: "bg-pass-soft text-pass",
  fail: "bg-fail-soft text-fail",
  warn: "bg-warn-soft text-warn",
};

const STATUS_TONE: Record<Status, Tone> = {
  queued: "neutral",
  drafting: "neutral",
  needs_approval: "brand",
  approved: "neutral",
  sent: "pass",
  rejected: "neutral",
  failed: "fail",
};

export const WORKING: Status[] = ["queued", "drafting", "approved"];

export function Badge({ tone = "neutral", children, testId }: { tone?: Tone; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, testId }: { status: Status; testId?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} testId={testId}>
      {WORKING.includes(status) && <Spinner className="size-2.5" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

// Initials on a neutral disc: quiet, and the same person always looks the same.
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold text-ink-2 ring-1 ring-line"
    >
      {initials || "?"}
    </span>
  );
}

// ---------------------------------------------------------------- forms

export const inputClass = `w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-lg text-ink placeholder:text-muted hover:border-muted ${focusRing} focus-visible:outline-offset-0 sm:text-sm`;

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {hint && <span className="font-normal text-muted"> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// Toggle buttons for a small set of choices (a filter, a mode): every option visible.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium pointer-coarse:h-9 ${focusRing} ${
            o.value === value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-line" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular-nums text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- dialog

// A native modal <dialog>: the browser traps focus, closes it on Esc and returns
// focus to the trigger. On small screens it fills the width like a sheet.
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${id}-title`}
      className={`m-auto w-[calc(100%-1.5rem)] animate-pop-in rounded-lg border border-line bg-surface p-0 text-ink shadow-float ${wide ? "max-w-xl" : "max-w-md"}`}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
            <div>
              <h2 id={`${id}-title`} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={`-mr-1 rounded-md p-1 text-muted hover:bg-subtle hover:text-ink ${focusRing}`}>
              <Icon name="x" />
            </button>
          </div>
          {children && <div className="overflow-y-auto px-4 py-3">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- formatting

export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
export const timeOfDay = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
export const fullTime = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// "now", "4m", "3h", then a date: short enough for a list column.
export function ago(date: string | Date, now = Date.now()) {
  const s = Math.max(0, (now - new Date(date).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return DAY.format(new Date(date));
}
