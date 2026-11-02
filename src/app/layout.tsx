import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Logo, focusRing } from "./ui";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ReplyPilot", template: "%s · ReplyPilot" },
  description:
    "An AI support agent for an online store: it looks up Shopify orders and store policies, drafts the reply, and waits for a person to approve it.",
};

const nav = `rounded text-sm text-muted hover:text-ink ${focusRing}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className={`flex items-center gap-2 rounded font-semibold tracking-tight ${focusRing}`}>
              <Logo />
              ReplyPilot
            </Link>
            <nav className="flex items-center gap-5">
              <Link href="/" className={nav}>
                Demo inbox
              </Link>
              <Link href="/live" className={nav}>
                Live inbox
              </Link>
              <a href="https://github.com/Zebbb01/replypilot" className={nav}>
                Source
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs leading-relaxed text-muted sm:px-6">
            A free demo on Azure&apos;s free tiers. Kettle &amp; Pine is a fictional store, and its customers and orders
            are made up. Demo replies go to an outbox and are never emailed. Demo tickets are deleted after 7 days.
          </p>
        </footer>
      </body>
    </html>
  );
}
