"use client";

import type { ReactNode } from "react";
import { TbApi } from "react-icons/tb";
import { SiPython, SiTypescript } from "react-icons/si";
import { Reveal } from "@/components/landing/shared/reveal";

/* ────────────────────────────────────────────────────────────
 * UseCases
 *
 * Same bento pattern as Infrastructure / SupportedAgents:
 *  - edge-to-edge grid inside the PageFrame rails
 *  - `gap-px + bg-border/60` for internal dividers only
 *  - header cell spans the full top row
 *  - two large use-case cells below (each with its own preview)
 *
 * No glow, no per-cell borders, no rounded cards.
 * ──────────────────────────────────────────────────────────── */

function Chip({ children }: { children: ReactNode }) {
  return (
    <div className="size-8 rounded-lg border border-border/60 bg-muted/40 flex items-center justify-center text-muted-foreground">
      {children}
    </div>
  );
}

const PLATFORM_CAPABILITIES = [
  { label: "Machines", desc: "Create, list, resize, delete" },
  { label: "Filesystem", desc: "Read, write, search, upload" },
  { label: "Process", desc: "Exec, stream, kill" },
  { label: "Agents API", desc: "OpenCode, Codex, more" },
];

export function UseCases({ onDeploy: _onDeploy }: { onDeploy: () => void }) {
  return (
    <section className="relative">
      <Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border/60">
          {/* Header cell — full width */}
          <div className="bg-background col-span-1 md:col-span-2 px-8 py-12 md:p-12 lg:p-14 flex flex-col">
            <p className="text-[11px] text-cyan-500 uppercase tracking-[0.24em] mb-5 font-medium">
              Use cases
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground max-w-2xl">
              Personal machine or platform primitive
            </h2>
          </div>

          {/* Personal use case */}
          <div className="bg-background px-8 py-10 md:p-12 flex flex-col">
            <span className="inline-flex self-start text-[10px] font-medium text-muted-foreground uppercase tracking-[0.2em] border border-border/60 rounded-full px-2.5 py-1 mb-5">
              Personal
            </span>
            <h3 className="text-lg md:text-xl font-medium text-foreground mb-3">
              Your dev machine in the cloud
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-md">
              SSH in or connect your IDE. It&apos;s just a Linux box. Close your laptop, your agents keep going.
            </p>

            {/* Terminal preview */}
            <div className="mt-auto rounded-xl border border-border/60 bg-muted/30 p-5 font-mono text-[13px] leading-[1.9]">
              <div>
                <span className="text-emerald-500/70">$</span>{" "}
                <span className="text-foreground/90">ssh root@95.217.x.x</span>
              </div>
              <div>
                <span className="text-emerald-500/70">$</span>{" "}
                <span className="text-foreground/90">opencode</span>
              </div>
              <div className="text-cyan-500/70">
                Open the machine URL in your browser
                <span className="inline-block w-[2px] h-3.5 bg-foreground/60 ml-0.5 align-text-bottom animate-pulse" />
              </div>
            </div>
          </div>

          {/* Platform use case */}
          <div className="bg-background px-8 py-10 md:p-12 flex flex-col">
            <span className="inline-flex self-start text-[10px] font-medium text-muted-foreground uppercase tracking-[0.2em] border border-border/60 rounded-full px-2.5 py-1 mb-5">
              Platform
            </span>
            <h3 className="text-lg md:text-xl font-medium text-foreground mb-3">
              Sandboxes as infrastructure
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5 max-w-md">
              Spin up machines, manage files, run bash, and launch coding agents &mdash; all from one API.
            </p>

            <div className="flex items-center gap-1.5 mb-8">
              <Chip>
                <SiPython className="size-4" />
              </Chip>
              <Chip>
                <SiTypescript className="size-4" />
              </Chip>
              <Chip>
                <TbApi className="size-5" />
              </Chip>
            </div>

            {/* API capabilities grid */}
            <div className="mt-auto grid grid-cols-2 gap-2">
              {PLATFORM_CAPABILITIES.map((c) => (
                <div
                  key={c.label}
                  className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
                >
                  <div className="text-xs font-medium text-foreground">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
