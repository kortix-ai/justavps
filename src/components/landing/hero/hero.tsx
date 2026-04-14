"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero({
  onDeploy,
  startingPrice,
}: {
  onDeploy: () => void;
  startingPrice: number;
}) {
  return (
    <section className="relative">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-px bg-border/60 lg:min-h-[86vh]">
        {/* Left — headline + CTA */}
        <div className="bg-background px-8 py-20 md:px-14 md:py-24 lg:px-16 lg:py-28 flex flex-col justify-center">
          <p className="text-[11px] text-brand uppercase tracking-[0.24em] mb-7 font-medium inline-flex items-center gap-2">
            <span className="relative flex size-1.5">
              <span className="animate-ping absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            System · online · 24/7
          </p>

          <h1 className="text-[2.5rem] md:text-5xl lg:text-[4.25rem] font-medium tracking-[-0.035em] leading-[0.98] text-foreground max-w-xl">
            AI sandboxes
            <br />
            for agents that{" "}
            <span className="text-muted-foreground/45">run 24/7.</span>
          </h1>

          <p className="text-base md:text-[17px] text-muted-foreground mt-7 max-w-lg leading-relaxed">
            Persistent, always-on Linux machines that run 24/7 so your agents can too.{" "}
            <span className="text-foreground font-medium">
              Secure by default. Stateful. Always on.
            </span>
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Button
              onClick={onDeploy}
              className="h-12 px-7 rounded-full bg-foreground text-background hover:bg-foreground/90 text-[13.5px] font-medium"
            >
              <span className="flex items-center gap-2">
                Get a machine — from ${startingPrice}/mo
                <ArrowRight className="size-4" />
              </span>
            </Button>
            <Link
              href="/docs"
              className="h-12 px-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Read the docs
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          <p className="mt-10 text-[11px] text-muted-foreground/60 uppercase tracking-[0.2em]">
            Running in minutes
            <span className="text-muted-foreground/30"> · </span>
            Cancel anytime
            <span className="text-muted-foreground/30"> · </span>
            No lock-in
          </p>
        </div>

        {/* Right — intentionally blank for now */}
        <div
          aria-hidden
          className="hidden lg:block bg-background relative overflow-hidden"
        >
          <div
            className="absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
            style={{
              backgroundImage:
                "linear-gradient(to right, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
        </div>
      </div>
    </section>
  );
}
