"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/20" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/[0.03] rounded-full blur-3xl" />

      <div className="relative max-w-4xl mx-auto text-center space-y-8">
        {/* Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/40 bg-card/40 text-xs text-muted-foreground tracking-wide uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Dedicated vCPU &middot; 5 Regions &middot; Daily Backups
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-7xl lg:text-8xl font-bold tracking-tighter leading-[0.9]">
          Your Machine.
          <br />
          <span className="text-muted-foreground">Your Rules.</span>
        </h1>

        <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Dedicated VPS with Claude Code, OpenCode, and browser IDE pre-installed.
          SSH in and start building. Ready in 60 seconds.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/machines/new"
            className={cn(
              buttonVariants({ size: "lg" }),
              "text-base px-8 h-12 font-semibold"
            )}
          >
            Deploy a Machine
          </Link>
          <Link
            href="/docs"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "text-base px-8 h-12 font-medium"
            )}
          >
            Read the Docs
          </Link>
        </div>

        {/* Terminal mockup */}
        <div className="max-w-2xl mx-auto pt-6">
          <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden shadow-2xl shadow-black/20">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/30">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              <span className="text-xs text-muted-foreground/60 font-mono ml-2">
                ~ ssh root@your-machine
              </span>
            </div>
            {/* Terminal body */}
            <div className="p-5 font-mono text-sm leading-relaxed text-left">
              <div className="text-muted-foreground">
                <span className="text-green-400">$</span> ssh -i ~/.ssh/justavps root@95.217.x.x
              </div>
              <div className="text-muted-foreground/60 mt-1">
                Welcome to JustAVPS (Ubuntu 24.04)
              </div>
              <div className="text-muted-foreground/60">
                Claude Code &middot; OpenCode &middot; code-server &middot; Docker
              </div>
              <div className="mt-3 text-muted-foreground">
                <span className="text-green-400">$</span> claude
              </div>
              <div className="text-foreground mt-1">
                ╭ Claude Code v1.2.0
              </div>
              <div className="text-foreground">
                ╰ Ready. What are we building?
              </div>
              <div className="mt-3 text-muted-foreground">
                <span className="text-green-400">$</span> opencode serve --port 3456
              </div>
              <div className="text-blue-400 mt-1">
                OpenCode Web UI → https://3456.abc123.kortix.cloud
              </div>
              <span className="inline-block w-2 h-4 bg-foreground/70 animate-pulse ml-0.5" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
