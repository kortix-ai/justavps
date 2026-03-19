"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { Logo } from "@/components/logo";
import { SiPython, SiTypescript } from "react-icons/si";
import { TbApi } from "react-icons/tb";
import { CheckoutModal } from "@/components/checkout-modal";

/* ═══ LOGOS ═══ */
const LogoClaude = () => <svg viewBox="0 0 40 40" className="size-5" fill="currentColor"><path d="M26.957 9.882h-4.83l8.649 21.903h4.716L26.957 9.882ZM13.028 9.882L4.492 31.785h4.83l1.908-4.606h8.986l1.796 4.493h4.832L18.083 9.882h-5.055Zm-.45 13.254l2.92-7.751 3.034 7.751h-5.954Z" /></svg>;
const LogoOpenCode = () => <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path opacity="0.3" d="M19.2 17.4H8.4V13.8H15.6V10.2H19.2V17.4ZM8.4 13.8H4.8V10.2H8.4V13.8Z" /><path d="M8.4 17.4H19.2V21H4.8V13.8H8.4V17.4ZM15.6 10.2V13.8H8.4V10.2H15.6ZM19.2 10.2H15.6V6.6H4.8V3H19.2V10.2Z" /></svg>;
const LogoCursor = () => <svg viewBox="0 0 500 545" className="size-5" fill="currentColor"><path d="m466.383 137.073-206.469-119.203c-6.63-3.829-14.811-3.829-21.441 0L31.914 137.073c-5.573 3.218-9.014 9.169-9.014 15.615v240.375c0 6.436 3.441 12.397 9.014 15.615l206.469 119.203c6.63 3.829 14.811 3.829 21.441 0l206.468-119.203c5.574-3.218 9.015-9.17 9.015-15.615v-240.375c0-6.436-3.441-12.397-9.015-15.615zm-12.969 25.25-199.316 345.223c-1.347 2.326-4.904 1.376-4.904-1.319V280.179c0-4.517-2.414-8.695-6.33-10.963L47.107 156.197c-2.326-1.347-1.376-4.905 1.318-4.905h398.631c5.661 0 9.199 6.136 6.368 11.041h-.01z" /></svg>;
const LogoVSCode = () => <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M17.583 2.27l-7.154 6.52L5.51 4.835 3 5.98v12.04l2.51 1.145 4.919-3.955 7.154 6.52L21 20.27V3.73l-3.417-1.46zM5 15.15V8.85l3.25 3.15L5 15.15zm12.583 2.57l-5.25-4.72 5.25-4.72v9.44z" /></svg>;
const LogoDocker = () => <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186h-2.119a.186.186 0 00-.187.186v1.886c0 .103.084.186.187.186zm-2.954-5.43h2.118a.186.186 0 00.187-.185V3.577a.186.186 0 00-.187-.186h-2.118a.186.186 0 00-.187.186v1.886c0 .102.084.185.187.185zm0 2.716h2.118a.187.187 0 00.187-.186V6.292a.187.187 0 00-.187-.186h-2.118a.187.187 0 00-.187.186v1.886c0 .103.084.186.187.186zm-2.93 0h2.12a.186.186 0 00.186-.186V6.292a.186.186 0 00-.186-.186h-2.12a.186.186 0 00-.185.186v1.886c0 .103.083.186.185.186zm-2.964 0h2.119a.186.186 0 00.185-.186V6.292a.186.186 0 00-.185-.186H5.136a.186.186 0 00-.186.186v1.886c0 .103.084.186.186.186zm5.893 2.715h2.118a.186.186 0 00.187-.186V9.006a.186.186 0 00-.187-.186h-2.118a.186.186 0 00-.187.186v1.886c0 .103.084.186.187.186zm-2.93 0h2.12a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186h-2.12a.186.186 0 00-.185.186v1.886c0 .103.083.186.185.186zm-2.964 0h2.119a.186.186 0 00.185-.186V9.006a.186.186 0 00-.185-.186H5.136a.186.186 0 00-.186.186v1.886c0 .103.084.186.186.186zm-2.928 0h2.119a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186H2.208a.186.186 0 00-.186.186v1.886c0 .103.083.186.186.186zM23.763 11.36c-.006-.004-.54-.39-1.583-.39-.265 0-.53.024-.79.07-.28-1.805-1.885-2.686-1.95-2.72l-.392-.218-.234.38c-.297.486-.503 1.036-.605 1.606-.22.976-.082 1.892.389 2.676-.578.338-1.52.42-1.71.426H.828a.83.83 0 00-.83.828c-.025 1.597.218 3.19.727 4.697.577 1.614 1.44 2.803 2.564 3.533 1.264.82 3.324 1.288 5.622 1.288.966 0 1.945-.087 2.907-.27a12.258 12.258 0 003.525-1.245 9.741 9.741 0 002.552-2.07c1.227-1.395 1.96-2.955 2.505-4.33h.218c1.35 0 2.182-.542 2.64-1 .3-.3.528-.654.67-1.046l.094-.296-.366-.214z" /></svg>;

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
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
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
            ...but it&apos;s <span className="text-foreground font-medium">justavps</span>
          </p>
          <p className="mt-5 text-sm sm:text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
            Persistent, 24/7 always-on infrastructure for AI agent sandboxes. <strong className="text-foreground">10x cheaper.</strong>
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <button onClick={() => setCheckoutOpen(true)} className={cn(buttonVariants({ size: "lg" }), "text-sm px-7 h-12 font-medium rounded-xl")}>
              Get a machine <svg className="ml-2 size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
            <Link href="/docs" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "text-sm px-7 h-12 font-medium rounded-xl")}>Docs</Link>
          </div>
          <div className="mt-8 flex items-center justify-center gap-1.5 flex-wrap">
            <LogoPill icon={<LogoClaude />} label="Claude Code" />
            <LogoPill icon={<LogoOpenCode />} label="OpenCode" />
            <LogoPill icon={<LogoCursor />} label="Cursor" />
            <LogoPill icon={<LogoVSCode />} label="VS Code" />
            <LogoPill icon={<LogoDocker />} label="Docker" />
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section id="use-cases" className="px-6 py-16 sm:py-20 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <SectionHead
            title="Use it personally. Or build a service on it."
            desc="A 24/7 stateful computer for your AI agent — with daily backups, authenticated proxy on every port, and any coding agent of your choice."
          />

          <div className="grid md:grid-cols-2 gap-4 mt-10">
            <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
              <div className="p-6 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-medium">Your Dev Environment</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-muted border border-border text-[10px] font-medium text-muted-foreground">PERSONAL</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  SSH in from Cursor or VS Code. Run Claude Code, OpenCode, or any agent — 24/7 while you sleep.
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
                  <h3 className="text-base font-medium">Build a Service on It</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-muted border border-border text-[10px] font-medium text-muted-foreground">SERVICE</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Provision sandboxes via SDK. Each gets FS API, Bash API, Computer Use API, coding agents — all behind an authenticated proxy.
                </p>
                <div className="mt-4 flex items-center gap-1.5">
                  <Chip><LogoDocker /></Chip>
                  <span className="text-xs text-muted-foreground ml-1.5">Python · TypeScript · REST</span>
                </div>
              </div>
              <div className="border-t border-border bg-muted p-4 font-mono text-xs leading-relaxed">
                <div className="text-muted-foreground"># pip install justavps</div>
                <div className="mt-1"><span className="text-blue-600 dark:text-blue-400">from</span> <span className="text-foreground">justavps</span> <span className="text-blue-600 dark:text-blue-400">import</span> <span className="text-foreground">JustAVPS</span></div>
                <div className="mt-1 text-foreground">sandbox = JustAVPS().create(type=<span className="text-amber-600 dark:text-amber-400">&quot;cpx32&quot;</span>)</div>
                <div className="mt-1 text-foreground">sandbox.exec(<span className="text-amber-600 dark:text-amber-400">&quot;echo hello&quot;</span>)</div>
                <div className="mt-1 text-foreground">sandbox.url(<span className="text-amber-600 dark:text-amber-400">8000</span>) <span className="text-muted-foreground"># → https://8000.abc123.kortix.cloud</span></div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-1.5 justify-center">
            {["SSH","Web Terminal","Browser IDE","Daily Backups","Secure Auth","Proxy","FS API","Bash API","Computer Use API","Coding Agents SDK","Docker","Any Agent"].map(f => (
              <span key={f} className="px-2.5 py-1 rounded-full border border-border bg-card text-xs text-muted-foreground font-medium">{f}</span>
            ))}
          </div>
        </div>
      </section>

      {/* API */}
      <section id="api" className="px-6 py-16 sm:py-20 border-t border-border">
        <div className="max-w-5xl mx-auto"><ApiCode /></div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="px-6 py-16 sm:py-20 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <SectionHead
            title="The right provider for a 24/7 AI computer."
            desc="Per-second sandboxes are built for burst compute. For agents that run all day, every day, that model breaks down."
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
                  <th className="text-right px-5 py-3.5 text-xs font-medium text-foreground">Savings</th>
                </tr>
              </thead>
              <tbody>
                <CmpRow spec="2 vCPU / 4 GB" them="$121/mo" us="$15/mo" save="8x" />
                <CmpRow spec="4 vCPU / 8 GB" them="$242/mo" us="$27/mo" save="9x" />
                <CmpRow spec="8 vCPU / 16 GB" them="$483/mo" us="$49/mo" save="10x" />
                <CmpRow spec="16 vCPU / 32 GB" them="$966/mo" us="$97/mo" save="10x" />
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground mb-10">
            * Daytona rates (cheapest): vCPU $0.0504/h + RAM $0.0162/h/GiB × 730h continuous usage.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-5 rounded-xl border border-border bg-card">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="size-5 rounded-full bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 text-[10px]">✓</span>
                Use JustAVPS when
              </h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li>Your agents run <strong className="text-foreground">24/7</strong>, not minutes</li>
                <li>You need <strong className="text-foreground">persistent state</strong> — files, Docker, DBs</li>
                <li>You want <strong className="text-foreground">predictable cost</strong>, no surprises</li>
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
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 sm:py-28 border-t border-border text-center">
        <h2 className="text-3xl sm:text-4xl font-medium tracking-tighter mb-3">Get a machine.</h2>
        <p className="text-sm text-muted-foreground mb-6">Running in 60 seconds. From $15/mo. Always on.</p>
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

