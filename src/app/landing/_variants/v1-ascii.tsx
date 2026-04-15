"use client";

/* ═══════════════════════════════════════════════════════════════════
 *  V1 · "ASCII"   —   monochrome monospace
 *  Same content depth as V3/V2, terminal-document treatment.
 * ═══════════════════════════════════════════════════════════════════ */

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  bestFitShape,
  fmtHourly,
  getStartingPrice,
  justavpsHourly,
  justavpsMonthly,
  vendorHourly,
  vendorMonthly,
  JUSTAVPS_RATES,
  VENDOR_RATES,
  type VendorKey,
  SHAPES,
} from "../_shared/plan-data";
import { AsciiSlider, Reveal } from "../_shared/interactive";

const BG = "#0A0A0A";
const FG = "#F3EFE3";
const DIM = "#8F8A7C";
const MUT = "#5B5850";
const SOFT = "#1A1915";

export function V1Ascii({ onDeploy }: { onDeploy: () => void }) {
  const start = getStartingPrice();
  return (
    <div
      className="min-h-screen"
      style={{ background: BG, color: FG, fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}
    >
      <Nav onDeploy={onDeploy} />
      <Hero onDeploy={onDeploy} start={start} />
      <Tax />
      <Calculator onDeploy={onDeploy} />
      <UseCases onDeploy={onDeploy} />
      <SecureBanner />
      <PricingTable onDeploy={onDeploy} />
      <WhenToUse />
      <About />
      <Faq />
      <Closer onDeploy={onDeploy} start={start} />
      <Footer />
      <FloatingCta onDeploy={onDeploy} start={start} />
    </div>
  );
}

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block">
      <span aria-hidden className="absolute inset-x-[-4px] bottom-[10%] h-[40%] -z-0"
            style={{ background: `${FG}30`, borderRadius: 2 }} />
      <span className="relative">{children}</span>
    </span>
  );
}

/* ══════ NAV ════════════════════════════════════════════════════ */
function Nav({ onDeploy }: { onDeploy: () => void }) {
  return (
    <header className="sticky top-10 z-40 border-b backdrop-blur" style={{ borderColor: SOFT, background: "rgba(10,10,10,0.85)" }}>
      <div className="mx-auto flex max-w-[980px] items-center justify-between px-5 py-3.5 text-[13px]">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="inline-flex size-5 items-center justify-center rounded-[3px]" style={{ background: FG }}>
            <span className="block size-1.5" style={{ background: BG }} />
          </span>
          <span>just a vps</span>
        </a>
        <nav className="hidden gap-7 md:flex" style={{ color: DIM }}>
          {[["./tax", "#tax"], ["./calc", "#calc"], ["./pricing", "#pricing"], ["./faq", "#faq"]].map(([l, h]) => (
            <a key={l} href={h} className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>{l}</a>
          ))}
        </nav>
        <button onClick={onDeploy} className="border px-3 py-1.5 text-[12.5px] hover:bg-[color:var(--f)] hover:text-[color:var(--b)]"
                style={{ borderColor: FG, ["--f" as string]: FG, ["--b" as string]: BG }}>
          deploy →
        </button>
      </div>
    </header>
  );
}

