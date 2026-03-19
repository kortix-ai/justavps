"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { Logo } from "@/components/logo";
import { TbApi, TbBolt } from "react-icons/tb";
import { SiPython, SiTypescript } from "react-icons/si";
import { CheckoutModal } from "@/components/checkout-modal";

/* ═══ LOGOS ═══ */
const LogoClaude = () => <svg viewBox="0 0 40 40" className="size-5" fill="currentColor"><path d="M26.957 9.882h-4.83l8.649 21.903h4.716L26.957 9.882ZM13.028 9.882L4.492 31.785h4.83l1.908-4.606h8.986l1.796 4.493h4.832L18.083 9.882h-5.055Zm-.45 13.254l2.92-7.751 3.034 7.751h-5.954Z" /></svg>;
const LogoOpenCode = () => <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path opacity="0.3" d="M19.2 17.4H8.4V13.8H15.6V10.2H19.2V17.4ZM8.4 13.8H4.8V10.2H8.4V13.8Z" /><path d="M8.4 17.4H19.2V21H4.8V13.8H8.4V17.4ZM15.6 10.2V13.8H8.4V10.2H15.6ZM19.2 10.2H15.6V6.6H4.8V3H19.2V10.2Z" /></svg>;
const LogoCursor = () => <svg viewBox="0 0 500 545" className="size-5" fill="currentColor"><path d="m466.383 137.073-206.469-119.203c-6.63-3.829-14.811-3.829-21.441 0L31.914 137.073c-5.573 3.218-9.014 9.169-9.014 15.615v240.375c0 6.436 3.441 12.397 9.014 15.615l206.469 119.203c6.63 3.829 14.811 3.829 21.441 0l206.468-119.203c5.574-3.218 9.015-9.17 9.015-15.615v-240.375c0-6.436-3.441-12.397-9.015-15.615zm-12.969 25.25-199.316 345.223c-1.347 2.326-4.904 1.376-4.904-1.319V280.179c0-4.517-2.414-8.695-6.33-10.963L47.107 156.197c-2.326-1.347-1.376-4.905 1.318-4.905h398.631c5.661 0 9.199 6.136 6.368 11.041h-.01z" /></svg>;
const LogoVSCode = () => <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M17.583 2.27l-7.154 6.52L5.51 4.835 3 5.98v12.04l2.51 1.145 4.919-3.955 7.154 6.52L21 20.27V3.73l-3.417-1.46zM5 15.15V8.85l3.25 3.15L5 15.15zm12.583 2.57l-5.25-4.72 5.25-4.72v9.44z" /></svg>;
const LogoDocker = () => <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186h-2.118a.186.186 0 00-.187.186v1.886c0 .103.084.186.187.186zm-2.954-5.43h2.118a.186.186 0 00.187-.185V3.577a.186.186 0 00-.187-.186h-2.118a.186.186 0 00-.187.186v1.886c0 .102.084.186.185.186zm0 2.716h2.118a.187.187 0 00.187-.186V6.292a.187.187 0 00-.187-.186h-2.118a.187.187 0 00-.187.186v1.886c0 .103.084.186.186.186zm-2.93 0h2.12a.186.186 0 00.186-.186V6.292a.186.186 0 00-.186-.186h-2.12a.186.186 0 00-.185.186v1.886c0 .103.083.186.185.186zm-2.964 0h2.119a.186.186 0 00.185-.186V6.292a.186.186 0 00-.185-.186H5.136a.186.186 0 00-.186.186v1.886c0 .103.084.186.186.186zm-2.928 0h2.119a.186.186 0 00.186-.186V6.292a.186.186 0 00-.186-.186H2.208a.186.186 0 00-.186.186v1.886c0 .103.083.186.186.186zM23.763 11.36c-.006-.004-.54-.39-1.583-.39-.265 0-.53.024-.79.07-.28-1.805-1.885-2.686-1.95-2.72l-.392-.218-.234.38c-.297.486-.503 1.036-.605 1.606-.22.976-.082 1.892.389 2.676-.578.338-1.52.42-1.71.426H.828a.83.83 0 00-.83.828c-.025 1.597.218 3.19.727 4.697.577 1.614 1.44 2.803 2.564 3.533 1.264.82 3.324 1.288 5.622 1.288.966 0 1.945-.087 2.907-.27a12.258 12.258 0 003.525-1.245 9.741 9.741 0 002.552-2.07c1.227-1.395 1.96-2.955 2.505-4.33h.218c1.35 0 2.182-.542 2.64-1 .3-.3.528-.654.67-1.046l.094-.296-.366-.214z" /></svg>;

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Toggle theme">
      {theme === "dark" ? (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
      ) : (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
      )}
    </button>
  );
}

