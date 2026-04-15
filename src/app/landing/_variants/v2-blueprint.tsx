"use client";

/* ═══════════════════════════════════════════════════════════════════
 *  V2 · "Blueprint"   —   ice · ink · cobalt
 *
 *  Same first-principles 9-chapter spine as V3 Live, dressed as an
 *  engineering report. Hero = annotated rate spec sheet. Live counter
 *  rendered as a "monthly burn" chart. Fig.NN labels throughout.
 * ═══════════════════════════════════════════════════════════════════ */

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  bestFitShape,
  fmtHourly,
  justavpsHourly,
  justavpsMonthly,
  vendorHourly,
  vendorMonthly,
  JUSTAVPS_RATES,
  VENDOR_RATES,
  type VendorKey,
} from "../_shared/plan-data";
import { CountUp, Reveal, useGuiltCounter } from "../_shared/interactive";

const BG = "#F2F4F8";
const PAPER = "#FFFFFF";
const INK = "#0B1220";
const MUT = "#5B657A";
const COBALT = "#2E5AFF";
const HAIR = "#D7DEEA";

export function V2Blueprint({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div className="relative min-h-screen" style={{ background: BG, color: INK }}>
      <GridPaper />
      <Nav onDeploy={onDeploy} />
      <Ch1Hero onDeploy={onDeploy} />
      <Ch2Burn />
      <Ch3SameDifferent />
      <Ch4Calculator onDeploy={onDeploy} />
      <Ch5HowItWorks />
      <Ch6WhenNot />
      <Ch7Kortix />
      <Ch8Faq />
      <Ch9Deploy onDeploy={onDeploy} />
      <Footer />
      <FloatingCta onDeploy={onDeploy} />
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

function FigHead({ n, eyebrow }: { n: string; eyebrow: string }) {
  return (
    <div className="flex items-center justify-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.3em]" style={{ color: COBALT }}>
      <span className="block h-px w-8" style={{ background: HAIR }} />
      <span>fig. {n}</span>
      <span className="block h-px w-2" style={{ background: HAIR }} />
      <span style={{ color: MUT }}>{eyebrow}</span>
      <span className="block h-px w-8" style={{ background: HAIR }} />
    </div>
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
          {[["the math", "#calc"], ["how", "#how"], ["faq", "#faq"], ["docs", "/docs"]].map(([l, h]) => (
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

/* ══════ CH 1 · ANNOTATED RATE SPEC ════════════════════════════ */
function Ch1Hero({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section id="top" className="relative">
      <div className="mx-auto max-w-[1080px] px-6 pt-32 pb-24 sm:pt-40">
        <Reveal>
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ borderColor: HAIR, color: COBALT }}>
              <span className="inline-block size-[6px] rounded-full" style={{ background: COBALT }} />
              just a vps · per-second metered
            </span>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12 grid items-stretch gap-0 sm:grid-cols-[0.9fr_1.1fr] lg:gap-8">
            {/* Left: title + intro */}
            <div className="flex flex-col justify-center pr-0 sm:pr-6">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: MUT }}>
                fig. 00 · pricing schematic
              </div>
              <h1 className="mt-4 font-heading font-semibold leading-[0.94] tracking-[-0.04em] text-[56px] sm:text-[72px]">
                Just a VPS.
              </h1>
              <p className="mt-5 max-w-[440px] text-[17px] leading-[1.55]" style={{ color: "#2a3446" }}>
                Same per-second metered model as Daytona, E2B, Modal —
                at roughly one-tenth the price per CPU-hour.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button onClick={onDeploy} className="inline-flex h-12 items-center gap-2 rounded-[8px] px-6 text-[14.5px] font-medium text-white" style={{ background: COBALT, boxShadow: `0 8px 24px -8px ${COBALT}88` }}>
                  Deploy a box →
                </button>
                <a href="#calc" className="inline-flex h-12 items-center gap-2 rounded-[8px] border bg-white px-5 text-[14px]" style={{ borderColor: HAIR }}>
                  See the math
                </a>
              </div>
            </div>

            {/* Right: annotated rate spec */}
            <RateSpec />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function RateSpec() {
  // render an annotated SVG: big rate value, with leader lines & callouts
  return (
    <div className="relative mt-10 overflow-hidden rounded-2xl border-2 bg-white shadow-xl shadow-[#0B1220]/15 sm:mt-0" style={{ borderColor: INK }}>
      {/* spec header */}
      <div className="flex items-center justify-between border-b border-[#0B1220]/10 px-5 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#0B1220]/55">
          spec · rate.conf · rev. a
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#0B1220]/55">
          eu · 04/2026
        </div>
      </div>

      {/* the rate */}
      <div className="relative px-6 py-10 sm:py-14">
        <div className="relative inline-block">
          <div className="font-heading font-semibold leading-[0.86] tracking-[-0.05em]"
               style={{ fontSize: "clamp(80px, 14vw, 156px)", color: INK }}>
            $0.005
          </div>

          {/* leader line + callout · top right */}
          <svg aria-hidden className="pointer-events-none absolute -right-28 top-1 hidden sm:block" width="180" height="60" viewBox="0 0 180 60">
            <line x1="0" y1="32" x2="80" y2="32" stroke={COBALT} strokeWidth="1.2" />
            <circle cx="0" cy="32" r="2.5" fill={COBALT} />
            <text x="86" y="22" fill={INK} fontSize="11" fontFamily="var(--font-mono, monospace)">our rate</text>
            <text x="86" y="38" fill={MUT} fontSize="10" fontFamily="var(--font-mono, monospace)">per vCPU · per hour</text>
          </svg>
        </div>
        <div className="mt-2 font-mono text-[12px] uppercase tracking-[0.28em]" style={{ color: MUT }}>
          / vCPU · / hour
        </div>

        {/* sub-rates as a small spec table */}
        <dl className="mt-8 grid grid-cols-3 gap-3 border-t pt-5" style={{ borderColor: HAIR }}>
          {[
            ["vCPU", `$${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}/h`],
            ["RAM", `$${JUSTAVPS_RATES.vPerGb.toFixed(4)}/h·GB`],
            ["disk", `$${(JUSTAVPS_RATES.vPerStorage * 730).toFixed(3)}/mo·GB`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: MUT }}>{k}</dt>
              <dd className="mt-1 font-heading text-[15px] font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* compare strip */}
      <div className="border-t bg-[#FAFBFE] px-6 py-3.5" style={{ borderColor: HAIR }}>
        <div className="flex items-baseline justify-between font-mono text-[11.5px]">
          <span style={{ color: MUT }}>daytona / e2b · vCPU·h</span>
          <span className="tabular-nums" style={{ color: INK, textDecoration: "line-through", textDecorationThickness: 1.5 }}>
            ${VENDOR_RATES.daytona.vPerVcpu.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ══════ CH 2 · MONTHLY BURN CHART ═════════════════════════════ */
function Ch2Burn() {
  const dayHr = vendorHourly("daytona", 4, 8);
  const vpsHr = justavpsHourly(4, 8, 160);
  const dayPerSec = dayHr / 3600;
  const vpsPerSec = vpsHr / 3600;
  const dayMo = vendorMonthly("daytona", 4, 8, 24);
  const vpsMo = justavpsMonthly(4, 8, 160);
  const yearlySaved = (dayMo - vpsMo) * 12;
  const { seconds, daytona, vps, saved } = useGuiltCounter(dayPerSec, vpsPerSec);

  // chart constants
  const w = 740, h = 220, padL = 60, padR = 80, padT = 20, padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  // simulate burn over 30 days for both
  const days = 30;
  const dayLine = `M ${padL} ${padT + innerH} L ${padL + innerW} ${padT + innerH - (dayMo / dayMo) * innerH}`;
  const vpsLine = `M ${padL} ${padT + innerH} L ${padL + innerW} ${padT + innerH - (vpsMo / dayMo) * innerH}`;
  // shaded gap
  const gap = `M ${padL} ${padT + innerH} L ${padL + innerW} ${padT + innerH - (dayMo / dayMo) * innerH} L ${padL + innerW} ${padT + innerH - (vpsMo / dayMo) * innerH} Z`;

  return (
    <section className="border-y" style={{ borderColor: HAIR, background: PAPER }}>
      <div className="mx-auto max-w-[1080px] px-6 py-24 lg:py-32">
        <Reveal><FigHead n="01" eyebrow="the burn graph" /></Reveal>

        <Reveal delay={100}>
          <h2 className="mx-auto mt-8 max-w-[820px] text-center font-heading text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
            One agent. <span style={{ color: MUT }}>30 days. Two bills.</span>
          </h2>
        </Reveal>

        <Reveal delay={200}>
          <div className="mx-auto mt-12 max-w-[920px] overflow-hidden rounded-2xl border-2 bg-white shadow-sm" style={{ borderColor: INK }}>
            <div className="flex items-center justify-between border-b px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ borderColor: HAIR, color: MUT }}>
              <span>fig. 01a · monthly burn · 4 vCPU / 8 GB / 160 GB · always-on</span>
              <span>$ accrued</span>
            </div>

            <div className="p-5">
              <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
                {/* y grid */}
                <g stroke={HAIR} strokeWidth="0.8">
                  {[0, 0.25, 0.5, 0.75, 1].map((y) => (
                    <line key={y} x1={padL} x2={w - padR} y1={padT + innerH - y * innerH} y2={padT + innerH - y * innerH} />
                  ))}
                </g>
                {/* axis labels */}
                <g fontFamily="var(--font-mono, monospace)" fontSize="10" fill={MUT}>
                  {[0, 0.5, 1].map((y) => (
                    <text key={y} x={padL - 8} y={padT + innerH - y * innerH + 3} textAnchor="end">${Math.round(dayMo * y)}</text>
                  ))}
                  {[0, days * 0.5, days].map((d) => (
                    <text key={d} x={padL + (d / days) * innerW} y={h - padB + 14} textAnchor="middle">d{Math.round(d)}</text>
                  ))}
                </g>
                {/* shaded gap */}
                <path d={gap} fill={COBALT} fillOpacity="0.08" />
                {/* daytona line */}
                <path d={dayLine} stroke={INK} strokeWidth="2.2" fill="none" strokeDasharray="6 5" />
                {/* vps line */}
                <path d={vpsLine} stroke={COBALT} strokeWidth="2.4" fill="none" />
                {/* end labels */}
                <g fontFamily="var(--font-mono, monospace)" fontSize="11">
                  <circle cx={padL + innerW} cy={padT + innerH - (dayMo / dayMo) * innerH} r="4" fill={INK} />
                  <text x={padL + innerW + 8} y={padT + innerH - (dayMo / dayMo) * innerH + 4} fill={INK}>daytona ${dayMo}</text>
                  <circle cx={padL + innerW} cy={padT + innerH - (vpsMo / dayMo) * innerH} r="4" fill={COBALT} />
                  <text x={padL + innerW + 8} y={padT + innerH - (vpsMo / dayMo) * innerH + 4} fill={COBALT}>vps ${vpsMo}</text>
                </g>
              </svg>

              {/* legend */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ borderColor: HAIR, color: MUT }}>
                <span><span className="mr-2 inline-block h-[2px] w-5 align-middle" style={{ background: INK, borderTop: `2px dashed ${INK}` }} />daytona</span>
                <span><span className="mr-2 inline-block h-[2px] w-5 align-middle" style={{ background: COBALT }} />just a vps</span>
                <span style={{ color: COBALT }}>shaded · the gap you keep</span>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Live mini-counter */}
        <Reveal delay={300}>
          <div className="mx-auto mt-6 grid max-w-[920px] gap-px overflow-hidden rounded-2xl border bg-[#FAFBFE] sm:grid-cols-3" style={{ borderColor: HAIR }}>
            <div className="bg-white p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                fig. 01b · ticking · daytona since you arrived
              </div>
              <div className="mt-2 font-heading text-[22px] font-semibold tabular-nums">${daytona.toFixed(6)}</div>
            </div>
            <div className="bg-white p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: COBALT }}>
                ticking · just a vps
              </div>
              <div className="mt-2 font-heading text-[22px] font-semibold tabular-nums" style={{ color: COBALT }}>${vps.toFixed(6)}</div>
            </div>
            <div className="bg-white p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                you would have saved · in {seconds.toFixed(1)} s
              </div>
              <div className="mt-2 font-heading text-[22px] font-semibold tabular-nums">${saved.toFixed(6)}</div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={400}>
          <div className="mx-auto mt-8 max-w-[820px] rounded-2xl border-2 p-6 text-center sm:p-8" style={{ borderColor: COBALT, background: "rgba(46,90,255,0.04)" }}>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
              extrapolated · 1 year of always-on, per agent
            </div>
            <div className="mt-3 font-heading text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[68px]" style={{ color: COBALT }}>
              <CountUp target={yearlySaved} prefix="$" /> <span style={{ color: MUT, fontSize: "0.5em" }}>/ yr</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ CH 3 · SAME LINUX. DIFFERENT BILL. ════════════════════ */
function Ch3SameDifferent() {
  const dayMo = vendorMonthly("daytona", 4, 8, 24);
  const vpsMo = justavpsMonthly(4, 8, 160);
  return (
    <section className="border-b py-24 lg:py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal><FigHead n="02" eyebrow="anatomy of the box" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[52px]">
            Same Linux. <span style={{ color: MUT }}>Different bill.</span>
          </h2>
        </Reveal>

        <div className="relative mt-14 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <Reveal delay={140}><SpecCard label="Daytona" sub="sandbox · per-sec" mo={dayMo} muted /></Reveal>
          <Reveal delay={200}>
            <div className="hidden items-center justify-center lg:flex">
              <div className="font-heading text-[64px] font-semibold leading-none" style={{ color: MUT }}>=</div>
            </div>
          </Reveal>
          <Reveal delay={260}><SpecCard label="just a vps" sub="dedicated · per-sec" mo={vpsMo} accent /></Reveal>
        </div>

        <Reveal delay={360}>
          <p className="mx-auto mt-10 max-w-[640px] text-center text-[15px] leading-[1.65]" style={{ color: "#2a3446" }}>
            A vCPU is a vCPU. A gigabyte of RAM is a gigabyte of RAM. The kernel is the same kernel.
            We just don&apos;t charge sandbox markup.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function SpecCard({ label, sub, mo, accent, muted }: { label: string; sub: string; mo: number; accent?: boolean; muted?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border-2 bg-white shadow-sm" style={{ borderColor: accent ? COBALT : HAIR }}>
      <div className="flex items-baseline justify-between px-6 pt-5">
        <div className="font-heading text-[18px] font-semibold" style={{ color: accent ? COBALT : INK }}>{label}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: MUT }}>{sub}</div>
      </div>
      <dl className="px-6 pt-5">
        {[
          ["kernel", "Linux 6.1"],
          ["arch", "x86_64"],
          ["vCPU", "4 cores"],
          ["memory", "8 GB"],
          ["disk", "160 GB SSD"],
          ["uptime", "24 / 7"],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-2 items-baseline border-b py-2 text-[13.5px] last:border-b-0" style={{ borderColor: HAIR }}>
            <dt className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>{k}</dt>
            <dd className="font-mono tabular-nums" style={{ color: muted ? MUT : INK }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t px-6 py-5" style={{ borderColor: HAIR, background: accent ? "rgba(46,90,255,0.06)" : "transparent" }}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>monthly · 24/7</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-heading text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[56px]" style={{ color: accent ? COBALT : INK, textDecoration: muted ? "line-through" : "none", textDecorationThickness: muted ? "2px" : undefined }}>
            ${mo}
          </span>
          <span className="font-mono text-[12px]" style={{ color: MUT }}>/ mo</span>
        </div>
      </div>
    </div>
  );
}

/* ══════ CH 4 · CALCULATOR ═════════════════════════════════════ */
function Ch4Calculator({ onDeploy }: { onDeploy: () => void }) {
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
    <section id="calc" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR, background: PAPER }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal><FigHead n="03" eyebrow="run the numbers yourself" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
            Your shape. <span style={{ color: MUT }}>Your savings.</span>
          </h2>
        </Reveal>

        <Reveal delay={200}>
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
                  RAM it touches, the GB of disk it stores.
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
                  ≈ <b style={{ color: COBALT }}>{multiple}× cheaper</b> than the average sandbox
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

/* ══════ CH 5 · HOW IT WORKS ═══════════════════════════════════ */
function Ch5HowItWorks() {
  const cards = [
    { n: "01", t: "We don't run microVMs.", b: "We provision boring, dedicated VMs from Hetzner / OVH / Contabo. Real Linux. Real disk. Same kernel as the sandboxes." },
    { n: "02", t: "We add what they don't have.", b: "Authenticated port proxy on every port. SSH key fleet. Snapshots. 1-click agent templates. The wrapper sandbox vendors built — minus the markup." },
    { n: "03", t: "We bill per-second.", b: "CPU-seconds, GB-hours of RAM, GB-hours of disk. Same model the sandboxes use. We just don't markup compute 10×." },
  ];
  return (
    <section id="how" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal><FigHead n="04" eyebrow="how is this even possible" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
            No magic. <span style={{ color: MUT }}>Just the right stack.</span>
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {cards.map((c) => (
              <div key={c.n} className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: HAIR }}>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: COBALT }}>step {c.n}</div>
                <h3 className="mt-3 font-heading text-[19px] font-semibold leading-[1.25]">{c.t}</h3>
                <p className="mt-3 text-[14px] leading-[1.65]" style={{ color: "#2a3446" }}>{c.b}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ CH 6 · WHEN NOT TO USE US ═════════════════════════════ */
function Ch6WhenNot() {
  return (
    <section className="border-b py-24" style={{ borderColor: HAIR, background: PAPER }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal><FigHead n="05" eyebrow="we are not for everyone" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[44px]">
            When you should <span style={{ color: COBALT }}>stick with sandboxes</span>.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal delay={140}>
            <div className="relative rounded-2xl border-2 bg-white p-6 shadow-sm" style={{ borderColor: COBALT }}>
              <span className="absolute -top-3 left-5 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white" style={{ background: COBALT }}>use us</span>
              <h3 className="mt-1 flex items-center gap-2 font-heading text-[16px] font-semibold">
                <span className="inline-flex size-5 items-center justify-center rounded-full text-[11px] text-white" style={{ background: COBALT }}>✓</span>
                Long-running process
              </h3>
              <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55]">
                <li>Runs <b>24/7</b>, not minutes.</li>
                <li>Has <b>persistent state</b> on disk.</li>
                <li>Reboots maybe once a month.</li>
                <li>You want a <b>predictable bill</b>.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={220}>
            <div className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: HAIR }}>
              <span className="rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ borderColor: HAIR, color: MUT }}>stick with sandboxes</span>
              <h3 className="mt-3 flex items-center gap-2 font-heading text-[16px] font-semibold">
                <span className="inline-flex size-5 items-center justify-center rounded-full text-[11px]" style={{ background: HAIR, color: MUT }}>→</span>
                Bursty workload
              </h3>
              <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55]" style={{ color: "#2a3446" }}>
                <li>Sandboxes live <b>seconds</b>, not days.</li>
                <li>You spawn <b>thousands</b> per day.</li>
                <li>You need <b>sub-second cold start</b>.</li>
                <li>Fresh env per request is the point.</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ══════ CH 7 · KORTIX ═════════════════════════════════════════ */
function Ch7Kortix() {
  return (
    <section className="border-b py-24" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
            <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
              <div className="relative aspect-[4/3] md:aspect-auto">
                <Image src="/team.png" alt="Kortix team" fill className="object-cover" />
              </div>
              <div className="flex flex-col justify-center gap-4 p-7 sm:p-9">
                <FigHead n="06" eyebrow="who built this" />
                <h3 className="font-heading text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[32px]">
                  We ran <span style={{ color: COBALT }}>3+ million sandboxes</span>. Then we hit the ceiling.
                </h3>
                <p className="text-[14.5px] leading-[1.65]" style={{ color: "#2a3446" }}>
                  We&apos;re the team behind{" "}
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-70" style={{ color: INK }}>Kortix</a> —
                  the Autonomous Company OS. We burned through a lot of incumbent-sandbox bills running real agents.
                  When the math stopped working, we built our own.
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

/* ══════ CH 8 · FAQ ════════════════════════════════════════════ */
function Ch8Faq() {
  const items = [
    { q: "What if I hate it?", a: "Cancel anytime. No contracts. Your data is yours — download it and leave whenever." },
    { q: "Is it really cheaper, or is there a catch?", a: "No catch. Run the calculator. Daytona / E2B / Modal charge ~$0.05/vCPU·h. We charge ~$0.005. Same model, different markup." },
    { q: "Why is it ~10× cheaper?", a: "We don't use microVMs. Dedicated VMs are an order of magnitude cheaper at the substrate, and we don't take the same margin sandbox vendors do on top." },
    { q: "What about cold-start?", a: "First boot is ~10 seconds. After that the machine is on — no per-request cold start. That's the point of a VPS." },
    { q: "Which agents can I run?", a: "Claude Code, Codex, OpenCode, PI Coding agents, Cursor workflows. Anything that runs on Linux." },
    { q: "How secure is it?", a: "SSH uses keys, not passwords. Every public port is gated by an authenticated proxy. API + session auth supported." },
  ];
  return (
    <section id="faq" className="border-b py-24" style={{ borderColor: HAIR, background: PAPER }}>
      <div className="mx-auto max-w-[760px] px-6">
        <Reveal><FigHead n="07" eyebrow="the honest answers" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
            Six objections. Answered.
          </h2>
        </Reveal>
        <Reveal delay={200}>
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

/* ══════ CH 9 · DEPLOY ═════════════════════════════════════════ */
function Ch9Deploy({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section className="border-b py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6 text-center">
        <Reveal>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: MUT }}>
            our rate · spec sheet
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-3 font-heading font-semibold leading-[0.86] tracking-[-0.04em]"
               style={{ fontSize: "clamp(80px, 16vw, 200px)", color: COBALT }}>
            ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div className="font-mono text-[12px] uppercase tracking-[0.28em]" style={{ color: MUT }}>per vCPU · per hour</div>
        </Reveal>
        <Reveal delay={300}>
          <button onClick={onDeploy} className="mt-12 inline-flex h-14 items-center gap-2 rounded-[8px] px-8 text-[15px] font-medium text-white" style={{ background: COBALT, boxShadow: `0 12px 30px -10px ${COBALT}aa` }}>
            Deploy a box →
          </button>
        </Reveal>
        <Reveal delay={380}>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
            ~10 s to ssh · billed per second · cancel anytime
          </p>
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
          <a href="#how" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>how</a>
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
function FloatingCta({ onDeploy }: { onDeploy: () => void }) {
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
        <b style={{ color: INK }}>${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}/vCPU·h</b>
      </span>
      <button onClick={onDeploy} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-mono text-[12.5px] font-medium text-white" style={{ background: COBALT }}>
        DEPLOY →
      </button>
    </div>
  );
}
