"use client";

import Link from "next/link";
import { Hero } from "@/components/marketing/hero";
import { Pricing } from "@/components/marketing/pricing";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── What's Included ────────────────────────────────────────────────────────

function Included() {
  const items = [
    {
      title: "Claude Code",
      desc: "Anthropic's AI coding agent, pre-installed. SSH in and run `claude`.",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      ),
    },
    {
      title: "OpenCode",
      desc: "Web UI auto-served on port 3456. Access from any browser.",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      ),
    },
    {
      title: "Browser IDE",
      desc: "VS Code in your browser via code-server. Zero local setup.",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      ),
    },
    {
      title: "Full SSH Access",
      desc: "Auto-generated SSH key pair. Connect from any terminal or IDE.",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      ),
    },
    {
      title: "Docker Ready",
      desc: "Docker and Docker Compose pre-installed. Run anything.",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        </svg>
      ),
    },
    {
      title: "Daily Backups",
      desc: "Automatic Hetzner backups. Restore to any previous state.",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="M12 6v6l4 2" />
        </svg>
      ),
    },
  ];

  return (
    <section className="py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Everything pre-installed.
          </h2>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Every machine ships with the full stack. No configuration required.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => (
            <div
              key={item.title}
              className="group p-6 rounded-xl border border-border/40 bg-card/30 hover:bg-card/60 hover:border-border/60 transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors mb-4">
                {item.icon}
              </div>
              <h3 className="font-semibold mb-1.5">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ───────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    { n: "1", title: "Pick a size", desc: "Choose from 6 dedicated CCX plans across 5 global regions." },
    { n: "2", title: "Click create", desc: "Your machine is provisioned in ~60 seconds with everything installed." },
    { n: "3", title: "Start building", desc: "SSH in, open the browser IDE, or launch Claude Code / OpenCode." },
  ];

  return (
    <section className="py-24 px-4 bg-muted/20">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-16">
          Three steps. That&apos;s it.
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((s) => (
            <div key={s.n} className="space-y-3">
              <div className="w-12 h-12 rounded-full border-2 border-primary/30 bg-primary/5 flex items-center justify-center mx-auto text-xl font-bold text-primary/80">
                {s.n}
              </div>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {s.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-14">
          <Link
            href="/machines/new"
            className={cn(
              buttonVariants({ size: "lg" }),
              "text-base px-10 h-12 font-semibold"
            )}
          >
            Deploy Your First Machine
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-border/40 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <span className="text-lg font-bold tracking-tight">JustAVPS</span>
            <p className="text-sm text-muted-foreground mt-0.5">
              Dedicated VPS for developers &amp; AI agents.
            </p>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <Link href="/login" className="hover:text-foreground transition-colors">Login</Link>
            <a href="https://github.com/heyagi/justavps" className="hover:text-foreground transition-colors">GitHub</a>
            <a href="mailto:support@justavps.com" className="hover:text-foreground transition-colors">Support</a>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-border/30 text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} JustAVPS. Powered by Hetzner dedicated compute.
        </div>
      </div>
    </footer>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <>
      <Hero />
      <Included />
      <Pricing />
      <HowItWorks />
      <Footer />
    </>
  );
}
