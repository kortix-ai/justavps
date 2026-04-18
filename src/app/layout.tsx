import type { Metadata } from "next";
import { roobert } from "./fonts/roobert";
import { roobertMono } from "./fonts/roobert-mono";
import "./globals.css";
import { Toaster } from "@/shared/ui/sonner";
import { SessionProvider } from "next-auth/react";
import { Providers } from "@/shared/hooks/query-client";
import { TooltipProvider } from "@/shared/ui/tooltip";

export const metadata: Metadata = {
  title: "justavps.com — AI Sandbox",
  description: "24/7 always-on sandbox for AI agents. Dedicated VPS with OpenCode, SSH access, and persistent state. Ready in minutes.",
};

// Runs before React hydration — reads localStorage, applies class, zero flash
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(!t)t=window.matchMedia("(prefers-color-scheme:light)").matches?"light":"dark";document.documentElement.classList.add(t)}catch(e){document.documentElement.classList.add("dark")}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${roobert.variable} ${roobertMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
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
