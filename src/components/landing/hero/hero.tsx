"use client";

import { Reveal } from "@/components/landing/shared/reveal";
import {
  InfinityGlyph,
  JustavpsMark,
  PowerGlyph,
  StrokeInfinityGlyph,
} from "@/components/landing/hero/hero-glyphs";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { cn } from "@/lib/utils";

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
        <div
          className={cn(
            "mb-6 group w-fit mx-auto rounded-full bg-muted/50 border flex items-center justify-center"
          )}
        >
          <AnimatedShinyText className="inline-flex text-sm items-center justify-center px-4 py-1 transition ease-out">
            <span>✨ 24/7 active machines</span>
          </AnimatedShinyText>
        </div>
        <Reveal>
          <h1 className="text-5xl sm:text-6xl md:text-7xl tracking-[-0.045em] leading-[0.95] text-foreground/40">
            <span className="text-foreground">
              Infrastructure for
            </span>
            <br />
            <span className="text-foreground">
              AI agents <StrokeInfinityGlyph size={0.7} step={0.18} /> that
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
            <Button
              onClick={onDeploy}
              className="group relative h-11 sm:h-12 px-6 sm:px-7 rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              <span className="relative flex items-center gap-2">
                Deploy a machine
                <ArrowRight className="size-4" />
              </span>
            </Button>
            <p className="text-xs text-foreground/40 tracking-wide">
              From ${startingPrice}/mo &middot; Running in minutes &middot; Cancel anytime
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
