"use client";

/* ═══════════════════════════════════════════════════════════════════
 *  V2 · "Blueprint"   —   ice · ink · cobalt
 *  Same content depth as V3, schematic-engineering visual treatment.
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
import { Reveal } from "../_shared/interactive";

const BG = "#F2F4F8";
const PAPER = "#FFFFFF";
const INK = "#0B1220";
const MUT = "#5B657A";
const COBALT = "#2E5AFF";
const HAIR = "#D7DEEA";

export function V2Blueprint({ onDeploy }: { onDeploy: () => void }) {
  const start = getStartingPrice();
  return (
    <div className="relative min-h-screen" style={{ background: BG, color: INK }}>
      <GridPaper />
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

function GridPaper() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 opacity-[0.5]"
         style={{
           backgroundImage: `linear-gradient(to right, rgba(11,18,32,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(11,18,32,0.045) 1px, transparent 1px)`,
           backgroundSize: "24px 24px",
         }} />
  );
}

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block">
      <span aria-hidden className="absolute inset-x-[-4px] bottom-[8%] h-[42%] -z-0 -skew-y-[1deg]"
            style={{ background: `${COBALT}33`, borderRadius: 3 }} />
      <span className="relative">{children}</span>
    </span>
  );
}

/* ══════ NAV ════════════════════════════════════════════════════ */
function Nav({ onDeploy }: { onDeploy: () => void }) {
  return (
    <header className="sticky top-10 z-40 border-b backdrop-blur" style={{ borderColor: HAIR, background: "rgba(242,244,248,0.85)" }}>
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between px-6">
        <a href="#top" className="inline-flex items-center gap-2.5">
          <Mark />
          <span className="font-mono text-[13px]">just a vps</span>
        </a>
        <nav className="hidden gap-7 md:flex">
          {[["the math", "#calc"], ["pricing", "#pricing"], ["faq", "#faq"], ["docs", "/docs"]].map(([l, h]) => (
            <a key={l} href={h} className="text-[13px] transition-colors hover:text-[color:var(--c)]" style={{ color: INK, ["--c" as string]: COBALT }}>{l}</a>
          ))}
        </nav>
        <button onClick={onDeploy} className="inline-flex h-9 items-center rounded-[8px] px-4 text-[12.5px] font-medium text-white" style={{ background: COBALT }}>
          Deploy →
        </button>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 28 28" width="22" height="22" aria-hidden>
      <rect x="0" y="0" width="28" height="28" rx="6" fill={INK} />
      <rect x="5" y="5" width="18" height="18" rx="3" fill={COBALT} />
      <path d="M9 11 L14 14 L9 17" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="16" y="16" width="5" height="1.8" rx="0.5" fill="#fff" />
    </svg>
  );
}

