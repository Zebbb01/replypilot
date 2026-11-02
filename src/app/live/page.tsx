import type { Metadata } from "next";
import { Inbox } from "../inbox";

export const metadata: Metadata = { title: "Live inbox" };

export default function Live() {
  return (
    <>
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Live inbox</h1>
        <p className="mt-3 leading-relaxed text-muted">
          Real customer emails and Shopify delivery events from the connected test store. Approved replies here are
          emailed to the customer.
        </p>
      </section>
      <Inbox view="live" />
    </>
  );
}
