"use client";

import { useTheme } from "@/hooks/use-theme";
import { Logo } from "@/components/logo";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="fixed top-4 right-4 size-10 flex items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all z-50"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
      ) : (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
      )}
    </button>
  );
}

/* ── Shared logo img component ── */
function KortixMark({ height = 14, className = "" }: { height?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logomark-white.svg"
      alt="Kortix"
      className={`invert dark:invert-0 flex-shrink-0 ${className}`}
      style={{ height: `${height}px`, width: "auto" }}
    />
  );
}

export default function LogoPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ThemeToggle />

      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Brand Variations</h1>
        <p className="text-sm text-muted-foreground mb-12">Pick the one that feels right. Toggle dark mode to check both.</p>

        <div className="space-y-6">

          {/* ── A: Tight slash, same baseline ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">A — Tight slash, same size</span>
            <div className="flex items-center gap-1.5">
              <KortixMark height={14} />
              <span className="text-[13px] text-muted-foreground/40 font-normal">/</span>
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── B: No gap slash, touching ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">B — No gap, slash touching</span>
            <div className="flex items-center">
              <KortixMark height={14} />
              <span className="text-[13px] text-muted-foreground/40 font-normal mx-0.5">/</span>
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── C: Dot separator ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">C — Dot separator</span>
            <div className="flex items-center gap-1.5">
              <KortixMark height={14} />
              <span className="text-[5px] text-muted-foreground/30">●</span>
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── D: Tight, no separator ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">D — No separator, just spacing</span>
            <div className="flex items-center gap-2">
              <KortixMark height={14} />
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── E: Thin vertical bar ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">E — Thin vertical divider</span>
            <div className="flex items-center gap-2">
              <KortixMark height={14} />
              <div className="w-px h-3.5 bg-border/60" />
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── F: Slash, justavps lighter (SELECTED — uses Logo component) ── */}
          <div className="rounded-xl border-2 border-foreground/20 p-8 bg-muted/20">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">F — Tight slash, justavps more faded ✓ selected</span>
            <Logo />
          </div>

          {/* ── G: Larger logo, smaller text ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">G — Larger logo (16px), smaller text</span>
            <div className="flex items-center gap-1.5">
              <KortixMark height={16} />
              <span className="text-[12px] text-muted-foreground/40 font-normal">/</span>
              <span className="text-[12px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── H: Symbol only + slash + text ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">H — Symbol only + slash + text</span>
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/kortix-symbol.svg" alt="Kortix" className="h-[16px] w-auto dark:invert flex-shrink-0" />
              <span className="text-[13px] text-muted-foreground/40 font-normal">/</span>
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── I: Symbol only + no separator ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">I — Symbol only, tight, no separator</span>
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/kortix-symbol.svg" alt="Kortix" className="h-[16px] w-auto dark:invert flex-shrink-0" />
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps</span>
            </div>
          </div>

          {/* ── J: Full logo + .com ── */}
          <div className="rounded-xl border border-border p-8">
            <span className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-6 block">J — Tight slash + justavps.com</span>
            <div className="flex items-center gap-1">
              <KortixMark height={14} />
              <span className="text-[13px] text-muted-foreground/30 font-normal">/</span>
              <span className="text-[13px] font-medium text-muted-foreground tracking-tight">justavps.com</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