/* ═══════════════════════ PAGE ═══════════════════════ */
export default function Home() {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [showFloatingCta, setShowFloatingCta] = useState(false);
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  useEffect(() => {
    const handleScroll = () => {
      setShowFloatingCta(window.scrollY > 400);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
      {/* NAV */}
      <nav className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="relative max-w-5xl mx-auto flex items-center justify-between h-12 px-6">
          <Logo />
          <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
            <a href="#use-cases" className="px-3 py-1 text-[12.5px] text-muted-foreground/80 hover:text-foreground rounded-md hover:bg-muted/40 transition-all duration-150">Use Cases</a>
            <a href="#api" className="px-3 py-1 text-[12.5px] text-muted-foreground/80 hover:text-foreground rounded-md hover:bg-muted/40 transition-all duration-150">API</a>
            <a href="#pricing" className="px-3 py-1 text-[12.5px] text-muted-foreground/80 hover:text-foreground rounded-md hover:bg-muted/40 transition-all duration-150">Pricing</a>
            <Link href="/docs" className="px-3 py-1 text-[12.5px] text-muted-foreground/80 hover:text-foreground rounded-md hover:bg-muted/40 transition-all duration-150">Docs</Link>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <div className="w-px h-4 bg-border/60 mx-1.5 hidden sm:block" />
            {isLoggedIn ? (
              <Link href="/machines" className={cn(buttonVariants({ size: "sm" }), "h-7 text-[12.5px] px-3 hidden sm:inline-flex")}>Dashboard</Link>
            ) : (
              <>
                <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 text-[12.5px] px-2.5 text-muted-foreground hover:text-foreground hidden sm:inline-flex")}>Log in</Link>
                <button onClick={() => setCheckoutOpen(true)} className={cn(buttonVariants({ size: "sm" }), "h-7 text-[12.5px] px-3 hidden sm:inline-flex")}>Get started</button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative px-6 pt-20 pb-16 sm:pt-28 sm:pb-20 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:72px_72px] opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
        </div>
        <div className="relative max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card mb-6">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
            <span className="text-xs font-medium text-foreground">24/7 Always On</span>
          </div>
          <h1 className="text-5xl sm:text-7xl lg:text-8xl font-medium tracking-tighter leading-[0.88]">AI Sandbox</h1>
          <p className="mt-3 text-lg sm:text-2xl tracking-tight text-muted-foreground">
            ...and it&apos;s <span className="text-foreground font-medium">justavps :)</span>
          </p>
          <p className="mt-5 text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            A persistent, always-on machine for AI agents that never stop running. Long-lived sandboxes with full SSH, Docker, and filesystem. <strong className="text-foreground">10x cheaper. Secure. Stateful.</strong>
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <button onClick={() => setCheckoutOpen(true)} className={cn(buttonVariants({ size: "lg" }), "text-sm px-7 h-12 font-medium rounded-xl")}>
              Get a machine — from $15/mo <svg className="ml-2 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
            <Link href="/docs" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "text-sm px-7 h-12 font-medium rounded-xl")}>Docs</Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Running in 60 seconds. Cancel anytime. No credit card lock-in.</p>
          <div className="mt-8 flex items-center justify-center gap-1.5 flex-wrap">
            <LogoPill icon={<LogoClaude />} label="Claude Code" />
            <LogoPill icon={<LogoOpenCode />} label="OpenCode" />
            <LogoPill icon={<LogoCursor />} label="Cursor" />
            <LogoPill icon={<LogoVSCode />} label="VS Code" />
            <LogoPill icon={<LogoDocker />} label="Docker" />
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF BAR — TODO: uncomment when we have real numbers
      <section className="px-6 py-8 border-t border-border">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          <ProofStat value="99.9%" label="uptime SLA" />
          <div className="w-px h-8 bg-border hidden sm:block" />
          <ProofStat value="<60s" label="deploy time" />
          <div className="w-px h-8 bg-border hidden sm:block" />
          <ProofStat value="10x" label="cheaper than alternatives" />
          <div className="w-px h-8 bg-border hidden sm:block" />
          <ProofStat value="0" label="open ports by default" />
        </div>
      </section>
      */}

      {/* USE CASES — Outcome-focused */}
      <section id="use-cases" className="px-6 py-16 sm:py-20 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <SectionHead
            title="Ship faster. Run agents 24/7. Never lose state."
            desc="A persistent computer for your AI agent — daily backups, authenticated proxy on every port, any coding agent you want."
          />

          <div className="grid md:grid-cols-2 gap-4 mt-10">
            <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
              <div className="p-6 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-medium">Close your laptop. Keep shipping.</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-muted border border-border text-[10px] font-medium text-muted-foreground">PERSONAL</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your AI agent keeps coding while you sleep, commute, or touch grass. Perfect internet, zero battery drain, no dropped SSH connections — ever.
                </p>
                <div className="mt-4 flex items-center gap-1.5">
                  <Chip><LogoClaude /></Chip><Chip><LogoCursor /></Chip><Chip><LogoVSCode /></Chip>
                  <span className="text-xs text-muted-foreground ml-1.5">+ any SSH client</span>
                </div>
              </div>
              <div className="border-t border-border bg-muted p-4 font-mono text-xs leading-relaxed">
                <div className="text-muted-foreground"># SSH in, start coding</div>
                <div className="mt-1"><span className="text-green-600 dark:text-green-400">$</span> <span className="text-foreground">ssh root@95.217.x.x</span></div>
                <div className="mt-1"><span className="text-green-600 dark:text-green-400">$</span> <span className="text-foreground">claude &quot;build me a fastapi scraper&quot;</span></div>
                <div className="mt-1 text-blue-600 dark:text-blue-400">Done. Run: python main.py<span className="inline-block w-1.5 h-3 bg-foreground animate-pulse ml-0.5 align-text-bottom" /></div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
              <div className="p-6 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-medium">Give every user their own sandbox.</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-muted border border-border text-[10px] font-medium text-muted-foreground">SERVICE</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Provision sandboxes via SDK. Files, Bash, and CUA APIs. One API key. Agent API for Claude Code, OpenCode, and Codex — sessions included.
                </p>
                <div className="mt-4 flex items-center gap-1.5">
                  <Chip><LogoClaude /></Chip><Chip><LogoOpenCode /></Chip><Chip><TbApi className="size-5" /></Chip>
                  <span className="text-xs text-muted-foreground ml-1.5">Python · TypeScript · REST</span>
                </div>
              </div>
              <div className="border-t border-border bg-muted p-4 font-mono text-xs leading-relaxed">
                <div className="text-muted-foreground"># pip install kortix-justavps</div>
                <div className="mt-1"><span className="text-blue-600 dark:text-blue-400">from</span> <span className="text-foreground">justavps</span> <span className="text-blue-600 dark:text-blue-400">import</span> <span className="text-foreground">JustAVPS</span></div>
                <div className="mt-1 text-foreground">vps = JustAVPS(api_key=<span className="text-amber-600 dark:text-amber-400">&quot;sk-...&quot;</span>)</div>
                <div className="mt-1 text-foreground">sandbox = vps.create(type=<span className="text-amber-600 dark:text-amber-400">&quot;cpx32&quot;</span>)</div>
                <div className="mt-1 text-foreground">sandbox.exec(<span className="text-amber-600 dark:text-amber-400">&quot;claude &#39;build a REST API&#39;&quot;</span>)</div>
                <div className="mt-1 text-foreground">sandbox.url(<span className="text-amber-600 dark:text-amber-400">8000</span>) <span className="text-muted-foreground"># → https://8000.abc123.justavps.com</span></div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-1.5 justify-center">
            {["SSH","Web Terminal","Browser IDE","Daily Backups","API Key Auth","FS API","Bash API","Computer Use API","Claude Code","OpenCode","Codex","Any Agent"].map(f => (
              <span key={f} className="px-2.5 py-1 rounded-full border border-border bg-card text-xs text-muted-foreground font-medium">{f}</span>
            ))}
          </div>

          {/* Mid-page CTA — catch momentum */}
          <div className="mt-10 text-center">
            <button onClick={() => setCheckoutOpen(true)} className={cn(buttonVariants({ size: "lg" }), "text-sm px-7 h-11 font-medium rounded-xl")}>
              Get your machine <svg className="ml-2 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
            <p className="mt-2 text-xs text-muted-foreground">Deploys in under 60 seconds</p>
          </div>
        </div>
      </section>

      {/* SECURE BY DEFAULT */}
      <section className="px-6 py-12 sm:py-14 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className="size-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                <svg className="size-5 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              </div>
              <div className="flex-1">
                <h3 className="text-base font-medium mb-1">Secure by default. Zero config needed.</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every port on your sandbox is proxied through <span className="text-foreground font-mono text-xs">{`{port}-{id}.justavps.com`}</span>. Log in via the web dashboard, SSH in with your key, or authenticate programmatically with your API key. No open ports, no accidental exposure.
                </p>
              </div>
              <div className="shrink-0 hidden sm:flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs font-medium text-green-600 dark:text-green-400">Auth Proxy</span>
                <span className="px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs font-medium text-green-600 dark:text-green-400">SSH Keys</span>
                <span className="px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs font-medium text-green-600 dark:text-green-400">API Keys</span>
                <span className="px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs font-medium text-green-600 dark:text-green-400">Zero Open Ports</span>
              </div>
            </div>
            <div className="border-t border-border bg-muted px-6 sm:px-8 py-3 font-mono text-xs text-muted-foreground leading-relaxed">
              <span className="text-green-600 dark:text-green-400">$</span> curl <span className="text-foreground">https://8000-abc123.justavps.com</span> -H <span className="text-amber-600 dark:text-amber-400">&quot;Authorization: Bearer sk-...&quot;</span>
            </div>
          </div>
        </div>
      </section>

      {/* API */}
      <section id="api" className="px-6 py-16 sm:py-20 border-t border-border">
        <div className="max-w-5xl mx-auto"><ApiOverview /></div>
      </section>

      {/* PROBLEM — Loss Aversion Section */}
      <section className="px-6 py-12 sm:py-16 border-t border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">You&apos;re paying 10x too much for always-on agents.</h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Per-second billing sounds cheap until your agent runs 24/7. A 4 vCPU sandbox on E2B or Daytona costs <strong className="text-foreground">$242/mo</strong>. The same machine on JustAVPS? <strong className="text-foreground">$27/mo</strong>. That&apos;s $2,580/year you&apos;re throwing away — per machine.
          </p>
          <button onClick={() => setCheckoutOpen(true)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-5 text-xs")}>
            Stop overpaying <svg className="ml-1.5 size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      </section>

      {/* PRICING — Loss-aversion framing */}
      <section id="pricing" className="px-6 py-16 sm:py-20 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <SectionHead
            title="Stop burning money on per-second billing."
            desc="Per-second sandboxes are designed for 5-minute runs. For agents that work 24/7, you're overpaying by 10x. Here's proof."
          />

          <div className="rounded-2xl border border-border overflow-hidden mt-10 mb-6">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="text-left px-5 py-3.5 text-xs font-medium text-muted-foreground">Machine</th>
                  <th className="text-right px-5 py-3.5 text-xs font-medium text-muted-foreground">
                    <span className="hidden sm:inline">E2B / Daytona / Modal *</span>
                    <span className="sm:hidden">Others *</span>
                  </th>
                  <th className="text-right px-5 py-3.5 text-xs font-medium text-foreground">JustAVPS</th>
                  <th className="text-right px-5 py-3.5 text-xs font-medium text-foreground">You Save</th>
                </tr>
              </thead>
              <tbody>
                <CmpRow spec="2 vCPU / 4 GB" them="$121/mo" us="$15/mo" save="8x" />
                <CmpRow spec="4 vCPU / 8 GB" them="$242/mo" us="$27/mo" save="9x" highlight />
                <CmpRow spec="8 vCPU / 16 GB" them="$483/mo" us="$49/mo" save="10x" />
                <CmpRow spec="16 vCPU / 32 GB" them="$966/mo" us="$97/mo" save="10x" />
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground mb-10">
            * Daytona rates (cheapest): vCPU $0.0504/h + RAM $0.0162/h/GiB × 730h continuous usage.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-5 rounded-xl border-2 border-primary/50 bg-card relative">
              <span className="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-semibold rounded-full">RECOMMENDED</span>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2 mt-1">
                <span className="size-5 rounded-full bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 text-[10px]">✓</span>
                Use JustAVPS when
              </h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li>Your agents run <strong className="text-foreground">24/7</strong>, not minutes</li>
                <li>You need <strong className="text-foreground">persistent state</strong> — files, Docker, DBs</li>
                <li>You want <strong className="text-foreground">predictable cost</strong>, no bill shock</li>
              </ul>
            </div>
            <div className="p-5 rounded-xl border border-border bg-card">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="size-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-[10px]">→</span>
                Use them when
              </h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li>Sandboxes only live <strong className="text-foreground">minutes</strong>, not months</li>
                <li>You need <strong className="text-foreground">sub-second spin-up</strong> and instant teardown</li>
                <li>You only pay when code is <strong className="text-foreground">actively running</strong></li>
              </ul>
            </div>
          </div>

          {/* Post-pricing CTA */}
          <div className="mt-10 text-center">
            <button onClick={() => setCheckoutOpen(true)} className={cn(buttonVariants({ size: "lg" }), "text-sm px-7 h-12 font-medium rounded-xl")}>
              Get a machine — from $15/mo <svg className="ml-2 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </section>

      {/* OBJECTION HANDLING — Risk Reversal */}
      <section className="px-6 py-16 sm:py-20 border-t border-border">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight text-center mb-10">Still on the fence?</h2>
          <div className="space-y-4">
            <Objection q="What if I don't like it?" a="Cancel anytime. No contracts, no lock-in. Your data is yours — download it and leave whenever you want." />
            <Objection q="Is it really cheaper?" a="Do the math yourself. Daytona charges $0.0504/h per vCPU + $0.0162/h per GiB RAM. Run that 24/7 for a month and compare. We're 8–10x cheaper, every time." />
            <Objection q="How fast can I get started?" a="Under 60 seconds. Pick a plan, we provision your machine, you SSH in. That's it." />
            <Objection q="What about security?" a="Every port is behind an authenticated proxy by default. Zero open ports. API key or session token required for every request. No config needed." />
            <Objection q="Can I run any agent?" a="Claude Code, OpenCode, Cursor, Codex, Amp — anything that runs on Linux. It's just a VPS with superpowers." />
          </div>
        </div>
      </section>

      {/* FINAL CTA — Urgency + Value Stack */}
      <section className="px-6 py-20 sm:py-28 border-t border-border text-center">
        <h2 className="text-3xl sm:text-4xl font-medium tracking-tighter mb-3">Every hour without a machine is wasted compute.</h2>
        <p className="text-sm text-muted-foreground mb-2 max-w-md mx-auto">Your competitors&apos; agents are running right now. Yours should be too.</p>
        <p className="text-xs text-muted-foreground mb-6">From $15/mo · Deploys in 60s · Cancel anytime</p>
        <button onClick={() => setCheckoutOpen(true)} className={cn(buttonVariants({ size: "lg" }), "text-sm px-8 h-12 font-medium rounded-xl")}>
          Deploy now <svg className="ml-2 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">© {new Date().getFullYear()} justavps.com · by Kortix</span>
          <div className="flex items-center gap-5 text-xs text-muted-foreground">
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            {isLoggedIn
              ? <Link href="/machines" className="hover:text-foreground transition-colors">Dashboard</Link>
              : <Link href="/login" className="hover:text-foreground transition-colors">Login</Link>
            }
            <a href="mailto:support@justavps.com" className="hover:text-foreground transition-colors">Support</a>
          </div>
        </div>
      </footer>

      {/* FLOATING SCROLL CTA — Price-anchored, centered */}
      <div
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-1.5 pl-5 py-1.5 rounded-full border border-border bg-background/95 backdrop-blur-md transition-all duration-300",
          showFloatingCta ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0 pointer-events-none"
        )}
      >
        <span className="text-xs text-muted-foreground hidden sm:inline">From <strong className="text-foreground">$15/mo</strong></span>
        <button
          onClick={() => setCheckoutOpen(true)}
          className={cn(buttonVariants({ size: "sm" }), "rounded-full h-9 px-5 text-sm font-medium")}
        >
          GET MACHINE
          <svg className="ml-1.5 size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════ COMPONENTS ═══════════════════════ */

function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-xl leading-relaxed">{desc}</p>
    </div>
  );
}

function LogoPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-colors">
      {icon}<span className="text-[11px] font-medium hidden sm:inline">{label}</span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <div className="size-8 rounded-lg border border-border bg-muted flex items-center justify-center text-muted-foreground">{children}</div>;
}

function ProofStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function CmpRow({ spec, them, us, save, highlight }: { spec: string; them: string; us: string; save: string; highlight?: boolean }) {
  return (
    <tr className={cn("border-b border-border last:border-0 transition-colors", highlight ? "bg-primary/5" : "hover:bg-muted/50")}>
      <td className="px-5 py-3.5 text-sm font-mono text-foreground">
        {spec}
        {highlight && <span className="ml-2 text-[10px] font-sans font-medium text-primary">POPULAR</span>}
      </td>
      <td className="px-5 py-3.5 text-sm text-right text-muted-foreground line-through decoration-muted-foreground/40">{them}</td>
      <td className="px-5 py-3.5 text-sm text-right font-medium text-foreground">{us}</td>
      <td className="px-5 py-3.5 text-right">
        <span className="inline-flex px-2 py-0.5 rounded-full bg-green-500/20 text-xs font-medium text-green-600 dark:text-green-400">{save} cheaper</span>
      </td>
    </tr>
  );
}

function Objection({ q, a }: { q: string; a: string }) {
  return (
    <div className="p-5 rounded-xl border border-border bg-card">
      <h3 className="text-sm font-medium text-foreground mb-1.5">{q}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
    </div>
  );
}

