import { Inbox } from "./inbox";

export default function Home() {
  return (
    <>
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Support emails in, approved replies out.</h1>
        <p className="mt-3 leading-relaxed text-muted">
          ReplyPilot is an AI support agent for Kettle &amp; Pine, a small online coffee-gear store. It reads a customer&apos;s
          email, looks up their Shopify order and the store policies, and drafts a reply. Code then checks the draft, and
          nothing is sent until a person approves it. Every step is logged, retried when it fails, and costed.
        </p>
      </section>
      <Inbox view="demo" />
    </>
  );
}
