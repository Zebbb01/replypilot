"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Dialog, Icon, Logo, focusRing } from "./ui";

const REPO = "https://github.com/Zebbb01/replypilot";

const tab = (active: boolean) =>
  `relative flex h-12 items-center px-2 text-sm font-medium ${focusRing} ${
    active ? "text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand" : "text-muted hover:text-ink"
  }`;

function Nav({ live }: { live: boolean | null }) {
  return (
    <nav aria-label="Inboxes" className="flex items-center">
      <Link href="/" aria-current={live === false ? "page" : undefined} className={tab(live === false)}>
        Demo inbox
      </Link>
      <Link href="/live" aria-current={live ? "page" : undefined} className={tab(live === true)}>
        Live inbox
      </Link>
    </nav>
  );
}

// The current path is request data, so it renders inside Suspense with a neutral fallback.
function ActiveNav() {
  return <Nav live={usePathname().startsWith("/live")} />;
}

export function AppHeader() {
  const [about, setAbout] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="flex h-12 items-center gap-4 px-3 sm:px-4">
        <Link href="/" className={`flex items-center gap-2 rounded-md text-base font-semibold tracking-tight ${focusRing}`}>
          <Logo />
          <span className="hidden sm:inline">ReplyPilot</span>
        </Link>
        <Suspense fallback={<Nav live={null} />}>
          <ActiveNav />
        </Suspense>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setAbout(true)}>
            <Icon name="info" size={14} />
            <span className="hidden sm:inline">About</span>
          </Button>
          <a href={REPO} aria-label="Source on GitHub" title="Source on GitHub" className={`grid size-7 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink pointer-coarse:size-10 ${focusRing}`}>
            <Icon name="github" size={16} />
          </a>
        </div>
      </div>

      <Dialog
        open={about}
        onClose={() => setAbout(false)}
        title="About ReplyPilot"
        description="An AI support agent for Kettle & Pine, a fictional coffee-gear store."
        footer={
          <>
            <a href={`${REPO}#readme`} className={`${focusRing} inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-brand hover:bg-brand-soft`}>
              How it is built
            </a>
            <Button variant="primary" onClick={() => setAbout(false)}>
              Got it
            </Button>
          </>
        }
      >
        <ol className="grid gap-3 text-sm text-ink-2">
          {[
            ["Reads", "a customer email or a Shopify delivery event, then looks up the order and the store policies."],
            ["Drafts", "a reply. Code checks every draft, and a failed check blocks sending."],
            ["Waits", "for a person to approve, edit or reject. Every step is retried, logged and costed."],
          ].map(([verb, rest], i) => (
            <li key={verb} className="flex gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-2xs font-semibold text-brand">{i + 1}</span>
              <span>
                <span className="font-medium text-ink">{verb}</span> {rest}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Customers and orders are made up. Messages go to the Gemini API&apos;s free tier, which Google may use to
          improve its products. Demo replies stay in an outbox and demo tickets are deleted after 7 days.
        </p>
      </Dialog>
    </header>
  );
}
