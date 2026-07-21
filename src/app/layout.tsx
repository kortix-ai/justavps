import type { Metadata } from "next";
import { roobert } from "./fonts/roobert";
import { roobertMono } from "./fonts/roobert-mono";
import "./globals.css";
import { Toaster } from "@/shared/ui/sonner";
import { SessionProvider } from "next-auth/react";
import { Providers } from "@/shared/hooks/query-client";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { SunsetNotice } from "@/shared/components/sunset/sunset-notice";
import { PLATINUM_URL } from "@/shared/lib/sunset";

const SITE_URL = "https://justavps.com";
const TITLE = "justavps.com — 24/7 VPS Sandbox for AI Agents";
const DESCRIPTION =
  "Always-on Linux VPS sandboxes for AI agents with SSH access and persistent state. justavps.com is becoming platinum.dev — the most affordable AI agent sandbox cloud.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s | justavps.com",
  },
  description: DESCRIPTION,
  keywords: [
    "AI agent sandbox",
    "VPS for AI agents",
    "AI sandbox cloud",
    "persistent Linux sandbox",
    "agent infrastructure",
    "SSH sandbox",
    "OpenCode VPS",
    "platinum.dev",
    "affordable AI agent sandbox",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "justavps.com",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "justavps.com",
      description: DESCRIPTION,
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "justavps.com",
      url: SITE_URL,
      sameAs: [PLATINUM_URL],
    },
    {
      "@type": "SoftwareApplication",
      name: "justavps",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Linux",
      description:
        "24/7 always-on VPS sandboxes for AI agents. Successor: Platinum (platinum.dev), the most affordable AI agent sandbox cloud.",
      url: SITE_URL,
    },
  ],
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="font-sans antialiased">
        <SessionProvider>
          <Providers>
            <TooltipProvider>
              {children}
              <SunsetNotice />
              <Toaster />
            </TooltipProvider>
          </Providers>
        </SessionProvider>
      </body>
    </html>
  );
}
