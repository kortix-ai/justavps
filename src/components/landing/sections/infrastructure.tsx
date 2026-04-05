import { PROXY_DOMAIN } from "@/lib/utils";
import { Reveal } from "@/components/landing/shared/reveal";

/* ────────────────────────────────────────────────────────────
 * Infrastructure
 *
 * Follows the same bento pattern as SupportedAgents:
 *  - single edge-to-edge grid inside the PageFrame rails
 *  - `gap-px + bg-border` trick for internal dividers
 *  - first cell is the section header, spans col 1 rows 1-3 on
 *    desktop (and full width on mobile/tablet)
 *  - remaining 6 cells are the features
 *
 * No glows, no per-cell borders, no rounded cards — just flat
 * cells that align with the page rails.
 * ──────────────────────────────────────────────────────────── */

type Feature = {
  title: string;
  desc: React.ReactNode;
  icon: React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    title: "Always on",
    desc: "Your machine runs 24/7. Close your laptop, agents keep working. Come back tomorrow — everything is still there.",
    icon: (
      <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: "Persistent storage",
    desc: "Real SSD. Files, Docker volumes, databases — nothing vanishes between sessions. Daily automatic backups.",
    icon: (
      <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      </svg>
    ),
  },
  {
    title: "Secure by default",
    desc: (
      <>
        Zero open ports. Auth proxy on every port via{" "}
        <span className="font-mono text-[12px] text-foreground">
          {`{port}--{slug}.${PROXY_DOMAIN}`}
        </span>
        . SSH keys, API keys, session auth.
      </>
    ),
    icon: (
      <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
  },
  {
    title: "EU & US regions",
    desc: "Deploy where your users are. Helsinki and Hillsboro, OR. Region-specific pricing, same experience.",
    icon: (
      <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
  },
  {
    title: "Full API control",
    desc: "Machine, filesystem, process, and agent APIs. Python SDK, TypeScript SDK, or raw REST.",
    icon: (
      <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    title: "Any AI agent",
    desc: "Claude Code, Codex, OpenCode, PI Coding, Cursor — or anything else that runs on Linux.",
    icon: (
      <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2a4 4 0 014 4v1H8V6a4 4 0 014-4z" />
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="9" cy="16" r="1" />
        <circle cx="15" cy="16" r="1" />
      </svg>
    ),
  },
];

export function Infrastructure() {
  return (
    <section id="infrastructure" className="relative">
      <Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border/60">
          {/* Header cell — spans col 1 rows 1-3 on lg, top row on sm, full row on mobile */}
          <div className="bg-background col-span-1 sm:col-span-2 lg:col-span-1 lg:row-span-3 px-8 py-12 md:p-12 lg:p-14 flex flex-col">
            <p className="text-[11px] text-emerald-500 uppercase tracking-[0.24em] mb-5 font-medium">
              Infrastructure
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-medium tracking-[-0.03em] leading-[1.05] text-foreground">
              Machines that don&apos;t disappear
            </h2>
            <p className="text-sm md:text-[15px] text-muted-foreground mt-5 max-w-sm leading-relaxed">
              Not ephemeral containers. Persistent compute with real IPs, daily backups, and authenticated access on every port.
            </p>
          </div>

          {/* Feature cells */}
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-background px-8 py-10 md:p-10 lg:p-12 flex flex-col"
            >
              <div className="text-muted-foreground mb-5">{f.icon}</div>
              <h3 className="text-[15px] font-medium text-foreground mb-2">{f.title}</h3>
              <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