/* ══════ HERO ═══════════════════════════════════════════════════ */
function Hero({ onDeploy, start }: { onDeploy: () => void; start: number }) {
  const logos = [
    { src: "/logos/ai-coding-agent-logos/claude-code-icon.png", alt: "Claude Code" },
    { src: "/logos/ai-coding-agent-logos/codex-openai-icon.png", alt: "Codex" },
    { src: "/logos/ai-coding-agent-logos/opencode-logo-dark.png", alt: "OpenCode" },
    { src: "/logos/ai-coding-agent-logos/cursor-icon.png", alt: "Cursor" },
    { src: "/logos/ai-coding-agent-logos/vscode-icon.png", alt: "VS Code" },
    { src: "/logos/ai-coding-agent-logos/pi-coding-agent-icon-dark.png", alt: "PI Coding" },
    { src: "/logos/ai-coding-agent-logos/docker-icon.png", alt: "Docker" },
  ];
  return (
    <section id="top" className="border-b" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6 pt-28 pb-20 text-center sm:pt-36">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ borderColor: HAIR, color: COBALT }}>
            <span className="inline-block size-[6px] rounded-full" style={{ background: COBALT }} />
            per-second metered · ~10× cheaper than sandboxes
          </span>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="mx-auto mt-7 max-w-[860px] font-heading text-[60px] font-semibold leading-[0.96] tracking-[-0.04em] sm:text-[88px] lg:text-[104px]">
            Just a VPS.
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-[600px] text-[19px] leading-[1.5] sm:text-[21px]" style={{ color: "#2a3446" }}>
            A dedicated Linux machine for AI agents that run 24/7 — same metered model
            as Daytona / E2B / Modal, at <Highlight>~10× the price per CPU-hour</Highlight>.
          </p>
        </Reveal>
        <Reveal delay={240}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onDeploy} className="inline-flex h-12 items-center gap-2 rounded-[8px] px-6 text-[14.5px] font-medium text-white" style={{ background: COBALT, boxShadow: `0 8px 24px -8px ${COBALT}88` }}>
              Deploy a box →
            </button>
            <a href="#calc" className="inline-flex h-12 items-center gap-2 rounded-[8px] border bg-white px-5 text-[14px]" style={{ borderColor: HAIR }}>
              See the math
            </a>
          </div>
          <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
            from ${start}/mo at 24/7 · billed by the second · cancel anytime
          </p>
        </Reveal>

        <Reveal delay={320}>
          <div className="mt-14 flex flex-col items-center gap-5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.26em]" style={{ color: MUT }}>
              home to your favourite agent harness
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
              {logos.map((l) => (
                <div key={l.alt} className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5" style={{ borderColor: HAIR }}>
                  <Image src={l.src} alt={l.alt} width={16} height={16} className="size-4 object-contain" />
                  <span className="font-mono text-[11px]" style={{ color: MUT }}>{l.alt}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ TAX · annotated invoice ══════════════════════════════ */
function Tax() {
  const sandboxMonthly = vendorMonthly("daytona", 4, 8, 24);
  const usMonthly = justavpsMonthly(4, 8, 160);
  const yearLoss = (sandboxMonthly - usMonthly) * 12;
  return (
    <section className="border-b py-24 lg:py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="text-center">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: COBALT }}>
              fig.01 · the sandbox tax
            </div>
            <h2 className="mx-auto mt-4 max-w-[760px] font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[52px]">
              Imagine your agent on Daytona.
              <br />
              <span style={{ color: MUT }}>30 days later, the invoice arrives.</span>
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <Reveal delay={120}>
            <div className="relative overflow-hidden rounded-2xl border-2 bg-white shadow-2xl shadow-[#0B1220]/15" style={{ borderColor: INK }}>
              <div className="flex items-center justify-between border-b border-[#0B1220]/10 px-6 py-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0B1220]/55">invoice</div>
                  <div className="mt-0.5 font-heading text-[15px] font-semibold">DAYTONA — APRIL 2026</div>
                </div>
                <div className="text-right font-mono text-[10px] uppercase tracking-[0.22em] text-[#0B1220]/55">acct · agent-prod · paid</div>
              </div>
              <div className="px-6 py-5">
                <div className="space-y-2.5">
                  {[
                    ["CPU usage · 4 vCPU × 730 h",     `$${(VENDOR_RATES.daytona.vPerVcpu * 4 * 730).toFixed(2)}`],
                    ["RAM usage · 8 GB × 730 h",       `$${(VENDOR_RATES.daytona.vPerGb * 8 * 730).toFixed(2)}`],
                    ["Storage · 160 GB · bundled",     "$0.00"],
                    ["Sandbox tier · always-on",       "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between border-b border-dashed border-[#0B1220]/15 pb-2 text-[13.5px]">
                      <span className="text-[#0B1220]/75">{k}</span>
                      <span className="font-mono tabular-nums text-[#0B1220]/85">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-baseline justify-between">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#0B1220]/60">total</span>
                  <span className="relative font-heading text-[44px] font-semibold tabular-nums">
                    ${sandboxMonthly}.42
                    <svg aria-hidden className="absolute -inset-3 -bottom-2" viewBox="0 0 200 80" style={{ pointerEvents: "none" }}>
                      <ellipse cx="100" cy="40" rx="92" ry="34" fill="none" stroke={COBALT} strokeWidth="2.4" strokeLinecap="round" transform="rotate(-3 100 40)" />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="border-t border-[#0B1220]/10 px-6 py-3 text-[12px] text-[#0B1220]/65">
                ← for one machine. one agent. one month.
              </div>
            </div>
          </Reveal>

          <Reveal delay={200}>
            <div className="flex h-full flex-col justify-between gap-6 rounded-2xl border p-7 shadow-sm sm:p-8" style={{ borderColor: HAIR, background: PAPER }}>
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                  same shape · same hours · just a vps
                </div>
                <div className="mt-3 font-heading text-[64px] font-semibold leading-none tracking-[-0.03em] sm:text-[80px]" style={{ color: COBALT }}>
                  ${usMonthly}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                  4 vCPU · 8 GB · 160 GB · 24/7
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-5" style={{ borderColor: HAIR }}>
                <Stat k="you save" v={`$${sandboxMonthly - usMonthly}/mo`} accent />
                <Stat k="per year" v={`$${(sandboxMonthly - usMonthly) * 12}`} accent />
                <Stat k="10 agents" v={`$${(yearLoss * 10).toLocaleString()}`} sub="/yr" />
                <Stat k="100 agents" v={`$${(yearLoss * 100).toLocaleString()}`} sub="/yr" />
              </div>
              <p className="text-[14px] leading-[1.6]" style={{ color: "#2a3446" }}>
                Same metered model as the sandboxes — pay for the CPU-seconds,
                GB-hours of RAM, GB of disk your agent uses. We just charge
                <Highlight> a fraction </Highlight>per unit.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v, sub, accent }: { k: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: MUT }}>{k}</div>
      <div className="mt-1 flex items-baseline gap-1.5 font-heading text-[20px] font-semibold tabular-nums" style={accent ? { color: COBALT } : {}}>
        {v}
        {sub && <span className="font-mono text-[10px]" style={{ color: MUT }}>{sub}</span>}
      </div>
    </div>
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
        k, name: VENDOR_RATES[k].name,
        hr: vendorHourly(k, vcpu, ram),
        mo: vendorMonthly(k, vcpu, ram, 24),
      })),
    [vcpu, ram],
  );
  const avgMo = competitors.reduce((a, c) => a + c.mo, 0) / competitors.length;
  const multiple = Math.max(1, Math.round(avgMo / Math.max(1, usMo)));
  const maxMo = Math.max(...competitors.map((c) => c.mo), usMo);

  return (
    <section id="calc" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="text-center">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: COBALT }}>
              fig.02 · run the math yourself
            </div>
            <h2 className="mt-4 font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
              Shape the box. Compare side by side.
            </h2>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12 grid gap-4 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              <div className="rounded-xl border bg-white p-6 shadow-sm" style={{ borderColor: HAIR }}>
                <div className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                  <span>your workload</span>
                  <span style={{ color: COBALT }}>{fit.label.toLowerCase()}</span>
                </div>
                <div className="mt-5 space-y-6">
                  <BpSlider label="vCPU"    min={1}  max={16}   value={vcpu}    onChange={setVcpu}    unit="cores" />
                  <BpSlider label="memory"  min={1}  max={32}   value={ram}     onChange={setRam}     unit="GB" />
                  <BpSlider label="storage" min={20} max={1000} value={storage} onChange={setStorage} unit="GB" step={10} />
                </div>
              </div>
              <div className="rounded-xl p-6 shadow-lg" style={{ background: COBALT, color: "#fff", boxShadow: `0 20px 40px -20px ${COBALT}aa` }}>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] opacity-80">
                  just a vps · billed by the second
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-y py-3" style={{ borderColor: "rgba(255,255,255,0.25)" }}>
                  {[
                    ["sec", `$${(usHr / 3600).toFixed(7)}`],
                    ["hour", fmtHourly(usHr)],
                    ["24/7 mo", `$${usMo}`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-75">{k}</dt>
                      <dd className="mt-0.5 font-heading text-[17px] font-semibold leading-none tabular-nums sm:text-[18px]">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[12px] leading-[1.55] opacity-90">
                  You only pay for the seconds your agent uses CPU, the GB-hours of
                  RAM it touches, and the GB of disk it stores.
                </p>
                <button onClick={onDeploy} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-[8px] px-3 font-mono text-[12.5px] font-medium" style={{ background: "#fff", color: COBALT }}>
                  Deploy this box →
                </button>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="overflow-hidden rounded-xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
                <div className="grid grid-cols-[1.1fr_90px_110px_60px] items-center gap-3 border-b px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ borderColor: HAIR, color: MUT, background: "#FAFBFE" }}>
                  <span>vendor — at 24/7</span>
                  <span className="text-right">$/hour</span>
                  <span className="text-right">$/month</span>
                  <span className="text-right">vs us</span>
                </div>
                {competitors.map((c) => (
                  <BpRow key={c.k} name={c.name} hr={c.hr} mo={c.mo} max={maxMo} usMo={Math.max(1, usMo)} />
                ))}
                <div style={{ borderTop: `2px solid ${COBALT}` }}>
                  <BpRow name="just a vps" hr={usHr} mo={usMo} max={maxMo} usMo={Math.max(1, usMo)} us />
                </div>
                <div className="px-5 py-3 text-center font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: MUT, background: "rgba(46,90,255,0.04)" }}>
                  ≈ <b style={{ color: COBALT }}>{multiple}× cheaper</b> than the average sandbox at this shape
                </div>
              </div>
              <p className="mt-3 text-center text-[11px]" style={{ color: MUT }}>
                Our rates · ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}/vCPU·h · ${JUSTAVPS_RATES.vPerGb.toFixed(4)}/GB-RAM·h · ${(JUSTAVPS_RATES.vPerStorage * 730).toFixed(3)}/GB-storage·month
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function BpSlider({ label, min, max, step = 1, value, onChange, unit }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; unit: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: MUT }}>{label}</span>
        <span className="font-heading text-[20px] font-semibold tabular-nums">
          {value}<span className="ml-1 font-mono text-[11px]" style={{ color: MUT }}>{unit}</span>
        </span>
      </div>
      <div className="relative mt-3 h-7">
        <div className="absolute inset-y-[13px] left-0 right-0 rounded-full" style={{ background: "#EAEEF5" }} />
        <div className="absolute inset-y-[13px] left-0 rounded-full" style={{ width: `${pct}%`, background: COBALT }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-[color:var(--c)]
            [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0
            [&::-moz-range-thumb]:ring-2 [&::-moz-range-thumb]:ring-[color:var(--c)]"
          style={{ ["--c" as string]: COBALT } as React.CSSProperties} />
      </div>
    </div>
  );
}

function BpRow({ name, hr, mo, max, usMo, us }: { name: string; hr: number; mo: number; max: number; usMo: number; us?: boolean }) {
  const pct = Math.max(6, (mo / max) * 100);
  const mult = us ? "1×" : `${Math.max(1, Math.round(mo / usMo))}×`;
  return (
    <div className="grid grid-cols-[1.1fr_90px_110px_60px] items-center gap-3 border-b px-5 py-3 last:border-b-0" style={{ borderColor: HAIR, background: us ? "rgba(46,90,255,0.05)" : "transparent" }}>
      <div className="flex items-baseline gap-2">
        <span className="font-heading text-[15px] font-semibold" style={{ color: us ? COBALT : INK }}>{name}</span>
        {us && <span className="font-mono text-[9.5px] uppercase tracking-[0.2em]" style={{ color: COBALT }}>per second</span>}
      </div>
      <div className="text-right font-mono tabular-nums text-[13px]" style={{ color: us ? COBALT : INK }}>{fmtHourly(hr)}</div>
      <div className="text-right font-heading text-[16px] font-semibold tabular-nums" style={{ color: us ? COBALT : INK }}>${mo.toLocaleString()}</div>
      <div className="flex items-center justify-end gap-2">
        <div className="hidden h-1 w-12 overflow-hidden rounded-full sm:block" style={{ background: "#EAEEF5" }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: us ? COBALT : "#B8C2D4" }} />
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: us ? COBALT : MUT }}>{mult}</span>
      </div>
    </div>
  );
}

