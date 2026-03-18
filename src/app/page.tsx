"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

/* ═══════════════════════════════════════════════════
   SVG LOGOS (inline for instant render, no network)
   ═══════════════════════════════════════════════════ */
const LogoClaude = () => (
  <svg viewBox="0 0 40 40" className="size-5" fill="currentColor"><path d="M26.9568 9.88184H22.1265L30.7753 31.7848H35.4917L26.9568 9.88184ZM13.028 9.88184L4.4917 31.7848H9.32203L11.2305 27.1793H20.2166L22.0126 31.6724H26.8444L18.0832 9.88184H13.028ZM12.5783 23.1361L15.4987 15.3853L18.5315 23.1361H12.5783Z" /></svg>
);
const LogoOpenCode = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path opacity="0.2" d="M19.2002 17.4H8.40017V13.8H15.6002V10.2H19.2002V17.4ZM8.40017 13.8H4.80017V10.2H8.40017V13.8Z" /><path d="M8.40005 17.4H19.2001V21H4.80005V13.8H8.40005V17.4ZM15.6001 10.2V13.8H8.40005V10.2H15.6001ZM19.2001 10.2H15.6001V6.6H4.80005V3H19.2001V10.2Z" /></svg>
);
const LogoCursor = () => (
  <svg viewBox="0 0 500 545" className="size-5" fill="currentColor"><path d="m466.383 137.073-206.469-119.2034c-6.63-3.8287-14.811-3.8287-21.441 0L31.9144 137.073c-5.5734 3.218-9.0144 9.169-9.0144 15.615v240.375c0 6.436 3.441 12.397 9.0144 15.615l206.4686 119.203c6.63 3.829 14.811 3.829 21.441 0l206.468-119.203c5.574-3.218 9.015-9.17 9.015-15.615v-240.375c0-6.436-3.441-12.397-9.015-15.615zm-12.969 25.25-199.316 345.223c-1.347 2.326-4.904 1.376-4.904-1.319V280.179c0-4.517-2.414-8.695-6.33-10.963L47.107 156.197c-2.3263-1.347-1.3764-4.905 1.3182-4.905h398.6305c5.661 0 9.199 6.136 6.368 11.041h-.009z" /></svg>
);
const LogoVSCode = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M17.583 2.27l-7.154 6.52L5.51 4.835 3 5.98v12.04l2.51 1.145 4.919-3.955 7.154 6.52L21 20.27V3.73l-3.417-1.46zM5 15.15V8.85l3.25 3.15L5 15.15zm12.583 2.57l-5.25-4.72 5.25-4.72v9.44z" /></svg>
);
const LogoDocker = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186h-2.119a.186.186 0 00-.187.186v1.886c0 .103.084.186.187.186zm-2.954-5.43h2.118a.186.186 0 00.187-.185V3.577a.186.186 0 00-.187-.186h-2.118a.186.186 0 00-.187.186v1.886c0 .102.084.185.187.185zm0 2.716h2.118a.187.187 0 00.187-.186V6.292a.187.187 0 00-.187-.186h-2.118a.187.187 0 00-.187.186v1.886c0 .103.084.186.187.186zm-2.93 0h2.12a.186.186 0 00.186-.186V6.292a.186.186 0 00-.186-.186h-2.12a.186.186 0 00-.185.186v1.886c0 .103.083.186.185.186zm-2.964 0h2.119a.186.186 0 00.185-.186V6.292a.186.186 0 00-.185-.186H5.136a.186.186 0 00-.186.186v1.886c0 .103.084.186.186.186zm5.893 2.715h2.118a.186.186 0 00.187-.186V9.006a.186.186 0 00-.187-.186h-2.118a.186.186 0 00-.187.186v1.886c0 .103.084.186.187.186zm-2.93 0h2.12a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186h-2.12a.186.186 0 00-.185.186v1.886c0 .103.083.186.185.186zm-2.964 0h2.119a.186.186 0 00.185-.186V9.006a.186.186 0 00-.185-.186H5.136a.186.186 0 00-.186.186v1.886c0 .103.084.186.186.186zm-2.928 0h2.119a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186H2.208a.186.186 0 00-.186.186v1.886c0 .103.083.186.186.186zM23.763 11.36c-.006-.004-.54-.39-1.583-.39-.265 0-.53.024-.79.07-.28-1.805-1.885-2.686-1.95-2.72l-.392-.218-.234.38c-.297.486-.503 1.036-.605 1.606-.22.976-.082 1.892.389 2.676-.578.338-1.52.42-1.71.426H.828a.83.83 0 00-.83.828c-.025 1.597.218 3.19.727 4.697.577 1.614 1.44 2.803 2.564 3.533 1.264.82 3.324 1.288 5.622 1.288.966 0 1.945-.087 2.907-.27a12.258 12.258 0 003.525-1.245 9.741 9.741 0 002.552-2.07c1.227-1.395 1.96-2.955 2.505-4.33h.218c1.35 0 2.182-.542 2.64-1 .3-.3.528-.654.67-1.046l.094-.296-.366-.214z" /></svg>
);

