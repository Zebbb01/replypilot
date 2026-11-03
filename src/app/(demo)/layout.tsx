import { Suspense } from "react";
import { InboxShell } from "../inbox/shell";

export default function DemoLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense>
      <InboxShell view="demo">{children}</InboxShell>
    </Suspense>
  );
}
