import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxShell } from "../inbox/shell";

export const metadata: Metadata = { title: "Live inbox" };

export default function LiveLayout({ children }: LayoutProps<"/live">) {
  return (
    <Suspense>
      <InboxShell view="live">{children}</InboxShell>
    </Suspense>
  );
}