/* ══════ HERO ═══════════════════════════════════════════════════ */
function Hero({ onDeploy, start }: { onDeploy: () => void; start: number }) {
  const logos = [
    { src: "/logos/ai-coding-agent-logos/claude-code-icon.png", alt: "claude code", invert: false },
    { src: "/logos/ai-coding-agent-logos/codex-openai-icon.png", alt: "codex" },
    { src: "/logos/ai-coding-agent-logos/opencode-logo-dark.png", alt: "opencode", invert: true },
    { src: "/logos/ai-coding-agent-logos/cursor-icon.png", alt: "cursor" },
    { src: "/logos/ai-coding-agent-logos/vscode-icon.png", alt: "vs code" },
    { src: "/logos/ai-coding-agent-logos/pi-coding-agent-icon-dark.png", alt: "pi coding", invert: true },
    { src: "/logos/ai-coding-agent-logos/docker-icon.png", alt: "docker" },
  ];
  return (
    <section id="top" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 pt-24 pb-20 text-center sm:pt-32">
        <Reveal>
          <div className="inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
            <span className="block h-px w-10" style={{ background: DIM }} />
            per-second metered · ~10× cheaper than sandboxes
            <span className="block h-px w-10" style={{ background: DIM }} />
          </div>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="mx-auto mt-7 max-w-[860px] text-[58px] font-semibold leading-[0.96] tracking-[-0.03em] sm:text-[84px] lg:text-[96px]">
            Just a VPS.
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-7 max-w-[600px] text-[19px] leading-[1.55] sm:text-[21px]" style={{ color: "rgba(243,239,227,0.85)" }}>
            A dedicated Linux machine for AI agents that run 24/7 — same metered model
            as Daytona / E2B / Modal, at <Highlight>~10× the price per CPU-hour</Highlight>.
          </p>
        </Reveal>
        <Reveal delay={240}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onDeploy} className="inline-flex h-11 items-center gap-2 border px-5 text-[13px]" style={{ borderColor: FG, background: FG, color: BG }}>
              deploy a box →
            </button>
            <a href="#calc" className="inline-flex h-11 items-center gap-2 border px-5 text-[13px]" style={{ borderColor: FG, color: FG }}>
              see the math
            </a>
          </div>
          <p className="mt-3 text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
            from ${start}/mo at 24/7 · billed by the second · cancel anytime
          </p>
        </Reveal>

        <Reveal delay={320}>
          <div className="mt-14 flex flex-col items-center gap-5">
            <span className="text-[10.5px] uppercase tracking-[0.26em]" style={{ color: MUT }}>
              # home to your favourite agent harness
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              {logos.map((l) => (
                <div key={l.alt} className="inline-flex items-center gap-2 border px-2.5 py-1.5" style={{ borderColor: SOFT }}>
                  <Image src={l.src} alt={l.alt} width={14} height={14} className={`size-[14px] object-contain ${l.invert ? "invert" : ""}`} />
                  <span className="text-[11px]" style={{ color: DIM }}>{l.alt}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ TAX · annotated invoice ═══════════════════════════════ */
function Tax() {
  const sandboxMonthly = vendorMonthly("daytona", 4, 8, 24);
  const usMonthly = justavpsMonthly(4, 8, 160);
  const yearLoss = (sandboxMonthly - usMonthly) * 12;
  return (
    <section id="tax" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-24">
        <Reveal>
          <div className="text-center">
            <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
              # § 01 · the sandbox tax
            </div>
            <h2 className="mx-auto mt-4 max-w-[760px] text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
              Imagine your agent on Daytona.
              <br />
              <span style={{ color: DIM }}>30 days later, the invoice arrives.</span>
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
          <Reveal delay={120}>
            <div className="border" style={{ borderColor: FG }}>
              <pre className="overflow-x-auto p-5 text-[12.5px] leading-[1.85]">
{`# INVOICE · DAYTONA · APRIL 2026
# acct · agent-prod · paid

  cpu  · 4 vCPU × 730 h ............. $${(VENDOR_RATES.daytona.vPerVcpu * 4 * 730).toFixed(2).padStart(7)}
  ram  · 8 GB   × 730 h ............. $${(VENDOR_RATES.daytona.vPerGb * 8 * 730).toFixed(2).padStart(7)}
  disk · 160 GB · bundled ........... $   0.00
  ─────────────────────────────────────────────
`}<span style={{ color: FG }}>{`  TOTAL  ─────────────────────  ▶  $${sandboxMonthly}.42`}</span>
{`

  ← for one machine. one agent. one month.`}
              </pre>
            </div>
          </Reveal>

          <Reveal delay={200}>
            <div className="flex h-full flex-col justify-between gap-5 border p-6" style={{ borderColor: SOFT, background: "rgba(243,239,227,0.02)" }}>
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
                  # same shape · same hours · just a vps
                </div>
                <div className="mt-3 text-[64px] font-semibold leading-none tracking-[-0.03em] sm:text-[80px]">
                  ${usMonthly}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
                  4 vCPU · 8 GB · 160 GB · 24/7
                </div>
              </div>
              <pre className="border-t pt-4 text-[12.5px] leading-[1.95]" style={{ borderColor: SOFT }}>
{`save / month .... $${(sandboxMonthly - usMonthly).toString().padStart(4)}
save / year  .... $${((sandboxMonthly - usMonthly) * 12).toString().padStart(4)}
× 10  agents .... $${(yearLoss * 10).toLocaleString().padStart(8)}/yr
× 100 agents .... $${(yearLoss * 100).toLocaleString().padStart(8)}/yr`}
              </pre>
              <p className="text-[13px] leading-[1.65]" style={{ color: "rgba(243,239,227,0.78)" }}>
                Same metered model as the sandboxes — pay for cpu-seconds, gb-hours of ram,
                gb of disk. We just charge <Highlight>a fraction</Highlight> per unit.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ══════ CALCULATOR ═════════════════════════════════════════════ */
function Calculator({ onDeploy }: { onDeploy: () => void }) {
  const [vcpu, setVcpu] = useState(4);
  const [ram, setRam] = useState(8);
  const [storage, setStorage] = useState(80);

  const fit = bestFitShape(vcpu, ram);
  const usHr = justavpsHourly(vcpu, ram, storage);
  const usMo = justavpsMonthly(vcpu, ram, storage);

  const competitors = useMemo(
    () =>
      (Object.keys(VENDOR_RATES) as VendorKey[]).map((k) => ({
        k, name: VENDOR_RATES[k].name.toLowerCase(),
        hr: vendorHourly(k, vcpu, ram),
        mo: vendorMonthly(k, vcpu, ram, 24),
      })),
    [vcpu, ram],
  );
  const avgMo = competitors.reduce((a, c) => a + c.mo, 0) / competitors.length;
  const multiple = Math.max(1, Math.round(avgMo / Math.max(1, usMo)));

  const rows: { name: string; hr: number; mo: number; us?: boolean }[] = [
    ...competitors.map((c) => ({ name: c.name, hr: c.hr, mo: c.mo })),
    { name: "just a vps", hr: usHr, mo: usMo, us: true },
  ];

  return (
    <section id="calc" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-24">
        <Reveal>
          <div className="text-center">
            <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
              # § 02 · run the math yourself
            </div>
            <h2 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
              Shape the box. Compare side by side.
            </h2>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="space-y-3">
              <div className="border p-5" style={{ borderColor: SOFT }}>
                <div className="flex items-baseline justify-between text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
                  <span>your workload</span>
                  <span style={{ color: FG }}>{fit.label.toLowerCase()}</span>
                </div>
                <div className="mt-5 space-y-7">
                  <AsciiSlider label="vCPU"    min={1}  max={16}   value={vcpu}    onChange={setVcpu}    unit="cores" />
                  <AsciiSlider label="memory"  min={1}  max={32}   value={ram}     onChange={setRam}     unit="GB" />
                  <AsciiSlider label="storage" min={20} max={1000} value={storage} onChange={setStorage} unit="GB" step={10} />
                </div>
              </div>
              <div className="border p-5" style={{ borderColor: FG, background: "rgba(243,239,227,0.03)" }}>
                <div className="text-[10.5px] uppercase tracking-[0.22em]" style={{ color: FG }}>
                  just a vps · billed by the second
                </div>
                <pre className="mt-3 text-[12.5px] leading-[1.95]">
{`per sec   $${(usHr / 3600).toFixed(7)}
per hour  ${fmtHourly(usHr)}
24/7 mo   $${usMo}`}
                </pre>
                <p className="mt-3 text-[11.5px] leading-[1.65]" style={{ color: DIM }}>
                  &gt; you only pay for the seconds your agent uses CPU, the gb-hours of ram it touches, and the gb of disk it stores.
                </p>
                <button onClick={onDeploy} className="mt-4 block w-full border px-3 py-2 text-left text-[12.5px] hover:bg-[color:var(--f)] hover:text-[color:var(--b)]"
                        style={{ borderColor: FG, ["--f" as string]: FG, ["--b" as string]: BG }}>
                  $ justavps deploy --plan {fit.id}
                </button>
              </div>
            </div>

            <div className="border" style={{ borderColor: SOFT }}>
              <div className="flex items-center justify-between border-b px-5 py-2.5 text-[10.5px] uppercase tracking-[0.22em]" style={{ borderColor: SOFT, color: DIM }}>
                <span>{vcpu} vCPU · {ram} GB · {storage} GB · 24/7</span>
                <span>hourly → monthly</span>
              </div>
              <pre className="overflow-x-auto px-5 py-4 text-[12.5px] leading-[2]">
<span style={{ color: DIM }}>
{`vendor       $/hour     $/month   `}
{"vs us\n"}
{"─".repeat(50)}
{"\n"}
</span>
{rows.map((r, i) => (
  <span key={i} style={r.us ? { color: FG } : {}}>
    {(r.us ? "▸ " : "  ") + r.name.padEnd(11)}
    {fmtHourly(r.hr).padStart(8)}
    {"   "}
    {("$" + String(r.mo).padStart(5)).padEnd(11)}
    {r.us ? "1×" : `${Math.max(1, Math.round(r.mo / Math.max(1, usMo)))}×`}
    {"\n"}
  </span>
))}
              </pre>
              <div className="border-t px-5 py-3 text-center text-[11.5px] uppercase tracking-[0.22em]" style={{ borderColor: SOFT, color: DIM }}>
                ≈ <b style={{ color: FG }}>{multiple}× cheaper</b> than the average sandbox at this shape
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={240}>
          <p className="mt-5 text-center text-[11px]" style={{ color: MUT }}>
            our rates · ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}/vCPU·h · ${JUSTAVPS_RATES.vPerGb.toFixed(4)}/GB-RAM·h · ${(JUSTAVPS_RATES.vPerStorage * 730).toFixed(3)}/GB-storage·month
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ USE CASES ═════════════════════════════════════════════ */
function UseCases({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-24">
        <Reveal>
          <div className="text-center">
            <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
              # § 03 · two ways to use it
            </div>
            <h2 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
              Personal box, or sandboxes-as-a-service.
            </h2>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <Reveal delay={120}>
            <UseCard tag="personal" title="Your dev machine in the cloud" body="ssh in or connect your IDE — it's just a Linux box. close your laptop, your agents keep going. come back tomorrow, everything's still there." terminal />
          </Reveal>
          <Reveal delay={200}>
            <UseCard tag="service" title="Sandboxes as infrastructure" body="spin up machines, manage files, run bash, launch coding agents — all from one API. give every user (and their agents) a sandbox of their own." capabilities />
          </Reveal>
        </div>

        <div className="mt-10 text-center">
          <button onClick={onDeploy} className="inline-flex h-11 items-center gap-2 border px-5 text-[13px]" style={{ borderColor: FG, background: FG, color: BG }}>
            get your machine →
          </button>
          <p className="mt-2 text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
            ssh ready in ~10 seconds
          </p>
        </div>
      </div>
    </section>
  );
}

function UseCard({ tag, title, body, terminal, capabilities }: { tag: string; title: string; body: string; terminal?: boolean; capabilities?: boolean }) {
  return (
    <div className="flex h-full flex-col border" style={{ borderColor: SOFT }}>
      <div className="flex-1 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <span className="border px-2 py-0.5 text-[9.5px] uppercase tracking-[0.22em]" style={{ borderColor: FG, color: FG }}>{tag}</span>
        </div>
        <p className="mt-3 text-[13px] leading-[1.65]" style={{ color: DIM }}>{body}</p>
      </div>
      <div className="border-t p-4" style={{ borderColor: SOFT }}>
        {terminal && (
          <pre className="text-[12px] leading-[1.7]">
<span style={{ color: DIM }}># Connect from Cursor, VS Code, or terminal{"\n"}</span>
<span style={{ color: FG }}>$</span> ssh root@95.217.x.x{"\n"}
<span style={{ color: FG }}>$</span> opencode{"\n"}
<span style={{ color: DIM }}>› Open the machine URL in your browser</span>
          </pre>
        )}
        {capabilities && (
          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            {[
              ["machines", "create, list, resize, delete"],
              ["filesystem", "read, write, search, upload"],
              ["process", "exec, stream, kill"],
              ["agents", "OpenCode, Codex, Claude…"],
            ].map(([l, d]) => (
              <div key={l} className="border p-2" style={{ borderColor: SOFT }}>
                <div style={{ color: FG }}>{l}</div>
                <div className="text-[10px]" style={{ color: DIM }}>{d}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════ SECURE BANNER ═════════════════════════════════════════ */
function SecureBanner() {
  return (
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-16">
        <Reveal>
          <div className="border" style={{ borderColor: SOFT }}>
            <div className="flex flex-col gap-5 px-6 py-6 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex size-10 shrink-0 items-center justify-center border" style={{ borderColor: FG }}>
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke={FG} strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              </div>
              <div className="flex-1">
                <h3 className="text-[16px] font-semibold">Secure by default. Zero config.</h3>
                <p className="mt-1 text-[13.5px] leading-[1.6]" style={{ color: DIM }}>
                  browser traffic flows through an authenticated proxy. ssh uses keys, not passwords. bind a port — get a password-locked HTTPS URL.
                </p>
              </div>
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                {["auth proxy", "ssh keys", "api keys", "sessions"].map((c) => (
                  <span key={c} className="border px-2 py-1 text-[10.5px] uppercase tracking-[0.2em]" style={{ borderColor: FG, color: FG }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <pre className="overflow-x-auto border-t px-6 py-3 text-[12px] leading-[1.7]" style={{ borderColor: SOFT, background: "#050505" }}>
<span style={{ color: FG }}>$</span> curl https://8000-box-7f3.justavps.cloud -H <span style={{ color: "#FFB454" }}>&quot;Authorization: Bearer sk_live_…&quot;</span>
            </pre>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ PRICING TABLE ════════════════════════════════════════ */
function PricingTable({ onDeploy }: { onDeploy: () => void }) {
  const rows = SHAPES.map((s) => {
    const ourMo = justavpsMonthly(s.vcpu, s.memory, s.disk);
    const dayMo = vendorMonthly("daytona", s.vcpu, s.memory, 24);
    return { ...s, ourMo, dayMo, saves: Math.max(1, Math.round(dayMo / Math.max(1, ourMo))) };
  });
  return (
    <section id="pricing" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-24">
        <Reveal>
          <div className="text-center">
            <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
              # § 04 · pricing
            </div>
            <h2 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
              You&apos;re paying <Highlight>10× too much</Highlight> for always-on agents.
            </h2>
            <p className="mx-auto mt-4 max-w-[600px] text-[14px] leading-[1.65]" style={{ color: DIM }}>
              per-second billing sounds cheap — until your agent runs 24/7. here&apos;s what a month of continuous usage actually costs.
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12 border" style={{ borderColor: SOFT }}>
            <pre className="overflow-x-auto p-5 text-[12.5px] leading-[2]">
<span style={{ color: DIM }}>
{`shape         daytona/e2b *    just a vps    save\n${"─".repeat(56)}\n`}
</span>
{rows.map((r, i) => {
  const recommend = i === 2;
  return (
    <span key={r.id} style={recommend ? { color: FG } : {}}>
      {(recommend ? "▸ " : "  ") + r.label.padEnd(10)}
      <span style={{ color: DIM, textDecoration: "line-through" }}>{("$" + r.dayMo + "/mo").padStart(11)}</span>
      {"     "}
      {("$" + r.ourMo + "/mo").padEnd(11)}
      {"  "}
      {r.saves}×{"\n"}
    </span>
  );
})}
            </pre>
          </div>
          <p className="mt-3 text-[11px]" style={{ color: MUT }}>
            * based on daytona / e2b published per-second cpu + ram rates × 730 h continuous. eu shape shown.
          </p>
          <div className="mt-6 text-center">
            <button onClick={onDeploy} className="inline-flex h-11 items-center gap-2 border px-5 text-[13px]" style={{ borderColor: FG, background: FG, color: BG }}>
              get a machine →
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ WHEN TO USE ═══════════════════════════════════════════ */
function WhenToUse() {
  return (
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-20">
        <Reveal>
          <h2 className="text-center text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[34px]">
            We&apos;re not for every workload. <span style={{ color: DIM }}>Here&apos;s when to use what.</span>
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Reveal delay={120}>
            <div className="relative border-2 p-5" style={{ borderColor: FG }}>
              <span className="absolute -top-2.5 left-4 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]" style={{ background: FG, color: BG }}>recommended</span>
              <h3 className="mt-1 flex items-center gap-2 text-[15px] font-semibold">
                <span className="border px-1.5" style={{ borderColor: FG, color: FG }}>✓</span>
                use just a vps when
              </h3>
              <ul className="mt-4 space-y-2 text-[13px] leading-[1.55]" style={{ color: "rgba(243,239,227,0.85)" }}>
                <li>your agents run <b>24/7</b>, not minutes.</li>
                <li>you need <b>persistent state</b> — files, docker, dbs.</li>
                <li>you want <b>predictable cost</b>, no bill shock.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={200}>
            <div className="border p-5" style={{ borderColor: SOFT }}>
              <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                <span className="border px-1.5" style={{ borderColor: SOFT, color: DIM }}>→</span>
                stick with sandboxes when
              </h3>
              <ul className="mt-4 space-y-2 text-[13px] leading-[1.55]" style={{ color: DIM }}>
                <li>sandboxes only live <b style={{ color: FG }}>minutes</b>, not months.</li>
                <li>you need <b style={{ color: FG }}>sub-second spin-up</b> per request.</li>
                <li>you only pay when code is <b style={{ color: FG }}>actively running</b>.</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ══════ ABOUT ═════════════════════════════════════════════════ */
function About() {
  return (
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-20">
        <Reveal>
          <div className="border" style={{ borderColor: SOFT }}>
            <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
              <div className="relative aspect-[4/3] md:aspect-auto" style={{ background: "#050505" }}>
                <Image src="/team.png" alt="Kortix team" fill className="object-cover opacity-70" />
                <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(10,10,10,0.6) 100%)" }} />
              </div>
              <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
                <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
                  # § 05 · why we built this
                </div>
                <h3 className="text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[28px]">
                  We hit the sandbox tax ourselves.
                </h3>
                <p className="text-[13.5px] leading-[1.65]" style={{ color: "rgba(243,239,227,0.78)" }}>
                  we ran <Highlight>3+ million sandboxes</Highlight> on incumbent providers building{" "}
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80" style={{ color: FG }}>kortix</a> — the autonomous company OS.
                  we hit the cost ceiling. so we rebuilt the infrastructure we needed for ourselves.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px]" style={{ borderColor: SOFT, color: DIM }}>kortix.com ↗</a>
                  <a href="https://github.com/kortix-ai/suna" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px]" style={{ borderColor: SOFT, color: DIM }}>github.com/kortix-ai/suna ↗</a>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ FAQ ═══════════════════════════════════════════════════ */
function Faq() {
  const items = [
    { q: "what if i don't like it?", a: "cancel anytime. no contracts, no lock-in. your data is yours — download it and leave whenever you want." },
    { q: "is it really cheaper?", a: "do the math yourself in the calculator above. daytona, e2b, modal and others charge per-second — $0.05+/h per vCPU, $0.016+/h per GiB RAM. run that 24/7 for a month and compare. we're 8–10× cheaper, every time." },
    { q: "how fast can i get started?", a: "a couple of minutes. pick a shape, we provision your machine, you ssh in. that's it." },
    { q: "what about security?", a: "browser access is gated by an authenticated proxy, and ssh uses keys instead of passwords. api keys and session-based auth are both supported." },
    { q: "which agents can i run?", a: "claude code, codex, opencode, pi coding agents, cursor workflows, and any other linux-based agent. it's a persistent linux machine — install what you want, run it 24/7." },
  ];
  return (
    <section id="faq" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[760px] px-5 py-24">
        <Reveal>
          <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
            # still on the fence?
          </div>
          <h2 className="mt-4 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
            The honest answers.
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-10 space-y-2">
            {items.map((it, i) => <FaqItem key={i} q={it.q} a={it.a} />)}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border" style={{ borderColor: SOFT }}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <span className="text-[14.5px]">{q}</span>
        <span className="text-[16px] leading-none" style={{ color: FG }}>{open ? "[−]" : "[+]"}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-[13px] leading-[1.7]" style={{ color: DIM }}>{a}</div>
      )}
    </div>
  );
}

/* ══════ CLOSER ═════════════════════════════════════════════════ */
function Closer({ onDeploy, start }: { onDeploy: () => void; start: number }) {
  return (
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-32 text-center">
        <Reveal>
          <h2 className="text-[48px] font-semibold leading-[0.95] tracking-[-0.025em] sm:text-[80px]">
            Get a machine.
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-[420px] text-[15px]" style={{ color: "rgba(243,239,227,0.78)" }}>
            from ${start}/mo at 24/7 · billed by the second · cancel anytime.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <button onClick={onDeploy} className="mt-10 inline-flex h-12 items-center gap-2 border px-6 text-[14px]" style={{ borderColor: FG, background: FG, color: BG }}>
            $ deploy now →
          </button>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ FOOTER ═════════════════════════════════════════════════ */
function Footer() {
  return (
    <footer className="py-10">
      <div className="mx-auto flex max-w-[980px] flex-col items-center gap-3 px-5 sm:flex-row sm:justify-between text-[12px]" style={{ color: MUT }}>
        <span>just a vps · © {new Date().getFullYear()} · by <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>kortix</a></span>
        <div className="flex flex-wrap gap-5">
          <a href="#calc" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>./pricing</a>
          <a href="#faq" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>./faq</a>
          <a href="/docs" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>./docs</a>
          <a href="/login" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>./login</a>
          <a href="mailto:hey@justavps.com" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>./contact</a>
        </div>
      </div>
    </footer>
  );
}

/* ══════ FLOATING CTA ═══════════════════════════════════════════ */
function FloatingCta({ onDeploy, start }: { onDeploy: () => void; start: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 600);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 border py-1.5 pl-4 pr-1.5 backdrop-blur transition-all duration-300 ${show ? "opacity-100" : "pointer-events-none translate-y-20 opacity-0"}`}
      style={{ borderColor: FG, background: "rgba(10,10,10,0.92)" }}
    >
      <span className="hidden text-[12px] sm:inline" style={{ color: DIM }}>
        from <b style={{ color: FG }}>${start}/mo</b>
      </span>
      <button onClick={onDeploy} className="border px-3 py-1.5 text-[12px] hover:bg-[color:var(--f)] hover:text-[color:var(--b)]"
              style={{ borderColor: FG, ["--f" as string]: FG, ["--b" as string]: BG }}>
        $ DEPLOY →
      </button>
    </div>
  );
}