/* ══════ USE CASES ═════════════════════════════════════════════ */
function UseCases({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section className="border-b py-24" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="text-center">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: COBALT }}>
              fig.03 · two ways to use it
            </div>
            <h2 className="mt-4 font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
              Personal box, or sandboxes-as-a-service.
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <Reveal delay={120}>
            <UseCard
              tag="personal"
              title="Your dev machine in the cloud"
              body="SSH in or connect your IDE — it's just a Linux box. Close your laptop, your agents keep going. Come back tomorrow, everything's still there."
              terminal={[
                { kind: "comment", t: "# Connect from Cursor, VS Code, or your terminal" },
                { kind: "cmd", t: "ssh root@95.217.x.x" },
                { kind: "cmd", t: "opencode" },
                { kind: "out", t: "Open the machine URL in your browser" },
              ]}
            />
          </Reveal>
          <Reveal delay={200}>
            <UseCard
              tag="service"
              title="Sandboxes as infrastructure"
              body="Spin up machines, manage files, run bash, launch coding agents — all from one API. Give every user (and their agents) a sandbox of their own."
              capabilities
            />
          </Reveal>
        </div>

        <div className="mt-10 text-center">
          <button onClick={onDeploy} className="inline-flex h-11 items-center gap-2 rounded-[8px] px-5 text-[14px] font-medium text-white" style={{ background: COBALT }}>
            Get your machine →
          </button>
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
            ssh ready in ~10 seconds
          </p>
        </div>
      </div>
    </section>
  );
}