/* ═══ API SECTION ═══ */

const API_GROUPS = [
  {
    title: "Machine",
    icon: <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>,
    ops: [
      { method: "POST", label: "Create a machine" },
      { method: "GET", label: "List all machines" },
      { method: "GET", label: "Get machine details" },
      { method: "POST", label: "Rebuild a machine" },
      { method: "DEL", label: "Delete a machine" },
      { method: "POST", label: "Create a snapshot" },
      { method: "GET", label: "List snapshots" },
    ],
  },
  {
    title: "Filesystem",
    icon: <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>,
    ops: [
      { method: "GET", label: "List files in a directory" },
      { method: "GET", label: "Download a file" },
      { method: "POST", label: "Upload a file" },
      { method: "POST", label: "Create a directory" },
      { method: "DEL", label: "Delete a file or directory" },
      { method: "POST", label: "Move or rename" },
      { method: "GET", label: "Search text in files" },
      { method: "POST", label: "Find and replace" },
      { method: "POST", label: "Download as zip" },
    ],
  },
  {
    title: "Process",
    icon: <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>,
    ops: [
      { method: "POST", label: "Execute a shell command" },
      { method: "POST", label: "Execute with streaming" },
      { method: "POST", label: "Run a code snippet" },
      { method: "GET", label: "List running processes" },
      { method: "POST", label: "Kill a process" },
    ],
  },
  {
    title: "Coding Agents",
    icon: <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M12 2a4 4 0 014 4v1H8V6a4 4 0 014-4zM7 15h.01M12 15h.01M10 14L21 3" /></svg>,
    external: "https://sandboxagent.dev",
    agentFeatures: ["Universal Agent API", "Session Management", "Streaming Events & Chat"],
  },
];

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "text-green-600 dark:text-green-400 bg-green-500/10",
    POST: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
    DEL: "text-red-600 dark:text-red-400 bg-red-500/10",
  };
  return <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold leading-none", colors[method])}>{method}</span>;
}