/* ═══════ THEME TOGGLE ═══════ */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Toggle theme">
      {theme === "dark" ? (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
      ) : (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
      )}
    </button>
  );
}

/* ═══════ ANIMATED GRID BG ═══════ */
function GridBg() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--grid-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-color)_1px,transparent_1px)] bg-[size:80px_80px] [--grid-color:oklch(0.5_0_0/0.04)] dark:[--grid-color:oklch(0.5_0_0/0.06)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-primary/[0.05] to-transparent rounded-full blur-[100px]" />
    </div>
  );
}

/* ═══════ RUNNING COUNTER ═══════ */
function Counter({ end, suffix = "" }: { end: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let frame: number;
    const duration = 1200;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(ease * end));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [end]);
  return <>{val}{suffix}</>;
}

/* ═══════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════ */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ─── NAVBAR ─── */}
      <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="size-7 rounded-lg bg-foreground flex items-center justify-center transition-transform group-hover:scale-105">
              <svg className="size-3.5 text-background" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            </div>
            <span className="text-sm font-medium tracking-tight">justavps</span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-[13px] text-muted-foreground">
            <a href="#use-cases" className="hover:text-foreground transition-colors">Use Cases</a>
            <a href="#compare" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="#api" className="hover:text-foreground transition-colors">API</a>
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[13px]")}>Log in</Link>
            <Link href="/machines/new" className={cn(buttonVariants({ size: "sm" }), "text-[13px] hidden sm:inline-flex")}>Get started</Link>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative px-6 pt-24 pb-20 sm:pt-40 sm:pb-32 overflow-hidden">
        <GridBg />
        <div className="relative max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-border/50 bg-background/60 backdrop-blur-sm mb-8">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
            <span className="text-xs font-medium text-muted-foreground">24/7 Always On</span>
          </div>

          <h1 className="text-6xl sm:text-8xl lg:text-9xl font-medium tracking-tighter leading-[0.85]">
            <span className="bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent">AI Sandbox</span>
          </h1>
          <p className="mt-5 text-lg sm:text-2xl tracking-tight">
            <span className="text-muted-foreground/50">...it&apos;s</span>{" "}
            <span className="font-medium bg-gradient-to-r from-foreground/80 to-foreground/50 bg-clip-text text-transparent">justavps</span>
          </p>

          <p className="mt-6 text-sm sm:text-[15px] text-muted-foreground max-w-md mx-auto leading-relaxed">
            Persistent, always-on infrastructure for AI agents.
            Dedicated VPS with SSH, browser IDE &amp; coding agents pre-installed.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/machines/new" className={cn(buttonVariants({ size: "lg" }), "text-sm px-7 h-12 font-medium rounded-xl shadow-lg shadow-primary/10")}>
              Get a machine
              <svg className="ml-2 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </Link>
            <Link href="/docs" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "text-sm px-7 h-12 font-medium rounded-xl")}>Docs</Link>
          </div>

          <p className="mt-5 text-xs text-muted-foreground/40">
            Running in 60 seconds &middot; From <span className="text-foreground/60 font-medium">$15/mo</span> &middot; No per-hour billing
          </p>

          {/* ─ Logo bar ─ */}
          <div className="mt-14 flex items-center justify-center gap-1">
            <span className="text-[10px] text-muted-foreground/30 uppercase tracking-widest mr-4">Works with</span>
            <LogoPill icon={<LogoClaude />} label="Claude Code" />
            <LogoPill icon={<LogoOpenCode />} label="OpenCode" />
            <LogoPill icon={<LogoCursor />} label="Cursor" />
            <LogoPill icon={<LogoVSCode />} label="VS Code" />
            <LogoPill icon={<LogoDocker />} label="Docker" />
          </div>
        </div>
      </section>

      {/* ─── CODE DEMO ─── */}
      <section className="px-6 pb-16 sm:pb-24 -mt-4">
        <div className="max-w-3xl mx-auto"><CodeDemo /></div>
      </section>

      {/* ─── STATS BAR ─── */}
      <section className="border-y border-border/40 bg-muted/10">
        <div className="max-w-6xl mx-auto grid grid-cols-3 divide-x divide-border/40">
          <div className="text-center py-8 sm:py-10">
            <div className="text-3xl sm:text-4xl font-medium tracking-tight"><Counter end={60} />s</div>
            <div className="text-xs text-muted-foreground/50 mt-1">Provisioning time</div>
          </div>
          <div className="text-center py-8 sm:py-10">
            <div className="text-3xl sm:text-4xl font-medium tracking-tight">$<Counter end={15} /></div>
            <div className="text-xs text-muted-foreground/50 mt-1">Starting price /mo</div>
          </div>
          <div className="text-center py-8 sm:py-10">
            <div className="text-3xl sm:text-4xl font-medium tracking-tight"><Counter end={24} />/7</div>
            <div className="text-xs text-muted-foreground/50 mt-1">Always running</div>
          </div>
        </div>
      </section>

      {/* ─── USE CASES (bento) ─── */}
      <section id="use-cases" className="px-6 py-20 sm:py-28">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-lg mb-14">
            <p className="font-mono text-[10px] text-muted-foreground/40 tracking-[0.2em] uppercase mb-3">Use Cases</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight mb-3">
              Use it personally.<br /><span className="text-muted-foreground/40">Or build a service on it.</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every machine gets an authenticated proxy — every port accessible at{" "}
              <code className="text-[12px] bg-muted px-1.5 py-0.5 rounded font-mono">PORT.slug.kortix.cloud</code>,
              secured by default. Use via SSH personally, or build applications around it programmatically.
            </p>
          </div>

          <div className="grid md:grid-cols-6 gap-3">
            {/* Card 1 — wide */}
            <div className="md:col-span-4 group relative p-6 sm:p-8 rounded-2xl border border-border/40 bg-gradient-to-br from-background to-muted/20 overflow-hidden">
              <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-foreground/5 border border-border/30 text-[10px] font-medium text-muted-foreground">PERSONAL</div>
              <div className="flex items-center gap-3 mb-4">
                <div className="size-10 rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/5 flex items-center justify-center">
                  <svg className="size-5 text-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </div>
              </div>
              <h3 className="text-xl font-medium tracking-tight mb-2">Personal Dev Environment</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
                Run Claude Code, OpenCode, or Codex on a machine that never sleeps. SSH from Cursor or VS Code.
                No network interruptions, no timeouts. Your agents run 24/7 with daily backups.
              </p>
              <div className="mt-5 flex items-center gap-2">
                <LogoChip icon={<LogoClaude />} /> <LogoChip icon={<LogoCursor />} /> <LogoChip icon={<LogoVSCode />} />
                <span className="text-[10px] text-muted-foreground/30 ml-1">+ any SSH client</span>
              </div>
            </div>

            {/* Card 2 — narrow */}
            <div className="md:col-span-2 group relative p-6 rounded-2xl border border-border/40 bg-gradient-to-br from-background to-muted/20 flex flex-col">
              <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-foreground/5 border border-border/30 text-[10px] font-medium text-muted-foreground">AI AGENT</div>
              <div className="size-10 rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/5 flex items-center justify-center mb-4">
                <svg className="size-5 text-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M12 2a4 4 0 014 4v1H8V6a4 4 0 014-4zM7 15h.01M12 15h.01M17 15h.01" /></svg>
              </div>
              <h3 className="text-base font-medium tracking-tight mb-2">24/7 Agent Computer</h3>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                A true personal machine for your AI. Stateful FS, Docker, cron, webhooks — always online. Daily backups.
              </p>
            </div>

            {/* Card 3 — full width */}
            <div className="md:col-span-6 group relative p-6 sm:p-8 rounded-2xl border border-border/40 bg-gradient-to-r from-background via-muted/10 to-background overflow-hidden">
              <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-foreground/5 border border-border/30 text-[10px] font-medium text-muted-foreground">SERVICE</div>
              <div className="grid sm:grid-cols-2 gap-8 items-center">
                <div>
                  <div className="size-10 rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/5 flex items-center justify-center mb-4">
                    <svg className="size-5 text-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
                  </div>
                  <h3 className="text-xl font-medium tracking-tight mb-2">Run Coding Agents as a Service</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Provision machines for your users via REST API. Each gets an isolated sandbox with coding agents.
                    Every port is proxy-authenticated — expose APIs, terminals, or web UIs. Secure by default.
                  </p>
                </div>
                <div className="rounded-xl border border-border/30 bg-[--code-bg] [--code-bg:oklch(0.97_0_0)] dark:[--code-bg:oklch(0.06_0_0)] p-4 font-mono text-[12px] leading-relaxed text-muted-foreground/60">
                  <div className="text-muted-foreground/30">// Your users get isolated sandboxes</div>
                  <div className="mt-1">POST /api/v1/machines</div>
                  <div className="text-muted-foreground/40">&rarr; SSH, IDE, proxy, agent — per user</div>
                  <div className="mt-3 text-muted-foreground/30">// Expose any port, authenticated</div>
                  <div className="mt-1">https://8000.<span className="text-foreground/50">slug</span>.kortix.cloud</div>
                  <div className="text-muted-foreground/40">&rarr; API key or session auth built-in</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── EVERY MACHINE INCLUDES ─── */}
      <section className="px-6 py-20 sm:py-28 border-t border-border/40 bg-muted/10">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="font-mono text-[10px] text-muted-foreground/40 tracking-[0.2em] uppercase mb-3">Every Machine</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight">Everything included.</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FeatureChip icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>} title="SSH" desc="Key-based access" />
            <FeatureChip icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>} title="Web Terminal" desc="PTY in the browser" />
            <FeatureChip icon={<LogoVSCode />} title="Browser IDE" desc="code-server built in" />
            <FeatureChip icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>} title="Auth Proxy" desc="Every port forwarded" />
            <FeatureChip icon={<LogoClaude />} title="Claude Code" desc="Pre-installed" />
            <FeatureChip icon={<LogoDocker />} title="Docker" desc="Ready to go" />
            <FeatureChip icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>} title="Daily Backups" desc="Automatic snapshots" />
            <FeatureChip icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>} title="Static IP" desc="Dedicated address" />
          </div>
        </div>
      </section>

      {/* ─── COMPARISON ─── */}
      <section id="compare" className="px-6 py-20 sm:py-28 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="font-mono text-[10px] text-muted-foreground/40 tracking-[0.2em] uppercase mb-3">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight mb-4">The right tool for the workload</h2>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
              Per-second sandboxes are great for burst compute. For workloads that run <strong className="text-foreground/80">24/7</strong>, per-hour billing adds up fast.
            </p>
          </div>

          {/* Two-column header */}
          <div className="grid grid-cols-2 gap-3 mb-0">
            <div className="rounded-t-2xl border border-b-0 border-border/40 bg-muted/10 p-5 sm:p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex -space-x-1">
                  <div className="size-7 rounded-lg bg-background border border-border/40 flex items-center justify-center text-foreground/50"><span className="text-[9px] font-bold font-mono">E2B</span></div>
                  <div className="size-7 rounded-lg bg-background border border-border/40 flex items-center justify-center text-foreground/50"><span className="text-[9px] font-bold font-mono">DTN</span></div>
                  <div className="size-7 rounded-lg bg-background border border-border/40 flex items-center justify-center text-foreground/50"><span className="text-[9px] font-bold font-mono">MDL</span></div>
                </div>
                <span className="text-xs text-muted-foreground/50">E2B &middot; Daytona &middot; Modal</span>
              </div>
              <p className="text-sm font-medium text-muted-foreground">Per-second AI Sandboxes</p>
              <p className="text-[11px] text-muted-foreground/40 mt-1">Best for burst compute, scale-to-zero, ephemeral workloads</p>
            </div>
            <div className="rounded-t-2xl border border-b-0 border-foreground/15 bg-foreground/[0.03] p-5 sm:p-6 ring-1 ring-foreground/[0.06]">
              <div className="flex items-center gap-3 mb-3">
                <div className="size-7 rounded-lg bg-foreground flex items-center justify-center">
                  <svg className="size-3.5 text-background" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
                </div>
                <span className="text-xs font-medium">JustAVPS</span>
              </div>
              <p className="text-sm font-medium">24/7 Always-On Sandbox</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">Best for persistent agents, stateful compute, predictable cost</p>
            </div>
          </div>

          {/* Price table */}
          <div className="rounded-b-2xl border border-border/40 overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground text-xs">Machine Spec</th>
                    <th className="text-right px-5 py-3 font-medium text-muted-foreground text-xs">Sandbox Platforms*</th>
                    <th className="text-right px-5 py-3 font-medium text-xs text-foreground">JustAVPS</th>
                    <th className="text-right px-5 py-3 font-medium text-xs text-green-600 dark:text-green-400">You Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  <PriceRow spec="2 vCPU / 4 GB" them="$121/mo" us="$15/mo" save="8x" />
                  <PriceRow spec="4 vCPU / 8 GB" them="$242/mo" us="$27/mo" save="9x" />
                  <PriceRow spec="8 vCPU / 16 GB" them="$483/mo" us="$49/mo" save="10x" />
                  <PriceRow spec="12 vCPU / 24 GB" them="$725/mo" us="$72/mo" save="10x" />
                  <PriceRow spec="16 vCPU / 32 GB" them="$966/mo" us="$97/mo" save="10x" />
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground/30 text-center leading-relaxed max-w-2xl mx-auto mb-10">
            * Sandbox platform prices use Daytona rates (cheapest of the three: vCPU $0.0504/h + RAM $0.0162/h/GiB) for 730 hours continuous usage.
            E2B and Modal Sandbox are typically more expensive at equivalent specs.
          </p>

          {/* Tradeoffs */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl border border-border/40 bg-gradient-to-br from-green-500/[0.02] to-transparent">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="size-5 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 dark:text-green-400 text-xs">&#10003;</span>
                When to use JustAVPS
              </h3>
              <ul className="space-y-1.5 text-[13px] text-muted-foreground leading-relaxed">
                <li>Agents that run <strong className="text-foreground/80">24/7</strong>, not minutes</li>
                <li><strong className="text-foreground/80">Stateful</strong> — persistent files, databases, Docker</li>
                <li><strong className="text-foreground/80">Predictable cost</strong> — no surprise bills</li>
                <li>SSH, browser IDE, Claude Code pre-installed</li>
              </ul>
            </div>
            <div className="p-5 rounded-2xl border border-border/40 bg-gradient-to-br from-muted/20 to-transparent">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="size-5 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground text-xs">&rarr;</span>
                When they win
              </h3>
              <ul className="space-y-1.5 text-[13px] text-muted-foreground leading-relaxed">
                <li><strong className="text-foreground/80">Burst compute</strong> — 10k sandboxes for 5 min</li>
                <li><strong className="text-foreground/80">Sub-second spin-up</strong> (200ms cold start)</li>
                <li>Elastic RL infra that <strong className="text-foreground/80">scales to zero</strong></li>
                <li>Workloads that run <strong className="text-foreground/80">minutes, not months</strong></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── API & PROXY ─── */}
      <section id="api" className="px-6 py-20 sm:py-28 border-t border-border/40 bg-muted/10">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-5 gap-10 items-start">
            <div className="md:col-span-2">
              <p className="font-mono text-[10px] text-muted-foreground/40 tracking-[0.2em] uppercase mb-3">Programmatic control</p>
              <h2 className="text-3xl font-medium tracking-tight mb-4">API &amp; Proxy</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Manage machines via REST API. Every port you run is instantly accessible
                at <code className="text-[12px] bg-muted px-1.5 py-0.5 rounded font-mono">PORT.slug.kortix.cloud</code>, authenticated by default.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Install <strong className="text-foreground/80">justavps-agent</strong> to turn any machine into an autonomous worker
                that receives tasks and reports back via webhook.
              </p>
            </div>
            <div className="md:col-span-3 space-y-3">
              <CodeBlock label="REST API" lines={[
                { c: "comment", t: "# Create a machine" },
                { c: "cmd", t: 'curl -X POST https://justavps.com/api/v1/machines \\' },
                { c: "dim", t: '  -H "Authorization: Bearer $API_KEY" \\' },
                { c: "dim", t: '  -d \'{"snapshot_id":"...","server_type":"cx22"}\'' },
                { c: "blank" },
                { c: "comment", t: "# Access any port through auth proxy" },
                { c: "cmd", t: 'curl https://8000.abc123.kortix.cloud/api \\' },
                { c: "dim", t: '  -H "Authorization: Bearer $API_KEY"' },
              ]} />
              <CodeBlock label="justavps-agent" lines={[
                { c: "prompt", t: "justavps-agent start --webhook https://app.com/tasks" },
                { c: "output", t: "Listening on https://justavps.com/agent/abc123" },
                { c: "ready", t: "Ready. Waiting for tasks..." },
              ]} />
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="relative px-6 py-24 sm:py-32 border-t border-border/40 text-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-muted/30 to-transparent" />
        <div className="relative">
          <h2 className="text-4xl sm:text-5xl font-medium tracking-tighter mb-4">
            <span className="bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent">Get a machine.</span>
          </h2>
          <p className="text-sm text-muted-foreground mb-8">Running in 60 seconds. From $15/mo. Always on.</p>
          <Link href="/machines/new" className={cn(buttonVariants({ size: "lg" }), "text-sm px-8 h-12 font-medium rounded-xl shadow-lg shadow-primary/10")}>
            Deploy now
            <svg className="ml-2 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </Link>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-border/40 px-6 py-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="size-6 rounded-md bg-foreground/10 flex items-center justify-center">
              <svg className="size-3 text-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            </div>
            <span className="text-xs text-muted-foreground/40">&copy; {new Date().getFullYear()} justavps.com &middot; by Kortix</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground/40">
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <Link href="/login" className="hover:text-foreground transition-colors">Login</Link>
            <a href="mailto:support@justavps.com" className="hover:text-foreground transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════ */

function LogoPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/30 bg-background/60 backdrop-blur-sm text-muted-foreground/60 hover:text-foreground/80 hover:border-border/60 transition-colors">
      {icon}
      <span className="text-[11px] font-medium hidden sm:inline">{label}</span>
    </div>
  );
}

function LogoChip({ icon }: { icon: React.ReactNode }) {
  return <div className="size-8 rounded-lg border border-border/30 bg-muted/30 flex items-center justify-center text-muted-foreground/50">{icon}</div>;
}

function FeatureChip({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border border-border/30 bg-background/60">
      <div className="size-9 shrink-0 rounded-lg bg-foreground/[0.04] flex items-center justify-center text-foreground/50">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground/40 truncate">{desc}</div>
      </div>
    </div>
  );
}

function PriceRow({ spec, them, us, save }: { spec: string; them: string; us: string; save: string }) {
  return (
    <tr className="group hover:bg-muted/10 transition-colors">
      <td className="px-5 py-3 text-[13px] font-mono text-muted-foreground">{spec}</td>
      <td className="px-5 py-3 text-[13px] text-right text-muted-foreground/50 line-through decoration-muted-foreground/20">{them}</td>
      <td className="px-5 py-3 text-[13px] text-right font-medium text-foreground">{us}</td>
      <td className="px-5 py-3 text-right">
        <span className="inline-flex px-2 py-0.5 rounded-full bg-green-500/10 text-[11px] font-medium text-green-600 dark:text-green-400">{save}</span>
      </td>
    </tr>
  );
}