function CmpRow({ spec, them, us, save }: { spec: string; them: string; us: string; save: string }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
      <td className="px-5 py-3.5 text-sm font-mono text-foreground">{spec}</td>
      <td className="px-5 py-3.5 text-sm text-right text-muted-foreground">{them}</td>
      <td className="px-5 py-3.5 text-sm text-right font-medium text-foreground">{us}</td>
      <td className="px-5 py-3.5 text-right">
        <span className="inline-flex px-2 py-0.5 rounded-full bg-green-500/20 text-xs font-medium text-green-600 dark:text-green-400">{save} cheaper</span>
      </td>
    </tr>
  );
}

/* ═══ API SECTION ═══ */
const IconPy = () => <SiPython className="size-4" />;
const IconTS = () => <SiTypescript className="size-4" />;
const IconREST = () => <TbApi className="size-[18px]" />;

const API_SECTIONS = [
  { id: "machine", label: "Machine",
    icon: <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>,
    desc: "Create, snapshot, resize, destroy sandboxes via SDK.",
    py: [`from justavps import JustAVPS`,``,`client = JustAVPS()`,``,`# Create a sandbox`,`sandbox = client.create(type="cpx32", region="hel1")`,`print(sandbox.ip)    # 95.217.x.x`,`print(sandbox.url()) # https://abc123.kortix.cloud`,``,`# Snapshot & destroy`,`client.snapshot(sandbox.id, name="v1")`,`client.remove(sandbox.id)`,``,``],
    ts: [`import { JustAVPS } from "justavps"`,``,`const client = new JustAVPS()`,``,`// Create a sandbox`,`const sandbox = await client.create({`,`  type: "cpx32", region: "hel1"`,`})`,`console.log(sandbox.ip)  // 95.217.x.x`,`console.log(sandbox.url())`,``,`// Snapshot & destroy`,`await client.snapshot(sandbox.id, { name: "v1" })`,`await client.remove(sandbox.id)`],
    rest: [`# Create a sandbox`,`POST /api/v1/machines`,`Authorization: Bearer $API_KEY`,`{"type": "cpx32", "region": "hel1"}`,``,`# → 201 Created`,`# {"id": "abc123", "ip": "95.217.x.x"}`,``,`# Snapshot`,`POST /api/v1/machines/abc123/snapshots`,`{"name": "v1"}`,``,`# Destroy`,`DELETE /api/v1/machines/abc123`],
  },
  { id: "process", label: "Process",
    icon: <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>,
    desc: "Execute code and commands with real-time output streaming.",
    py: [`# Execute code inside the sandbox`,`response = sandbox.process.code_run(`,`    'print("Hello World!")'`,`)`,`print(response.result)  # "Hello World!"`,``,`# Run a shell command`,`response = sandbox.process.exec(`,`    'echo "Hello from exec!"',`,`    cwd="/root", timeout=10`,`)`,`print(response.result)`,``,``],
    ts: [`// Execute code inside the sandbox`,`const res = await sandbox.process.codeRun(`,`  'console.log("Hello World!")'`,`)`,`console.log(res.result) // "Hello World!"`,``,`// Run a shell command`,`const exec = await sandbox.process.exec(`,`  'echo "Hello from exec!"',`,`  { cwd: "/root", timeout: 10 }`,`)`,`console.log(exec.result)`,``,``],
    rest: [`# Execute code`,`POST /api/v1/machines/abc123/exec`,`Authorization: Bearer $API_KEY`,`{"command": "python3 -c 'print(1+1)'"}`,``,`# → 200 OK`,`# {"exit_code": 0, "result": "2"}`,``,`# Stream output (SSE)`,`POST /api/v1/machines/abc123/exec?stream=true`,`Authorization: Bearer $API_KEY`,`{"command": "npm run build"}`,``,`# → SSE stream of stdout/stderr`],
  },
  { id: "fs", label: "Filesystem",
    icon: <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>,
    desc: "Full CRUD file operations — upload, download, list, delete.",
    py: [`# Upload a file`,`sandbox.fs.upload("data.csv", "/root/data.csv")`,``,`# Download a file`,`content = sandbox.fs.download("/root/output.json")`,``,`# List directory`,`files = sandbox.fs.list("/root")`,`for f in files:`,`    print(f.name, f.size)`,``,`# Delete a file`,`sandbox.fs.delete("/root/tmp.log")`,``],
    ts: [`// Upload a file`,`await sandbox.fs.upload("data.csv", "/root/data.csv")`,``,`// Download a file`,`const content = await sandbox.fs.download("/root/output.json")`,``,`// List directory`,`const files = await sandbox.fs.list("/root")`,`for (const f of files)`,`  console.log(f.name, f.size)`,``,`// Delete a file`,`await sandbox.fs.delete("/root/tmp.log")`,``],
    rest: [`# Upload`,`PUT /api/v1/machines/abc123/fs/root/data.csv`,`Content-Type: application/octet-stream`,`<file bytes>`,``,`# Download`,`GET /api/v1/machines/abc123/fs/root/output.json`,``,`# List directory`,`GET /api/v1/machines/abc123/fs/root`,`# → [{"name":"data.csv","size":1024}]`,``,`# Delete`,`DELETE /api/v1/machines/abc123/fs/root/tmp.log`],
  },
  { id: "agents", label: "Coding Agents",
    icon: <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M12 2a4 4 0 014 4v1H8V6a4 4 0 014-4zM7 15h.01M12 15h.01M17 15h.01" /></svg>,
    desc: "Spawn agents, route prompts, stream events via sandbox-agent.",
    py: [`# Install & start a coding agent`,`agent = sandbox.agents.install("claude-code")`,`agent.start()`,``,`# Create a session and send a prompt`,`session = agent.session.create()`,`stream = session.prompt(`,`    "Build a REST API with FastAPI"`,`)`,``,`# Stream events in real time`,`for event in stream:`,`    print(event.type, event.data)`,``],
    ts: [`// Install & start a coding agent`,`const agent = await sandbox.agents.install("claude-code")`,`await agent.start()`,``,`// Create a session and send a prompt`,`const session = await agent.session.create()`,`const stream = await session.prompt(`,`  "Build a REST API with FastAPI"`,`)`,``,`// Stream events in real time`,`for await (const event of stream) {`,`  console.log(event.type, event.data)`,`}`],
    rest: [`# Install an agent`,`POST /api/v1/machines/abc123/agents/install`,`{"agent": "claude-code"}`,``,`# Create a session`,`POST /api/v1/machines/abc123/agents/sessions`,`# → {"session_id": "ses_xyz"}`,``,`# Send a prompt (SSE stream)`,`POST /api/v1/machines/abc123/agents/sessions/ses_xyz/prompt`,`{"message": "Build a REST API with FastAPI"}`,`# → SSE stream of agent events`,``,`# List active sessions`,`GET /api/v1/machines/abc123/agents/sessions`],
  },
];

