"use client";

import { Reveal } from "@/components/landing/shared/reveal";
import {
  InfinityGlyph,
  JustavpsMark,
  PowerGlyph,
} from "@/components/landing/hero/hero-glyphs";

export function Hero({
  onDeploy,
  startingPrice,
}: {
  onDeploy: () => void;
  startingPrice: number;
}) {
  return (
    <section className="relative px-4 sm:px-6 min-h-[80vh] sm:min-h-[92vh] flex items-center overflow-hidden">
      <div className="relative max-w-6xl mx-auto w-full mt-16 text-center py-20 sm:py-24">
        <Reveal>
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-[-0.045em] leading-[0.95] text-foreground/40">
            <span className="bg-gradient-to-r from-foreground/20 via-foreground/70 to-foreground/20 text-transparent bg-clip-text">
              Infrastructure for
            </span>
            <br />
            <span className="bg-gradient-to-r from-foreground/20 via-foreground/70 to-foreground/20 text-transparent bg-clip-text">
              AI agents <InfinityGlyph /> that
            </span>
            <br />
            <span className="text-foreground"> never </span>
            <PowerGlyph />
            <span className="text-foreground"> sleep.</span>
          </h1>
        </Reveal>

        <Reveal delay={150}>
          <p className="mt-5 text-[clamp(1.1rem,2.6vw,2.25rem)] tracking-[-0.035em] leading-tight text-foreground/30">
            and it&apos;s <JustavpsMark />
            <span className="text-foreground/30">.</span>
          </p>
        </Reveal>

        <Reveal delay={280}>
          <div className="mt-10 sm:mt-14 flex flex-col items-center gap-5">
            <button
              onClick={onDeploy}
              className="group relative h-11 sm:h-12 px-6 sm:px-7 rounded-full bg-foreground text-background border border-emerald-400/30 text-sm transition-all duration-300 hover:border-emerald-400/60 shadow-[0_0_40px_rgba(16,185,129,0.15)] hover:shadow-[0_0_60px_rgba(16,185,129,0.35)]"
            >
              <span className="relative flex items-center gap-2">
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
            <p className="text-xs text-foreground/40 tracking-wide">
              From ${startingPrice}/mo &middot; Running in minutes &middot; Cancel anytime
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
