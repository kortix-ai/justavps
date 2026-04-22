"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { Progress } from "@/shared/ui/progress";
import { Separator } from "@/shared/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Plus,
  Trash2,
  AlertTriangle,
  Server,
  Globe,
  KeyRound,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Camera,
  CreditCard,
  Settings,
  ArrowUp,
  RotateCw,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Logo } from "@/shared/components/logo";
import type { Highlighter } from "shiki";

/* ═══════════════════════════════════════════════════════════════════════════
   BRAND PAGE — Component Reference & Design Standards
   ═══════════════════════════════════════════════════════════════════════════
   This page documents every standardized pattern used across the dashboard.
   All dashboard pages MUST follow these exact patterns.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Shiki singleton — shared with docs page ────────────────────────────── */
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: ["bash", "typescript", "tsx", "json"],
      })
    );
  }
  return highlighterPromise;
}

/* ─── Section wrapper for the brand page ─────────────────────────────────── */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-4">
      <div>
        <h2 className="font-heading text-xl tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      {children}
    </section>
  );
}

/* ─── Syntax-highlighted code block (Shiki) ──────────────────────────────── */
function CodeBlock({ children, title, lang = "tsx" }: { children: string; title?: string; lang?: string }) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      const html = hl.codeToHtml(children.trim(), {
        lang,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      setHighlightedHtml(html);
    });
    return () => { cancelled = true; };
  }, [children, lang]);

  return (
    <div className={cn("group relative rounded-lg border overflow-hidden", "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950")}>
      {title && (
        <div className={cn("flex items-center justify-between border-b px-4 py-2", "border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60")}>
          <span className="text-xs text-muted-foreground font-mono">{title}</span>
          <button onClick={handleCopy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {!title && (
        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button onClick={handleCopy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {highlightedHtml ? (
        <div
          className="shiki-block overflow-x-auto p-4 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_code]:!text-[13px] [&_code]:!leading-relaxed [&_code]:!font-mono"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed"><code className="font-mono text-zinc-800 dark:text-zinc-200">{children.trim()}</code></pre>
      )}
    </div>
  );
}

export default function BrandPage() {
  const [sampleDialogOpen, setSampleDialogOpen] = useState(false);

  return (
    <div className="space-y-12 max-w-4xl">
      {/* ═══ PAGE HEADER ════════════════════════════════════════════════════ */}
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Brand & Components</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Design system reference for JustAVPS dashboard. All pages follow these patterns exactly.
        </p>
      </div>

      {/* ═══ TABLE OF CONTENTS ══════════════════════════════════════════════ */}
      <nav className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-medium mb-3">Standards Reference</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { id: "logo", label: "Logo & Identity" },
            { id: "typography", label: "Typography & Font" },
            { id: "colors", label: "Color System" },
            { id: "page-headers", label: "Page Headers" },
            { id: "buttons", label: "Buttons" },
            { id: "cards", label: "Cards & Containers" },
            { id: "empty-states", label: "Empty States" },
            { id: "loading-states", label: "Loading States" },
            { id: "alerts", label: "Alert Banners" },
            { id: "list-items", label: "List Items" },
            { id: "dialogs", label: "Dialogs" },
            { id: "badges", label: "Badges" },
            { id: "grids", label: "Grid Layouts" },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              → {item.label}
            </a>
          ))}
        </div>
      </nav>

      <Separator />

      {/* ═══ 0. LOGO & IDENTITY ═══════════════════════════════════════════════ */}
      <Section
        id="logo"
        title="Logo & Identity"
        description="Kortix / justavps co-branded logo. Used in sidebar header, marketing pages, and docs."
      >
        {/* Live logo component */}
        <div className="rounded-xl border p-8 space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Logo Component</p>
            <div className="flex items-center gap-8">
              <div className="p-6 rounded-xl bg-background border">
                <Logo />
              </div>
              <div className="p-6 rounded-xl bg-zinc-950">
                <Logo />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Uses <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">{'<Logo />'}</code> from <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">@/components/logo</code>. Works in both light and dark mode via <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">invert</code> / <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">dark:invert-0</code>.
            </p>
          </div>

          {/* Logo marks */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Logo Assets</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { src: "/logomark-white.svg", label: "Logomark (white)", invert: true },
                { src: "/kortix-symbol.svg", label: "Kortix Symbol", invert: false },
                { src: "/kortix-logomark-white.svg", label: "Kortix Logomark", invert: true },
                { src: "/kortix-computer-white.svg", label: "Computer (white)", invert: true },
                { src: "/kortix-computer-black.svg", label: "Computer (black)", invert: false },
                { src: "/kortix-brandmark-hero.svg", label: "Brandmark Hero", invert: false },
              ].map((asset) => (
                <div key={asset.src} className="rounded-xl border bg-card p-4 space-y-3">
                  <div className={cn(
                    "h-16 rounded-lg flex items-center justify-center",
                    asset.invert ? "bg-zinc-900" : "bg-zinc-100 dark:bg-zinc-800",
                  )}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.src}
                      alt={asset.label}
                      className="h-6 w-auto max-w-[80%] object-contain"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-medium">{asset.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{asset.src}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Collapsed sidebar icon */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sidebar Collapsed Icon</p>
            <div className="flex items-center gap-4">
              <div className="size-10 rounded-lg border flex items-center justify-center bg-background">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/kortix-symbol.svg" alt="Kortix" className="h-[14px] w-auto dark:invert flex-shrink-0" />
              </div>
              <p className="text-xs text-muted-foreground">
                When sidebar is collapsed, the Kortix symbol is shown alone at 14px height.
              </p>
            </div>
          </div>
        </div>

        <CodeBlock title="Logo component usage" lang="tsx">{`
import { Logo } from "@/shared/components/logo";

// Full co-branded logo (sidebar, nav)
<Logo />

// With custom href
<Logo href="/dashboard" />

// Collapsed sidebar — symbol only
<img src="/kortix-symbol.svg" alt="Kortix" className="h-[14px] w-auto dark:invert" />
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 1. TYPOGRAPHY & FONT ═════════════════════════════════════════════ */}
      <Section
        id="typography"
        title="Typography & Font"
        description="Roobert — custom variable font loaded via next/font/local. Both sans and mono variants."
      >
        {/* Font showcase */}
        <div className="rounded-xl border p-5 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Roobert — Sans (font-sans / font-heading)</p>
            <div className="space-y-2">
              <p className="text-4xl font-bold tracking-tight">The quick brown fox jumps over the lazy dog</p>
              <p className="text-2xl font-semibold tracking-tight">ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
              <p className="text-xl tracking-tight">abcdefghijklmnopqrstuvwxyz 0123456789</p>
              <p className="text-sm text-muted-foreground">Regular — The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p>
              <p className="text-sm font-medium">Medium — The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p>
              <p className="text-sm font-semibold">Semibold — The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p>
              <p className="text-sm font-bold">Bold — The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Roobert Mono — Monospace (font-mono)</p>
            <div className="space-y-2">
              <p className="font-mono text-lg tracking-tight">The quick brown fox jumps over the lazy dog</p>
              <p className="font-mono text-sm">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz</p>
              <p className="font-mono text-sm">0123456789 !@#$%^&*()_+-=[]{}|;:&apos;,./&lt;&gt;?</p>
              <p className="font-mono text-xs text-muted-foreground">ssh -i ~/.ssh/justavps_mybox root@95.217.x.x</p>
              <p className="font-mono text-xs text-muted-foreground">sk_live_abc123def456ghi789jkl012mno345</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">OpenType Features</p>
            <p className="text-xs text-muted-foreground">
              Roobert is loaded with stylistic sets enabled: <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">&apos;ss10&apos; on, &apos;ss09&apos; on, &apos;ss03&apos; on, &apos;ss04&apos; on, &apos;ss14&apos; on</code>
            </p>
          </div>
        </div>

        {/* Font configuration */}
        <CodeBlock title="Font loading (src/app/fonts/roobert.ts)" lang="typescript">{`
import localFont from "next/font/local";

export const roobert = localFont({
  src: [
    { path: "../../../public/fonts/roobert/RoobertUprightsVF.woff2", style: "normal", weight: "100 900" },
    { path: "../../../public/fonts/roobert/RoobertItalicsVF.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-roobert",
  display: "swap",
  declarations: [
    { prop: "font-feature-settings", value: "'ss10' on, 'ss09' on, 'ss03' on, 'ss04' on, 'ss14' on" },
  ],
});
        `}</CodeBlock>

        {/* Type scale */}
        <div className="rounded-xl border p-5 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type Scale</p>
            <div className="space-y-4">
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">text-3xl · heading</span>
                <h1 className="font-heading text-3xl tracking-tight">Page Title</h1>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">text-xl · heading</span>
                <h2 className="font-heading text-xl tracking-tight">Section Title</h2>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">text-lg · heading</span>
                <h3 className="font-heading text-lg tracking-tight">Detail Page Title</h3>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">text-sm · medium</span>
                <p className="text-sm font-medium">Card / Section Label</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">text-sm · muted</span>
                <p className="text-sm text-muted-foreground">Body text and subtitles</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">text-xs · muted</span>
                <p className="text-xs text-muted-foreground">Small / meta text</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">text-[11px]</span>
                <p className="text-[11px] text-muted-foreground">Tiny labels, badges</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">mono · text-sm</span>
                <p className="font-mono text-sm">IDs, IPs, commands</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs text-muted-foreground font-mono w-40 shrink-0">mono · text-xs</span>
                <p className="font-mono text-xs text-muted-foreground">Fingerprints, key prefixes</p>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <p className="font-medium">Rules</p>
            <ul className="space-y-1 text-muted-foreground text-xs">
              <li>• <strong className="text-foreground">font-heading = font-sans = Roobert.</strong> Same font, aliased for semantic clarity</li>
              <li>• <strong className="text-foreground">font-mono = Roobert Mono.</strong> Used for IDs, IPs, commands, API keys, code</li>
              <li>• <strong className="text-foreground">Page titles:</strong> font-heading text-3xl tracking-tight</li>
              <li>• <strong className="text-foreground">Detail page titles:</strong> font-heading text-lg md:text-xl tracking-tight</li>
              <li>• <strong className="text-foreground">Empty state headings:</strong> font-heading text-xl</li>
              <li>• <strong className="text-foreground">Card labels:</strong> text-sm font-medium text-muted-foreground</li>
              <li>• <strong className="text-foreground">Subtitles:</strong> text-sm text-muted-foreground mt-0.5</li>
            </ul>
          </div>
        </div>
      </Section>

      <Separator />

      {/* ═══ 2. COLOR SYSTEM ═════════════════════════════════════════════════ */}
      <Section
        id="colors"
        title="Color System"
        description="Semantic colors used across the dashboard. Use emerald for success, amber for warning, red/destructive for errors."
      >
        <div className="rounded-xl border p-5 space-y-6">
          {/* Status colors */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status Colors</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-2">
                <div className="h-12 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Emerald</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">Success / Running / Active</p>
              </div>
              <div className="space-y-2">
                <div className="h-12 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
                  <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Yellow</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">Warning / Provisioning</p>
              </div>
              <div className="space-y-2">
                <div className="h-12 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
                  <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Amber</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">Near Limit / Caution</p>
              </div>
              <div className="space-y-2">
                <div className="h-12 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">Red</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">Error / Destructive</p>
              </div>
            </div>
          </div>

          {/* Rules */}
          <div className="space-y-2 text-sm">
            <p className="font-medium">Color Rules</p>
            <ul className="space-y-1 text-muted-foreground text-xs">
              <li>• <strong className="text-foreground">Success/Running:</strong> emerald-500 (NOT green-500)</li>
              <li>• <strong className="text-foreground">Warning/Provisioning:</strong> yellow-500 for status dots, brand for alert banners</li>
              <li>• <strong className="text-foreground">Error/Destructive:</strong> red-500 for dots, destructive token for text/borders</li>
              <li>• <strong className="text-foreground">Background tints:</strong> color-500/5 or /10, borders: color-500/20</li>
              <li>• <strong className="text-foreground">Dark mode text:</strong> dark:text-color-400 for readable contrast</li>
            </ul>
          </div>
        </div>
      </Section>

      <Separator />

      {/* ═══ 3. PAGE HEADERS ══════════════════════════════════════════════════ */}
      <Section
        id="page-headers"
        title="Page Headers"
        description="Every dashboard page uses the same header pattern: text-3xl heading + optional subtitle + right-aligned action button."
      >
        {/* Standard header */}
        <div className="rounded-xl border p-5 space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Standard — with action button</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-heading text-3xl tracking-tight">Page Title</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Optional subtitle with context
              </p>
            </div>
            <Button>
              <Plus className="size-4" />
              Create Item
            </Button>
          </div>
        </div>

        {/* Header without subtitle */}
        <div className="rounded-xl border p-5 space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Minimal — no subtitle</p>
          <div className="flex items-center justify-between">
            <h1 className="font-heading text-3xl tracking-tight">Settings</h1>
          </div>
        </div>

        <CodeBlock title="Page header pattern" lang="tsx">{`
<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <h1 className="font-heading text-3xl tracking-tight">Page Title</h1>
    <p className="text-sm text-muted-foreground mt-0.5">Subtitle</p>
  </div>
  <Button>
    <Plus className="size-4" />
    Create Item
  </Button>
</div>
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 4. BUTTONS ════════════════════════════════════════════════════════ */}
      <Section
        id="buttons"
        title="Buttons"
        description="Standard button variants and sizes. Header actions use default size. Inline/secondary actions use size='sm'."
      >
        <div className="rounded-xl border p-5 space-y-6">
          {/* Variants */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Variants</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="default"><Plus className="size-4" />Primary Action</Button>
              <Button variant="outline"><ExternalLink className="size-4" />Outline</Button>
              <Button variant="secondary"><Settings className="size-4" />Secondary</Button>
              <Button variant="ghost"><Copy className="size-4" />Ghost</Button>
              <Button variant="destructive"><Trash2 className="size-4" />Destructive</Button>
              <Button variant="link">Link Button</Button>
            </div>
          </div>

          {/* Sizes */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sizes</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs">Extra Small</Button>
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
            </div>
          </div>

          {/* Icon buttons */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Icon Buttons</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="icon-xs" variant="ghost"><Trash2 className="size-3" /></Button>
              <Button size="icon-sm" variant="ghost"><Trash2 className="size-3.5" /></Button>
              <Button size="icon" variant="ghost"><Trash2 className="size-4" /></Button>
              <Button size="icon-lg" variant="outline"><Settings className="size-4" /></Button>
            </div>
          </div>

          {/* Header action pattern */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Header Action (default size)</p>
            <div className="flex gap-2">
              <Button>
                <Plus className="size-4" />
                Create Machine
              </Button>
              <Button disabled>
                <Plus className="size-4" />
                Limit Reached
              </Button>
            </div>
          </div>

          {/* Inline action pattern */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inline Actions (size=sm)</p>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm">
                <ArrowUp className="size-3.5" />
                Scale Up
              </Button>
              <Button variant="outline" size="sm">
                <Camera className="size-3.5" />
                Snapshot
              </Button>
              <Button variant="outline" size="sm">
                <RotateCw className="size-3.5" />
                Reboot
              </Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20">
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>
          </div>

          {/* Loading state */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Loading State</p>
            <div className="flex gap-2">
              <Button disabled>
                <Loader2 className="size-4 animate-spin" />
                Creating...
              </Button>
              <Button variant="outline" size="sm" disabled>
                <Loader2 className="size-3.5 animate-spin" />
                Rebooting...
              </Button>
            </div>
          </div>
        </div>

        <CodeBlock title="Button patterns" lang="tsx">{`
{/* Header action — always default size */}
<Button>
  <Plus className="size-4" />
  Create Item
</Button>

{/* Inline/secondary action — size="sm" */}
<Button variant="outline" size="sm">
  <RotateCw className="size-3.5" />
  Reboot
</Button>

{/* Loading state */}
<Button disabled>
  <Loader2 className="size-4 animate-spin" />
  Creating...
</Button>

{/* Destructive inline */}
<Button variant="outline" size="sm"
  className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20">
  <Trash2 className="size-3.5" />
  Delete
</Button>
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 5. CARDS & CONTAINERS ════════════════════════════════════════════ */}
      <Section
        id="cards"
        title="Cards & Containers"
        description="All cards use rounded-xl border bg-card. Hoverable items add hover:bg-muted/40 transition-colors."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Standard card */}
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CreditCard className="size-4" />
              Standard Card
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight">42</span>
              <span className="text-sm text-muted-foreground">units</span>
            </div>
          </div>

          {/* Stat card */}
          <div className="rounded-xl border bg-card p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Server className="size-3.5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">CPU Usage</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-semibold tabular-nums tracking-tight text-emerald-500">24%</span>
            </div>
            <Progress value={24} className="h-1 [&>div]:bg-emerald-500" />
          </div>
        </div>

        {/* Sectioned card */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <Server className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Sectioned Card</span>
          </div>
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Cards with headers use border-b to separate the header from content.
            </p>
          </div>
        </div>

        {/* Divided card */}
        <div className="rounded-xl border bg-card divide-y overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">Row item one</span>
            <Badge variant="outline">Active</Badge>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">Row item two</span>
            <Badge variant="secondary">Inactive</Badge>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">Row item three</span>
            <Badge variant="outline">Active</Badge>
          </div>
        </div>

        <CodeBlock title="Card patterns" lang="tsx">{`
{/* Standard card */}
<div className="rounded-xl border bg-card p-5 space-y-3">...</div>

{/* Sectioned card with header */}
<div className="rounded-xl border bg-card overflow-hidden">
  <div className="flex items-center gap-2 px-4 py-3 border-b">
    <Icon className="size-3.5 text-muted-foreground" />
    <span className="text-sm font-medium">Section Title</span>
  </div>
  <div className="p-4">...</div>
</div>

{/* Divided card (table-like) */}
<div className="rounded-xl border bg-card divide-y overflow-hidden">
  <div className="flex items-center justify-between px-4 py-3">...</div>
</div>
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 6. EMPTY STATES ════════════════════════════════════════════════ */}
      <Section
        id="empty-states"
        title="Empty States"
        description="Consistent empty state pattern: icon in bg-muted container, text-xl heading, descriptive text, optional CTA button."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Primary empty state (with CTA) */}
          <div className="rounded-xl border p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">With CTA</p>
            <div className="flex flex-col items-center justify-center py-12">
              <div className="relative mb-6">
                <div className="rounded-2xl bg-muted p-5">
                  <Server className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
                </div>
                <div className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5">
                  <Plus className="size-3 text-primary-foreground" />
                </div>
              </div>
              <h2 className="font-heading text-xl mb-1.5">No machines yet</h2>
              <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
                Deploy your first VPS in minutes. Pick a plan and go.
              </p>
              <Button>
                <Plus className="size-4" />
                New Machine
              </Button>
            </div>
          </div>

          {/* Secondary empty state (no CTA) */}
          <div className="rounded-xl border p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Without CTA</p>
            <div className="flex flex-col items-center justify-center py-12">
              <div className="rounded-2xl bg-muted p-5 mb-6">
                <KeyRound className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
              </div>
              <h2 className="font-heading text-xl mb-1.5">No SSH keys configured</h2>
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                Add an SSH key to enable secure access to your machines.
              </p>
            </div>
          </div>
        </div>

        <CodeBlock title="Empty state patterns" lang="tsx">{`
{/* Primary empty state (with CTA + plus badge) */}
<div className="flex flex-col items-center justify-center py-24">
  <div className="relative mb-6">
    <div className="rounded-2xl bg-muted p-5">
      <Icon className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
    </div>
    <div className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5">
      <Plus className="size-3 text-primary-foreground" />
    </div>
  </div>
  <h2 className="font-heading text-xl mb-1.5">No items yet</h2>
  <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">Description</p>
  <Button><Plus className="size-4" />Create Item</Button>
</div>

{/* Secondary empty state (without CTA) */}
<div className="flex flex-col items-center justify-center py-16">
  <div className="rounded-2xl bg-muted p-5 mb-6">
    <Icon className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
  </div>
  <h2 className="font-heading text-xl mb-1.5">No items configured</h2>
  <p className="text-sm text-muted-foreground text-center max-w-xs">Description</p>
</div>
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 7. LOADING STATES ═══════════════════════════════════════════════ */}
      <Section
        id="loading-states"
        title="Loading States"
        description="Loading skeletons use rounded-xl border p-5 space-y-4 for grid items. List items use space-y-2."
      >
        <div className="space-y-6">
          {/* Grid loading */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Grid Skeleton</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                  <Skeleton className="h-px w-full" />
                  <div className="flex justify-between">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* List loading */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">List Skeleton</p>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
            </div>
          </div>

          {/* Stat card loading */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Stat Card Skeleton</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-5 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <CodeBlock title="Loading patterns" lang="tsx">{`
{/* Grid skeleton — uses border (not bg-muted/30) */}
<div className="rounded-xl border p-5 space-y-4">
  <Skeleton className="h-4 w-28" />
</div>

{/* List skeleton */}
<div className="rounded-xl border bg-card p-4 space-y-2">
  <Skeleton className="h-4 w-28" />
  <Skeleton className="h-3 w-48" />
</div>

{/* Page-level spinner */}
<div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 8. ALERT BANNERS ═══════════════════════════════════════════════ */}
      <Section
        id="alerts"
        title="Alert Banners"
        description="Consistent alert banners for warnings, errors, info, and success states. Icon size is always size-4."
      >
        <div className="space-y-3">
          {/* Warning */}
          <div className="flex items-start gap-3 rounded-xl border p-4 border-brand/20 bg-brand/10">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Warning alert</p>
              <p className="text-xs text-muted-foreground">
                Approaching resource limit. You can still proceed.
              </p>
            </div>
          </div>

          {/* Error/destructive */}
          <div className="flex items-start gap-3 rounded-xl border p-4 border-destructive/20 bg-destructive/5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Error alert</p>
              <p className="text-xs text-muted-foreground">
                Limit reached. Delete a resource to continue.
              </p>
            </div>
          </div>

          {/* Success */}
          <div className="flex items-center gap-2 rounded-xl border p-3 border-emerald-500/20 bg-emerald-500/10">
            <Check className="size-4 text-emerald-500" />
            <span className="text-sm text-emerald-700 dark:text-emerald-400">Success confirmation</span>
          </div>

          {/* Info/primary */}
          <div className="flex items-center gap-3 rounded-xl border p-4 border-primary/20 bg-primary/5">
            <Loader2 className="size-4 animate-spin text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium">Processing</p>
              <p className="text-xs text-muted-foreground">Your request is being processed.</p>
            </div>
          </div>

          {/* Provisioning */}
          <div className="flex items-start gap-3 rounded-xl border p-4 border-yellow-500/20 bg-yellow-500/5">
            <div className="rounded-lg bg-yellow-500/10 p-1.5 shrink-0 mt-0.5">
              <Loader2 className="size-4 animate-spin text-yellow-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Provisioning</p>
              <p className="text-xs text-muted-foreground mt-0.5">Setting up your machine.</p>
            </div>
          </div>
        </div>

        <CodeBlock title="Alert banner patterns" lang="tsx">{`
{/* Warning banner */}
<div className="flex items-start gap-3 rounded-xl border p-4 border-brand/20 bg-brand/10">
  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand" />
  <div className="space-y-0.5">
    <p className="text-sm font-medium">Title</p>
    <p className="text-xs text-muted-foreground">Description</p>
  </div>
</div>

{/* Error banner */}
<div className="flex items-start gap-3 rounded-xl border p-4 border-destructive/20 bg-destructive/5">
  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
  ...
</div>

{/* Success banner */}
<div className="flex items-center gap-2 rounded-xl border p-3 border-emerald-500/20 bg-emerald-500/10">
  <Check className="size-4 text-emerald-500" />
  <span className="text-sm text-emerald-700 dark:text-emerald-400">Message</span>
</div>

{/* Icon sizes: ALWAYS size-4 for alert icons */}
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 9. LIST ITEMS ═══════════════════════════════════════════════════ */}
      <Section
        id="list-items"
        title="List Items"
        description="Standard list item pattern: hoverable card with icon, content, and trailing action."
      >
        <div className="space-y-2">
          {/* Standard list item */}
          <div className="group flex items-center justify-between p-4 rounded-xl border bg-card transition-colors hover:bg-muted/40">
            <div className="flex items-center gap-3 min-w-0">
              <KeyRound className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">My SSH Key</div>
                <div className="text-xs text-muted-foreground font-mono truncate">SHA256:abc123def456...</div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground hidden sm:block">2 days ago</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* List item with badge */}
          <div className="group flex items-center justify-between p-4 rounded-xl border bg-card transition-colors hover:bg-muted/40">
            <div className="flex items-center gap-3 min-w-0">
              <Globe className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium font-mono truncate">https://example.com/webhooks</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <Badge variant="default" className="text-[10px] px-1.5 py-0">Active</Badge>
                  <span>·</span>
                  <span>All events</span>
                  <span>·</span>
                  <span>3 days ago</span>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        <CodeBlock title="List item pattern" lang="tsx">{`
<div className="group flex items-center justify-between p-4 rounded-xl border bg-card transition-colors hover:bg-muted/40">
  <div className="flex items-center gap-3 min-w-0">
    <Icon className="size-4 text-muted-foreground shrink-0" />
    <div className="min-w-0">
      <div className="text-sm font-medium">Name</div>
      <div className="text-xs text-muted-foreground">Details</div>
    </div>
  </div>
  <Button
    variant="ghost"
    size="icon-sm"
    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
  >
    <Trash2 className="size-3.5" />
  </Button>
</div>
        `}</CodeBlock>
      </Section>

      <Separator />

      {/* ═══ 10. DIALOGS ═══════════════════════════════════════════════════════ */}
      <Section
        id="dialogs"
        title="Dialogs"
        description="All dialogs have Cancel + Primary button in footer. Loading state shows spinner + text."
      >
        <Button onClick={() => setSampleDialogOpen(true)}>
          Open Sample Dialog
        </Button>

        <CodeBlock title="Dialog pattern" lang="tsx">{`
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>Helpful description text.</DialogDescription>
    </DialogHeader>
    <div className="space-y-4">
      {/* Form fields */}
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      <Button onClick={handleSubmit} disabled={isPending || !isValid}>
        {isPending ? (
          <><Loader2 className="size-4 animate-spin" />Creating...</>
        ) : (
          "Create Item"
        )}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
        `}</CodeBlock>

        <Dialog open={sampleDialogOpen} onOpenChange={setSampleDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Item</DialogTitle>
              <DialogDescription>Fill in the details to create a new item.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sample-name">Name</Label>
                <Input id="sample-name" placeholder="my-item" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSampleDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => setSampleDialogOpen(false)}>Create Item</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Separator />

      {/* ═══ 11. BADGES ════════════════════════════════════════════════════════ */}
      <Section
        id="badges"
        title="Badges"
        description="Status badges with semantic colors. Status dots are size-1.5."
      >
        <div className="rounded-xl border p-5 space-y-4">
          {/* Status badges */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status Badges</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1.5 text-[11px] font-medium h-5 px-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Running
              </Badge>
              <Badge variant="outline" className="gap-1.5 text-[11px] font-medium h-5 px-2 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">
                <span className="size-1.5 rounded-full bg-yellow-500 animate-pulse" />
                Provisioning
              </Badge>
              <Badge variant="outline" className="gap-1.5 text-[11px] font-medium h-5 px-2 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                <span className="size-1.5 rounded-full bg-red-500" />
                Error
              </Badge>
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                Stopped
              </Badge>
            </div>
          </div>

          {/* Generic badges */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Standard Variants</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>
          </div>

          {/* Tiny inline labels */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tiny Labels</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Kortix</Badge>
              <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">Active</Badge>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inactive</Badge>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">Included</Badge>
            </div>
          </div>
        </div>
      </Section>

      <Separator />

      {/* ═══ 12. GRID LAYOUTS ══════════════════════════════════════════════════ */}
      <Section
        id="grids"
        title="Grid Layouts"
        description="Standard grid patterns: gap-4 always. Cards use xl:grid-cols-3, stats use md:grid-cols-4, settings use sm:grid-cols-2."
      >
        <div className="space-y-6">
          {/* Card grid */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Card Grid — 1 / 2 / 3 cols</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border bg-card p-5">
                  <p className="text-sm font-medium">Card {i}</p>
                  <p className="text-xs text-muted-foreground mt-1">grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stats grid */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Stats Grid — 2 / 4 cols</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-xl border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Stat {i}</p>
                  <p className="text-xl font-semibold mt-1">{i * 25}%</p>
                </div>
              ))}
            </div>
          </div>

          {/* Settings grid */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Settings Grid — 1 / 2 cols</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-xl border bg-card p-5">
                  <p className="text-sm font-medium">Setting {i}</p>
                  <p className="text-xs text-muted-foreground mt-1">grid-cols-1 sm:grid-cols-2 gap-4</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <CodeBlock title="Grid patterns" lang="tsx">{`
{/* Card grid (machines, images) */}
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

{/* Stats grid (machine detail) */}
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">

{/* Settings grid (billing, settings) */}
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

{/* Gap is ALWAYS gap-4 */}
        `}</CodeBlock>
      </Section>
    </div>
  );
}