function UseCard({ tag, title, body, terminal, capabilities }: {
  tag: string; title: string; body: string;
  terminal?: { kind: "cmd" | "comment" | "out"; t: string }[];
  capabilities?: boolean;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
      <div className="flex-1 p-6 sm:p-7">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-[18px] font-semibold">{title}</h3>
          <span className="rounded-full px-2.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em]" style={{ background: "rgba(46,90,255,0.12)", color: COBALT }}>
            {tag}
          </span>
        </div>
        <p className="mt-3 text-[14px] leading-[1.65]" style={{ color: "#2a3446" }}>{body}</p>
      </div>
      <div className="border-t px-5 py-4 font-mono text-[12px] leading-[1.7]" style={{ borderColor: HAIR, background: INK, color: "rgba(255,255,255,0.85)" }}>
        {terminal && terminal.map((l, i) => (
          <div key={i} className={l.kind === "comment" ? "text-white/40" : ""}>
            {l.kind === "cmd" && <span style={{ color: COBALT }}>$</span>} {l.kind === "out" && <span style={{ color: COBALT }}>›</span>} <span>{l.t}</span>
          </div>
        ))}
        {capabilities && (
          <div className="grid grid-cols-2 gap-2">
            {[
              { l: "Machines", d: "create, list, resize, delete" },
              { l: "Filesystem", d: "read, write, search, upload" },
              { l: "Process", d: "exec, stream, kill" },
              { l: "Agents", d: "OpenCode, Codex, Claude…" },
            ].map((c) => (
              <div key={c.l} className="rounded-md bg-white/5 px-3 py-2">
                <div className="text-[12px] text-white/85">{c.l}</div>
                <div className="text-[10px] text-white/45">{c.d}</div>
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
    <section className="border-b py-16" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
            <div className="flex flex-col gap-5 px-6 py-6 sm:flex-row sm:items-center sm:gap-6 sm:px-8">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(46,90,255,0.1)" }}>
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke={COBALT} strokeWidth="1.6"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              </div>
              <div className="flex-1">
                <h3 className="font-heading text-[18px] font-semibold">Secure by default. Zero config.</h3>
                <p className="mt-1 text-[14px] leading-[1.6]" style={{ color: "#2a3446" }}>
                  Browser traffic flows through an authenticated proxy. SSH uses keys, not passwords.
                  Bind a port — get a password-locked HTTPS URL.
                </p>
              </div>
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                {["Auth Proxy", "SSH Keys", "API Keys", "Sessions"].map((c) => (
                  <span key={c} className="rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.2em]" style={{ borderColor: HAIR, color: COBALT }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div className="border-t px-6 py-3.5 font-mono text-[12px] leading-[1.7] sm:px-8" style={{ borderColor: HAIR, background: "#0B1220", color: "rgba(255,255,255,0.85)" }}>
              <span style={{ color: COBALT }}>$</span> <span>curl https://8000-box-7f3.justavps.cloud</span> -H <span style={{ color: "#93C5FD" }}>&quot;Authorization: Bearer sk_live_…&quot;</span>
            </div>
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
    <section id="pricing" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="text-center">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: COBALT }}>
              fig.04 · pricing
            </div>
            <h2 className="mt-4 font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
              You&apos;re paying <Highlight>10× too much</Highlight> for always-on agents.
            </h2>
            <p className="mx-auto mt-4 max-w-[600px] text-[15px] leading-[1.65]" style={{ color: "#2a3446" }}>
              Per-second billing sounds cheap — until your agent runs 24/7.
              Here&apos;s what a month of continuous usage actually costs.
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12 overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
            <div className="grid grid-cols-[1.4fr_0.7fr_0.7fr_0.6fr_60px] items-center gap-3 border-b px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] sm:grid-cols-[1.4fr_0.9fr_0.9fr_0.6fr_80px]" style={{ borderColor: HAIR, color: MUT, background: "#FAFBFE" }}>
              <span>shape</span>
              <span className="text-right">daytona / e2b *</span>
              <span className="text-right">just a vps</span>
              <span className="text-right">save</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.id} className="grid grid-cols-[1.4fr_0.7fr_0.7fr_0.6fr_60px] items-center gap-3 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[1.4fr_0.9fr_0.9fr_0.6fr_80px]" style={{ borderColor: HAIR, background: i === 2 ? "rgba(46,90,255,0.04)" : "transparent" }}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-[15px] font-semibold">{r.label}</span>
                    {i === 2 && <span className="rounded-full px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-white" style={{ background: COBALT }}>recommended</span>}
                  </div>
                  <div className="font-mono text-[11px]" style={{ color: MUT }}>{r.vcpu} vCPU · {r.memory} GB · {r.disk} GB</div>
                </div>
                <div className="text-right font-mono text-[14px] tabular-nums" style={{ color: MUT, textDecoration: "line-through" }}>${r.dayMo}/mo</div>
                <div className="text-right font-heading text-[18px] font-semibold tabular-nums" style={{ color: COBALT }}>${r.ourMo}/mo</div>
                <div className="text-right font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: COBALT }}>{r.saves}×</div>
                <div className="hidden text-right sm:block">
                  <button onClick={onDeploy} className="rounded-full border px-3 py-1 font-mono text-[11px]" style={{ borderColor: HAIR }}>boot →</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px]" style={{ color: MUT }}>
            * Based on Daytona / E2B published per-second CPU + RAM rates × 730 h continuous. EU shape shown.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ WHEN TO USE ═══════════════════════════════════════════ */
function WhenToUse() {
  return (
    <section className="border-b py-20" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <h2 className="text-center font-heading text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[36px]">
            We&apos;re not for every workload. <span style={{ color: MUT }}>Here&apos;s when to use what.</span>
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Reveal delay={120}>
            <div className="relative rounded-2xl border-2 bg-white p-6 shadow-sm" style={{ borderColor: COBALT }}>
              <span className="absolute -top-3 left-5 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white" style={{ background: COBALT }}>recommended</span>
              <h3 className="mt-1 flex items-center gap-2 font-heading text-[16px] font-semibold">
                <span className="inline-flex size-5 items-center justify-center rounded-full text-[11px] text-white" style={{ background: COBALT }}>✓</span>
                Use just a vps when
              </h3>
              <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55]">
                <li>Your agents run <b>24/7</b>, not minutes.</li>
                <li>You need <b>persistent state</b> — files, Docker, DBs.</li>
                <li>You want <b>predictable cost</b>, no bill shock.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={200}>
            <div className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: HAIR }}>
              <h3 className="flex items-center gap-2 font-heading text-[16px] font-semibold">
                <span className="inline-flex size-5 items-center justify-center rounded-full text-[11px]" style={{ background: HAIR, color: MUT }}>→</span>
                Stick with sandboxes when
              </h3>
              <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55]" style={{ color: "#2a3446" }}>
                <li>Sandboxes only live <b>minutes</b>, not months.</li>
                <li>You need <b>sub-second spin-up</b> per request.</li>
                <li>You only pay when code is <b>actively running</b>.</li>
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
    <section className="border-b py-20" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
            <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
              <div className="relative aspect-[4/3] md:aspect-auto">
                <Image src="/team.png" alt="Kortix team" fill className="object-cover" />
              </div>
              <div className="flex flex-col justify-center gap-4 p-7 sm:p-9">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: COBALT }}>
                  fig.05 · why we built this
                </div>
                <h3 className="font-heading text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[30px]">
                  We hit the sandbox tax ourselves.
                </h3>
                <p className="text-[14.5px] leading-[1.65]" style={{ color: "#2a3446" }}>
                  We ran <Highlight>3+ million sandboxes</Highlight> on incumbent providers building{" "}
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-70" style={{ color: INK }}>Kortix</a> — the Autonomous Company OS.
                  We hit the cost ceiling. So we rebuilt the infrastructure we needed for ourselves.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px]" style={{ borderColor: HAIR, color: MUT }}>kortix.com ↗</a>
                  <a href="https://github.com/kortix-ai/suna" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px]" style={{ borderColor: HAIR, color: MUT }}>github.com/kortix-ai/suna ↗</a>
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
    { q: "What if I don't like it?", a: "Cancel anytime. No contracts, no lock-in. Your data is yours — download it and leave whenever you want." },
    { q: "Is it really cheaper?", a: "Do the math yourself in the calculator above. Daytona, E2B, Modal and others charge per-second — $0.05+/h per vCPU, $0.016+/h per GiB RAM. Run that 24/7 for a month and compare. We're 8–10× cheaper, every time." },
    { q: "How fast can I get started?", a: "A couple of minutes. Pick a shape, we provision your machine, you SSH in. That's it." },
    { q: "What about security?", a: "Browser access is gated by an authenticated proxy, and SSH uses keys instead of passwords. API keys and session-based auth are both supported." },
    { q: "Which agents can I run?", a: "Claude Code, Codex, OpenCode, PI Coding agents, Cursor workflows, and any other Linux-based agent. It's a persistent Linux machine — install what you want, run it 24/7." },
  ];
  return (
    <section id="faq" className="border-b py-24" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[760px] px-6">
        <Reveal>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: COBALT }}>still on the fence?</div>
          <h2 className="mt-4 font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
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
    <div className="rounded-xl border bg-white" style={{ borderColor: HAIR }}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <span className="font-heading text-[16px] font-medium">{q}</span>
        <span className="font-mono text-[18px] leading-none" style={{ color: COBALT }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-[14px] leading-[1.65]" style={{ color: "#2a3446" }}>{a}</div>
      )}
    </div>
  );
}

