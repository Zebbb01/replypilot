import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppHeader } from "./header";
import { Toaster } from "./toast";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "ReplyPilot", template: "%s · ReplyPilot" },
  description:
    "An AI support agent for an online store: it looks up Shopify orders and store policies, drafts the reply, and waits for a person to approve it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
      <body className="bg-canvas font-sans text-base text-ink">
        <a href="#main" className="sr-only rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50">
          Skip to content
        </a>
        <AppHeader />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
