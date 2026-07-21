"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { PLATINUM_URL } from "@/shared/lib/sunset";

export function LandingFooter() {
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  return (
    <footer className="border-t border-white/[0.06] px-6 py-8">
      <div className="max-w-6xl mx-auto mb-6 text-center sm:text-left">
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          justavps.com is becoming{" "}
          <a
            href={PLATINUM_URL}
            className="text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            platinum.dev
          </a>{" "}
          — the most affordable AI agent sandbox cloud.
        </p>
      </div>
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground/40">
          &copy; {new Date().getFullYear()} justavps.com &middot;{" "}
          <a
            href="https://kortix.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Kortix
          </a>
        </span>
        <div className="flex items-center gap-6 text-xs text-muted-foreground/40">
          <Link href="/docs" className="hover:text-foreground transition-colors">
            Docs
          </Link>
          <Link href="/api/docs" className="hover:text-foreground transition-colors">
            API
          </Link>
          {isLoggedIn ? (
            <Link href="/machines" className="hover:text-foreground transition-colors">
              Dashboard
            </Link>
          ) : (
            <Link href="/login" className="hover:text-foreground transition-colors">
              Login
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}
