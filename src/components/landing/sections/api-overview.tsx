import Image from "next/image";
import Link from "next/link";
import { TbApi } from "react-icons/tb";
import { SiPython, SiTypescript } from "react-icons/si";
import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────
 * ApiOverview
 *
 * Two-column layout inside the page rails:
 *  - Left:  sticky header (eyebrow, title, subtitle, SDK pills,
 *           full-reference link). Pins to top of viewport as
 *           the user scrolls through the section.
 *  - Right: stacked API-group panels that scroll past the
 *           pinned header. Each panel has icon + title +
 *           description + a list of endpoints with method
 *           badges.
 *
 * Sticky works because the root now uses `overflow-x-clip`
 * instead of `overflow-x-hidden`, and the sticky element is a
 * *child* of a grid cell — the cell auto-stretches to the
 * right column's height and provides the sticky's viewport.
 * ──────────────────────────────────────────────────────────── */

type ApiOp = { method: "GET" | "POST" | "DEL"; label: string };

type OpsGroup = {
  title: string;
  description: string;
  icon: React.ReactNode;
  ops: ApiOp[];
};

type ExternalGroup = {
  title: string;
  description: string;
  icon: React.ReactNode;
  external: string;
  agentFeatures: string[];
};

type ApiGroup = OpsGroup | ExternalGroup;

const API_GROUPS: ApiGroup[] = [
  {
    title: "Machine",
    description:
      "Provision, inspect, and tear down compute. Create machines with specific specs, rebuild from images, snapshot for later.",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    ops: [
      { method: "POST", label: "Create a machine" },
      { method: "GET", label: "List all machines" },
      { method: "GET", label: "Get machine details" },
      { method: "POST", label: "Rebuild a machine" },
      { method: "DEL", label: "Delete a machine" },
      { method: "POST", label: "Create an image" },
      { method: "GET", label: "List images" },
    ],
  },
  {
    title: "Filesystem",
    description:
      "Full file operations on any machine. Upload, download, search, replace, and zip — no SSH required.",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
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
    description:
      "Run commands, stream stdout, kill misbehaving workers. Treat any machine like a remote shell — from code.",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
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
    description:
      "One unified API for Claude Code, Codex, OpenCode, PI Coding. Session lifecycle, streaming events, and a standard schema across every agent.",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <path d="M12 2a4 4 0 014 4v1H8V6a4 4 0 014-4zM7 15h.01M12 15h.01M10 14L21 3" />
      </svg>
    ),
    external: "https://sandboxagent.dev",
    agentFeatures: [
      "Universal Agent API",
      "Session Management",
      "Streaming Events",
      "Universal Schema",
    ],
  },
];

const METHOD_COLORS: Record<ApiOp["method"], string> = {
  GET: "text-emerald-500 bg-emerald-500/10",
  POST: "text-cyan-500 bg-cyan-500/10",
  DEL: "text-red-500 bg-red-500/10",
};

function MethodBadge({ method }: { method: ApiOp["method"] }) {
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold leading-none w-10 text-center shrink-0",
        METHOD_COLORS[method],
      )}
    >
      {method}
    </span>
  );
}

const AGENT_LOGOS = [
  { src: "/logos/ai-coding-agent-logos/claude-code-icon.png", alt: "Claude Code", cls: "rounded-sm" },
  { src: "/logos/ai-coding-agent-logos/codex-openai-icon.png", alt: "Codex", cls: "" },
  { src: "/logos/ai-coding-agent-logos/opencode-logo-dark.png", alt: "OpenCode", cls: "dark:invert-0 invert" },
  { src: "/logos/ai-coding-agent-logos/pi-coding-agent-icon-dark.png", alt: "PI Coding", cls: "dark:invert-0 invert" },
];

const SDK_PILLS = [
  { icon: <SiPython className="size-3.5" />, label: "Python" },
  { icon: <SiTypescript className="size-3.5" />, label: "TypeScript" },
  { icon: <TbApi className="size-3.5" />, label: "REST" },
];

function ApiGroupPanel({ group }: { group: ApiGroup }) {
  return (
    <div className="px-8 py-12 md:p-12 lg:p-14">
      {/* Panel header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-muted/50 border border-border/60 flex items-center justify-center text-foreground/80">
          {group.icon}
        </div>
        <h3 className="text-xl font-medium tracking-tight">{group.title}</h3>
        {"ops" in group && (
          <span className="ml-auto text-[11px] text-muted-foreground font-mono">
            {group.ops.length} endpoints
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed mb-7 max-w-lg">
        {group.description}
      </p>

      {"ops" in group ? (
        <div className="rounded-xl border border-border/60 overflow-hidden divide-y divide-border/60">
          {group.ops.map((op) => (
            <div
              key={op.label}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <MethodBadge method={op.method} />
              <code className="text-[13px] text-foreground/90 font-mono">
                {op.label}
              </code>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {/* Agent logos row */}
          <div className="flex items-center gap-2 mb-5">
            {AGENT_LOGOS.map(({ src, alt, cls }) => (
              <div
                key={alt}
                className="size-9 rounded-lg border border-border/60 bg-muted/30 flex items-center justify-center overflow-hidden shrink-0"
                title={alt}
              >
                <Image
                  src={src}
                  alt={alt}
                  width={22}
                  height={22}
                  className={cn("size-[22px] object-contain", cls)}
                />
              </div>
            ))}
            <span className="text-xs text-muted-foreground ml-1">+ more</span>
          </div>

          {/* Features list */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6 max-w-md">
            {(group as ExternalGroup).agentFeatures.map((f) => (
              <div key={f} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="size-1 rounded-full bg-foreground/30 shrink-0" />
                {f}
              </div>
            ))}
          </div>

          {/* External links */}
          <div className="flex flex-wrap items-center gap-4 text-[13px] font-medium">
            <a
              href={(group as ExternalGroup).external}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-foreground hover:underline"
            >
              sandboxagent.dev
              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
            <a
              href="https://sandboxagent.dev/docs/agent-sessions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              Agent Sessions
              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApiOverview() {
  return (
    <section id="api" className="relative">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-px bg-border/60">
        {/* ── Sticky header column ── */}
        <div className="bg-background">
          <div className="lg:sticky lg:top-24 px-8 py-12 md:p-12 lg:p-14">
            <p className="text-[11px] text-purple-500 uppercase tracking-[0.24em] mb-5 font-medium">
              API
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground">
              Programmatic control over everything.
            </h2>
            <p className="text-sm md:text-[15px] text-muted-foreground mt-5 max-w-sm leading-relaxed">
              Machine, Filesystem, Process, and Coding Agents &mdash; all via one API.
            </p>

            {/* SDK pills */}
            <div className="flex flex-wrap items-center gap-2 mt-7">
              {SDK_PILLS.map((sdk) => (
                <span
                  key={sdk.label}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 bg-muted/30 text-muted-foreground text-[11px] font-medium"
                >
                  {sdk.icon}
                  {sdk.label}
                </span>
              ))}
            </div>

            {/* Full reference link */}
            <div className="mt-7">
              <Link
                href="/api/docs"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border/60 bg-muted/30 text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-muted/50 transition-all duration-200"
              >
                Full API Reference
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </Link>
            </div>
          </div>
        </div>

        {/* ── Scrolling panels column ── */}
        <div className="bg-background divide-y divide-border/60">
          {API_GROUPS.map((group) => (
            <ApiGroupPanel key={group.title} group={group} />
          ))}
        </div>
      </div>
    </section>
  );
}
