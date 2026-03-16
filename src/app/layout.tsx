import type { Metadata } from "next";
import { Inter, JetBrains_Mono, EB_Garamond, Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "next-auth/react";
import { Providers } from "@/hooks/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const garamond = EB_Garamond({
  variable: "--font-garamond",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JustAVPS — Dedicated VPS with Claude Code & OpenCode",
  description: "Dedicated VPS with Claude Code, OpenCode, and browser IDE pre-installed. SSH in and start building. Ready in 60 seconds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)} suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${garamond.variable} font-sans antialiased`}>
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
