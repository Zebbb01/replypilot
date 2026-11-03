import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketDetail } from "../../../inbox/ticket";

export const metadata: Metadata = { title: "Review" };

export default function LiveTicket() {
  return (
    <Suspense>
      <TicketDetail />
    </Suspense>
  );
}
