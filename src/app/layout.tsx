import type { Metadata } from "next";
import { roobert } from "./fonts/roobert";
import { roobertMono } from "./fonts/roobert-mono";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "next-auth/react";
import { Providers } from "@/hooks/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "justavps.com — 24/7 Always-On Sandbox for AI",
  description: "24/7 always-on sandbox for AI agents. Dedicated VPS with Claude Code, OpenCode, and browser IDE pre-installed. Ready in 60 seconds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${roobert.variable} ${roobertMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <SessionProvider>
          <Providers>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </Providers>
        </SessionProvider>
      </body>
    </html>
  );
}
