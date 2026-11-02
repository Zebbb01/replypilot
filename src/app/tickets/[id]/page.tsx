import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketView } from "./ticket-view";

export const metadata: Metadata = { title: "Review" };

export default function TicketPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the ticket…</p>}>
      <TicketView />
    </Suspense>
  );
}