/* ══════ CLOSER ═════════════════════════════════════════════════ */
function Closer({ onDeploy, start }: { onDeploy: () => void; start: number }) {
  return (
    <section className="border-b py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6 text-center">
        <Reveal>
          <h2 className="font-heading font-semibold tracking-[-0.04em] leading-[0.92] text-[52px] sm:text-[88px] lg:text-[104px]">
            Get a machine.
          </h2>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-[420px] text-[16px]" style={{ color: "#2a3446" }}>
            From ${start}/mo at 24/7 · billed by the second · cancel anytime.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <button onClick={onDeploy} className="mt-10 inline-flex h-14 items-center gap-2 rounded-[8px] px-7 text-[15px] font-medium text-white" style={{ background: COBALT, boxShadow: `0 12px 30px -10px ${COBALT}aa` }}>
            Deploy now →
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
      <div className="mx-auto flex max-w-[1080px] flex-col items-center gap-3 px-6 sm:flex-row sm:justify-between">
        <div className="inline-flex items-center gap-2.5"><Mark /><span className="font-mono text-[12.5px]">just a vps</span><span className="font-mono text-[11px]" style={{ color: MUT }}>· by <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>Kortix</a></span></div>
        <div className="flex flex-wrap gap-5 font-mono text-[12px]" style={{ color: MUT }}>
          <a href="#calc" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>pricing</a>
          <a href="#faq" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>faq</a>
          <a href="/docs" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>docs</a>
          <a href="/login" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>sign in</a>
          <a href="mailto:hey@justavps.com" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>contact</a>
        </div>
        <span className="font-mono text-[11px]" style={{ color: MUT }}>© {new Date().getFullYear()}</span>
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
      className={`fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-white py-1.5 pl-5 pr-1.5 shadow-xl transition-all duration-300 ${show ? "opacity-100" : "pointer-events-none translate-y-20 opacity-0"}`}
      style={{ borderColor: HAIR }}
    >
      <span className="hidden text-[12.5px] sm:inline" style={{ color: MUT }}>
        From <b style={{ color: INK }}>${start}/mo</b>
      </span>
      <button onClick={onDeploy} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-mono text-[12.5px] font-medium text-white" style={{ background: COBALT }}>
        DEPLOY →
      </button>
    </div>
  );
}
