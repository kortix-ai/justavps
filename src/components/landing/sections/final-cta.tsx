"use client";

import Link from "next/link";

/* ────────────────────────────────────────────────────────────
 * FinalCta
 *
 * Closing statement of the page. One big, confident sentence,
 * a single emerald-glow CTA, and a quiet secondary link. Lives
 * inside the page rails so it lines up with every other
 * section — with a subtle emerald wash from the bottom to echo
 * the hero treatment.
 * ──────────────────────────────────────────────────────────── */

export function FinalCta({
  onDeploy,
  startingPrice,
}: {
  onDeploy: () => void;
  startingPrice: number;
}) {
  return (
    <section className="relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute bottom-[-20%] left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-gradient-to-t from-emerald-500/[0.08] via-emerald-500/[0.02] to-transparent blur-3xl" />
      </div>

      <div className="relative px-6 py-24 md:py-32 lg:py-36 text-center">
        <p className="text-[11px] text-emerald-500 uppercase tracking-[0.24em] mb-6 font-medium">
          Deploy
        </p>

        <h2 className="text-[clamp(2.25rem,6vw,4.5rem)] font-medium tracking-[-0.04em] leading-[0.95] text-foreground max-w-3xl mx-auto">
          Your agents are waiting.
        </h2>

        <p className="mt-6 text-sm md:text-base text-muted-foreground">
          From <span className="text-foreground font-medium">${startingPrice}/mo</span>.
          Running in minutes. Cancel anytime.
        </p>

        <div className="mt-10 flex items-center justify-center gap-3">
          <button
            onClick={onDeploy}
            className="group relative h-12 px-7 rounded-full bg-foreground text-background border border-emerald-500/40 text-sm font-medium shadow-[0_0_40px_rgba(16,185,129,0.18)] hover:shadow-[0_0_64px_rgba(16,185,129,0.4)] hover:border-emerald-500/70 transition-all duration-300"
          >
            <span className="flex items-center gap-2">
              Deploy a machine
              <svg
                className="size-4 transition-transform group-hover:translate-x-0.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </span>
          </button>

          <Link
            href="/docs"
            className="h-12 px-5 inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Read the docs
          </Link>
        </div>
      </div>
    </section>
  );
}