function ApiOverview() {
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <SectionHead title="Programmatic Control." desc="Machine, Process, Filesystem, and Coding Agents — everything via API." />
          <div className="flex items-center gap-2 mt-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-colors">
              <SiPython className="size-4" /><span className="text-[11px] font-medium">Python SDK</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-colors">
              <SiTypescript className="size-4" /><span className="text-[11px] font-medium">TypeScript SDK</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-colors">
              <TbBolt className="size-4" /><span className="text-[11px] font-medium">REST API</span>
            </span>
          </div>
        </div>
        <Link href="/api/docs" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 text-xs gap-1.5")}>
          Full API Reference <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {API_GROUPS.map((group) => (
          <div key={group.title} className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
            <div className="p-4 pb-3 flex items-center gap-2.5 border-b border-border">
              <span className="text-muted-foreground">{group.icon}</span>
              <h3 className="text-sm font-medium">{group.title}</h3>
              {"ops" in group && group.ops && <span className="ml-auto text-[10px] text-muted-foreground font-medium">{group.ops.length}</span>}
            </div>
            {"external" in group ? (
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Control Claude Code, Codex, OpenCode, and Amp with one unified API. Ships out of the box on every sandbox.
                  </p>
                  {"agentFeatures" in group && group.agentFeatures && (
                    <div className="mt-3 space-y-1">
                      {group.agentFeatures.map((f: string) => (
                        <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="size-1 rounded-full bg-foreground/30 shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <a href={group.external} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:underline">
                  sandboxagent.dev <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                </a>
              </div>
            ) : (
              <div className="p-2 flex-1">
                <div className="space-y-0.5">
                  {group.ops.map((op) => (
                    <div key={op.label} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors">
                      <MethodBadge method={op.method} />
                      <span className="text-xs text-muted-foreground">{op.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