type Lang = "py" | "ts" | "rest";
const LANGS: { id: Lang; label: string; icon: React.ReactNode }[] = [
  { id: "py", label: "Python", icon: <IconPy /> },
  { id: "ts", label: "TypeScript", icon: <IconTS /> },
  { id: "rest", label: "REST", icon: <IconREST /> },
];

function ApiCode() {
  const [section, setSection] = useState(0);
  const [lang, setLang] = useState<Lang>("py");
  const active = API_SECTIONS[section];
  const lines = active[lang];
  const isComment = (l: string) => l.startsWith("#") || l.startsWith("//");
  return (
    <div>
      <div className="flex items-end justify-between mb-8">
        <SectionHead title="Programmatic Control." desc="Machine, Process, Filesystem, and Coding Agents API." />
        <div className="flex items-center gap-1 shrink-0 ml-4">
          {LANGS.map((l) => (
            <button key={l.id} onClick={() => setLang(l.id)} className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              lang === l.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
            )}>{l.icon}<span className="hidden sm:inline">{l.label}</span></button>
          ))}
        </div>
      </div>

      <div className="flex md:hidden border border-border rounded-t-2xl overflow-hidden">
        {API_SECTIONS.map((s, i) => (
          <button key={s.id} onClick={() => setSection(i)} className={cn(
            "flex-1 py-3 text-xs font-medium border-b-2 transition-colors",
            i === section ? "text-foreground border-foreground bg-muted" : "text-muted-foreground border-transparent"
          )}>{s.label}</button>
        ))}
      </div>

      <div className="grid md:grid-cols-[260px_1fr] gap-0">
        <div className="hidden md:grid grid-rows-4 border border-r-0 border-border rounded-l-2xl overflow-hidden">
          {API_SECTIONS.map((s, i) => (
            <button key={s.id} onClick={() => setSection(i)} className={cn(
              "text-left px-5 flex flex-col justify-center transition-colors",
              i < API_SECTIONS.length - 1 && "border-b border-border",
              i === section ? "bg-card" : "hover:bg-muted"
            )}>
              <div className="flex items-center gap-2.5 mb-1">
                <span className={cn(i === section ? "text-foreground" : "text-muted-foreground")}>{s.icon}</span>
                <span className={cn("text-sm font-medium", i === section ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
              </div>
              <p className="text-xs leading-relaxed pl-[30px] text-muted-foreground">{s.desc}</p>
            </button>
          ))}
        </div>

        <div className="border border-border md:rounded-r-2xl rounded-b-2xl md:rounded-bl-none overflow-hidden bg-muted">
          <div className="flex items-center border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-500" /><span className="size-2.5 rounded-full bg-yellow-500" /><span className="size-2.5 rounded-full bg-green-500" />
            </div>
            <span className="ml-3 text-xs text-muted-foreground font-mono">{active.label.toLowerCase()}.{lang === "rest" ? "http" : lang}</span>
          </div>
          <div className="p-5 font-mono text-xs leading-[1.8] overflow-x-auto h-[340px] overflow-y-auto">
            {lines.map((line, i) => {
              if (line === "") return <div key={`${section}-${lang}-${i}`} className="h-2.5" />;
              if (isComment(line)) return <div key={`${section}-${lang}-${i}`} className="text-muted-foreground">{line}</div>;
              if (lang === "rest") {
                const c = line
                  .replace(/^(GET|POST|PUT|DELETE|PATCH)\b/, '<span class="text-green-600 dark:text-green-400">$1</span>')
                  .replace(/\$[A-Z_]+/g, '<span class="text-amber-600 dark:text-amber-400">$&</span>')
                  .replace(/"([^"]*)"/g, '<span class="text-amber-600 dark:text-amber-400">"$1"</span>');
                return <div key={`${section}-${lang}-${i}`} className="text-foreground" dangerouslySetInnerHTML={{ __html: c }} />;
              }
              const c = line
                .replace(/\b(from|import|for|if|else|print|in|const|let|await|async|new|return|console)\b/g, '<kw>$1</kw>')
                .replace(/"([^"]*)"/g, '<s>"$1"</s>')
                .replace(/'([^']*)'/g, "<s>'$1'</s>")
                .replace(/<kw>/g, '<span class="text-blue-600 dark:text-blue-400">')
                .replace(/<\/kw>/g, '</span>')
                .replace(/<s>/g, '<span class="text-amber-600 dark:text-amber-400">')
                .replace(/<\/s>/g, '</span>');
              return <div key={`${section}-${lang}-${i}`} className="text-foreground" dangerouslySetInnerHTML={{ __html: c }} />;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