type CL = { c: string; t?: string };

const TABS: { id: string; label: string; lines: CL[] }[] = [
  { id: "api", label: "REST API", lines: [
    { c: "comment", t: "# Create a machine" },
    { c: "cmd", t: 'curl -X POST https://justavps.com/api/v1/machines \\' },
    { c: "dim", t: '  -H "Authorization: Bearer $API_KEY" \\' },
    { c: "dim", t: '  -d \'{"snapshot_id":"...","server_type":"cx22","region":"hel1"}\'' },
    { c: "blank" },
    { c: "comment", t: "# SSH in 60 seconds later" },
    { c: "prompt", t: "ssh root@95.217.x.x" },
  ]},
  { id: "ssh", label: "SSH + Claude Code", lines: [
    { c: "prompt", t: "ssh root@95.217.x.x" },
    { c: "blank" },
    { c: "comment", t: "# Claude Code is pre-installed" },
    { c: "prompt", t: 'claude "build me a fastapi web scraper"' },
    { c: "output", t: "Creating project structure..." },
    { c: "output", t: "Writing scraper.py..." },
    { c: "ready", t: "Done. Run: python main.py" },
  ]},
  { id: "agent", label: "Agent Worker", lines: [
    { c: "prompt", t: "justavps-agent install" },
    { c: "prompt", t: "justavps-agent start --webhook https://app.com/tasks" },
    { c: "blank" },
    { c: "output", t: "Listening on https://justavps.com/agent/abc123" },
    { c: "ready", t: "Ready. Waiting for tasks..." },
  ]},
];

