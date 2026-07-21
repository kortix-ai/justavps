"use client";

import { useEffect, useState } from "react";
import { X, ArrowUpRight } from "lucide-react";
import { PLATINUM_URL } from "@/shared/lib/sunset";

const DISMISS_KEY = "justavps-sunset-notice-dismissed";

export function SunsetNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== "1") setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  if (!visible) return null;

  return (
    <aside
      role="status"
      className="fixed top-20 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border/60 bg-background/90 backdrop-blur-xl p-4 pr-10 shadow-lg"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-sm font-medium text-foreground">
        justavps.com is becoming platinum.dev
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Platinum is the most affordable AI agent sandbox cloud — the next
        chapter of justavps.
      </p>
      <a
        href={PLATINUM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
      >
        Visit platinum.dev
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
    </aside>
  );
}