function CodeDemo() {
  const [tab, setTab] = useState(0);
  return (
    <div className="rounded-2xl border border-border/40 overflow-hidden bg-[--code-bg] [--code-bg:oklch(0.97_0_0)] dark:[--code-bg:oklch(0.06_0_0)] shadow-xl shadow-black/[0.03] dark:shadow-black/20">
      <div className="flex items-center border-b border-border/30 bg-muted/20">
        <div className="flex items-center gap-1.5 px-4 py-3">
          <span className="size-2.5 rounded-full bg-muted-foreground/15" />
          <span className="size-2.5 rounded-full bg-muted-foreground/15" />
          <span className="size-2.5 rounded-full bg-muted-foreground/15" />
        </div>
        <div className="flex items-center gap-0 ml-2">
          {TABS.map((t, i) => (
            <button key={t.id} onClick={() => setTab(i)} className={cn(
              "px-4 py-2.5 text-[11px] font-medium tracking-wide transition-all relative",
              i === tab ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"
            )}>
              {t.label}
              {i === tab && <span className="absolute bottom-0 inset-x-2 h-0.5 bg-foreground/60 rounded-full" />}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5 sm:p-6 font-mono text-[13px] leading-relaxed overflow-x-auto min-h-[200px]">
        {TABS[tab].lines.map((l, i) => <CLine key={`${tab}-${i}`} l={l} />)}
      </div>
    </div>
  );
}

function CLine({ l }: { l: CL }) {
  if (l.c === "blank") return <div className="h-3" />;
  if (l.c === "comment") return <div className="text-muted-foreground/35">{l.t}</div>;
  if (l.c === "cmd") return <div className="text-foreground/70">{l.t}</div>;
  if (l.c === "dim") return <div className="text-foreground/45">{l.t}</div>;
  if (l.c === "prompt") return <div className="text-foreground/70"><span className="text-green-600 dark:text-green-400/70">$</span> {l.t}</div>;
  if (l.c === "output") return <div className="text-blue-600 dark:text-blue-400/60">{l.t}</div>;
  if (l.c === "ready") return <div className="text-blue-600 dark:text-blue-400/60">{l.t}<span className="inline-block w-1.5 h-4 bg-foreground/40 animate-pulse ml-1 align-text-bottom" /></div>;
  return <div>{l.t}</div>;
}

function CodeBlock({ label, lines }: { label: string; lines: CL[] }) {
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden bg-[--code-bg] [--code-bg:oklch(0.97_0_0)] dark:[--code-bg:oklch(0.06_0_0)]">
      <div className="px-4 py-2 border-b border-border/30 bg-muted/20">
        <span className="font-mono text-[10px] text-muted-foreground/40 tracking-wider uppercase">{label}</span>
      </div>
      <div className="p-4 font-mono text-[13px] leading-relaxed overflow-x-auto">
        {lines.map((l, i) => <CLine key={i} l={l} />)}
      </div>
    </div>
  );
}
