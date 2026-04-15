"use client";

/* ═══════════════════════════════════════════════════════════════════
 *  V3 · "Live"   —   ink · bone · ember
 *
 *  THESIS:
 *    Sandboxes were built for bursty workloads.
 *    Your AI agent isn't bursty.
 *    So you're paying 10× too much.
 *
 *  9 chapters, growth.design pacing, cinematic dark.
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
import {
  BigNumberReveal,
  CountUp,
  Reveal,
  useGuiltCounter,
} from "../_shared/interactive";

/* ── tokens ─────────────────────────────────────────────────────── */
const INK = "#0A0A0B";
const INK2 = "#101013";
const BONE = "#F0ECE0";
const DIM = "#8A8A90";
const MUT = "#5A5A60";
const EMBER = "#E04E1B";
const HAIR = "rgba(240,236,224,0.08)";

export function V3Live({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div className="min-h-screen" style={{ background: INK, color: BONE }}>
      <Nav onDeploy={onDeploy} />
      <Ch1Hero onDeploy={onDeploy} />
      <Ch2Counter />
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

/* ── primitives ─────────────────────────────────────────────────── */
function Mark() {
  return (
    <svg viewBox="0 0 28 28" width="22" height="22" aria-hidden>
      <rect x="0" y="0" width="28" height="28" rx="7" fill={EMBER} />
      <path d="M8 9 L13 14 L8 19" stroke={BONE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="15" y="18" width="6" height="2.2" rx="0.6" fill={BONE} />
    </svg>
  );
}
function ChapterHead({ n, eyebrow }: { n: string; eyebrow: string }) {
  return (
    <div className="flex items-center justify-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.3em]" style={{ color: EMBER }}>
      <span className="block h-px w-8" style={{ background: HAIR }} />
      <span>chapter {n}</span>
      <span className="block h-px w-2" style={{ background: HAIR }} />
      <span style={{ color: DIM }}>{eyebrow}</span>
      <span className="block h-px w-8" style={{ background: HAIR }} />
    </div>
  );
}

/* ══════ NAV ════════════════════════════════════════════════════ */
function Nav({ onDeploy }: { onDeploy: () => void }) {
  return (
    <header className="sticky top-10 z-40 border-b backdrop-blur-xl" style={{ borderColor: HAIR, background: "rgba(10,10,11,0.78)" }}>
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between px-6">
        <a href="#top" className="inline-flex items-center gap-2.5">
          <Mark />
          <span className="font-mono text-[13px]">just a vps</span>
        </a>
        <nav className="hidden gap-7 md:flex">
          {[["the math", "#calc"], ["how", "#how"], ["faq", "#faq"], ["docs", "/docs"]].map(([l, h]) => (
            <a key={l} href={h} className="font-mono text-[12.5px] transition-colors hover:text-[color:var(--b)]" style={{ color: DIM, ["--b" as string]: BONE }}>{l}</a>
          ))}
        </nav>
        <button onClick={onDeploy} className="inline-flex h-9 items-center rounded-full px-4 font-mono text-[12.5px] font-medium" style={{ background: EMBER, color: BONE }}>
          Deploy
        </button>
      </div>
    </header>
  );
}

/* ══════ CH 1 · THE NUMBER ═════════════════════════════════════ */
function Ch1Hero({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section id="top" className="relative overflow-hidden" style={{ borderColor: HAIR }}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[80%]"
           style={{ background: `radial-gradient(70% 60% at 50% 100%, ${EMBER}28 0%, ${EMBER}00 65%)` }} />
      <div className="relative mx-auto max-w-[1080px] px-6 pt-32 pb-24 sm:pt-40 sm:pb-32">
        <Reveal>
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ borderColor: HAIR, color: EMBER }}>
              <span className="inline-block size-[6px] animate-pulse rounded-full" style={{ background: EMBER }} />
              just a vps · per-second metered
            </span>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-10 text-center">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
              this is our rate
            </div>
            <div className="mt-3 font-heading font-semibold leading-[0.86] tracking-[-0.05em]"
                 style={{ fontSize: "clamp(96px, 22vw, 280px)", color: EMBER }}>
              <BigNumberReveal target={JUSTAVPS_RATES.vPerVcpu} prefix="$" decimals={3} />
            </div>
            <div className="mt-4 font-mono text-[12px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
              per vCPU · per hour
            </div>
          </div>
        </Reveal>

        <Reveal delay={300}>
          <div className="mx-auto mt-12 max-w-[680px] text-center">
            <p className="text-[20px] leading-[1.5] sm:text-[22px]" style={{ color: "rgba(240,236,224,0.85)" }}>
              Same per-second metered model as Daytona, E2B, Modal —{" "}
              <span className="relative inline-block">
                <span aria-hidden className="absolute inset-x-[-4px] bottom-[8%] h-[42%] -z-0 -skew-y-[1deg]" style={{ background: `${EMBER}3D`, borderRadius: 3 }} />
                <span className="relative">at roughly one-tenth the price per CPU-hour</span>
              </span>.
            </p>
            <div className="mt-3 inline-flex items-baseline gap-2 font-mono text-[12px]" style={{ color: MUT }}>
              <span>Daytona is ${VENDOR_RATES.daytona.vPerVcpu.toFixed(4)} / vCPU·h</span>
              <span>·</span>
              <span>same Linux. different bill.</span>
            </div>
          </div>
        </Reveal>

        <Reveal delay={420}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onDeploy} className="inline-flex h-12 items-center gap-2 rounded-full px-7 text-[14.5px] font-medium" style={{ background: EMBER, color: BONE }}>
              Deploy a box
              <span aria-hidden>→</span>
            </button>
            <a href="#calc" className="inline-flex h-12 items-center gap-2 rounded-full border px-5 text-[14px]" style={{ borderColor: HAIR, color: BONE }}>
              See your savings
            </a>
          </div>
        </Reveal>

        <Reveal delay={540}>
          <div className="mt-20 flex flex-col items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: MUT }}>
            <span>scroll · the math</span>
            <span aria-hidden className="block h-6 w-px animate-pulse" style={{ background: EMBER }} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ CH 2 · THE GUILT COUNTER ══════════════════════════════ */
function Ch2Counter() {
  // 4 vCPU / 8 GB / 160 GB benchmark — typical small agent box
  const dayHr = vendorHourly("daytona", 4, 8);
  const vpsHr = justavpsHourly(4, 8, 160);
  const dayPerSec = dayHr / 3600;
  const vpsPerSec = vpsHr / 3600;
  const dayMo = vendorMonthly("daytona", 4, 8, 24);
  const vpsMo = justavpsMonthly(4, 8, 160);
  const yearlySaved = (dayMo - vpsMo) * 12;

  const { seconds, daytona, vps, saved } = useGuiltCounter(dayPerSec, vpsPerSec);

  return (
    <section className="border-y" style={{ borderColor: HAIR, background: "#050506" }}>
      <div className="mx-auto max-w-[1080px] px-6 py-24 lg:py-32">
        <Reveal>
          <ChapterHead n="01" eyebrow="the guilt counter" />
        </Reveal>

        <Reveal delay={100}>
          <h2 className="mx-auto mt-8 max-w-[820px] text-center font-heading text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
            While you&apos;ve been here,
            <br />
            <span style={{ color: DIM }}>your agent has cost you this much.</span>
          </h2>
        </Reveal>

        <Reveal delay={200}>
          <div className="mx-auto mt-14 grid max-w-[920px] grid-cols-1 gap-px overflow-hidden rounded-2xl ring-1 sm:grid-cols-3" style={{ background: HAIR }}>
            <div className="p-6 sm:p-7" style={{ background: INK }}>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
                on Daytona
              </div>
              <div className="mt-3 font-heading text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[34px]" style={{ color: BONE }}>
                ${daytona.toFixed(6)}
              </div>
              <div className="mt-2 font-mono text-[11px]" style={{ color: MUT }}>
                ${dayPerSec.toFixed(7)}/sec · 4 vCPU + 8 GB
              </div>
            </div>
            <div className="p-6 sm:p-7" style={{ background: INK }}>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: EMBER }}>
                on just a vps
              </div>
              <div className="mt-3 font-heading text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[34px]" style={{ color: EMBER }}>
                ${vps.toFixed(6)}
              </div>
              <div className="mt-2 font-mono text-[11px]" style={{ color: MUT }}>
                ${vpsPerSec.toFixed(7)}/sec · same shape
              </div>
            </div>
            <div className="p-6 sm:p-7" style={{ background: INK }}>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
                you&apos;d save · so far
              </div>
              <div className="mt-3 font-heading text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[34px]" style={{ color: BONE }}>
                ${saved.toFixed(6)}
              </div>
              <div className="mt-2 font-mono text-[11px]" style={{ color: MUT }}>
                in {seconds.toFixed(1)} s of reading
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={320}>
          <div className="mx-auto mt-10 max-w-[820px] rounded-2xl border p-6 text-center sm:p-8" style={{ borderColor: HAIR, background: INK }}>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
              extrapolate that to one year of always-on
            </div>
            <div className="mt-3 font-heading text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[68px]" style={{ color: EMBER }}>
              <CountUp target={yearlySaved} prefix="$" /> <span style={{ color: DIM, fontSize: "0.5em" }}>/ year, per agent</span>
            </div>
            <p className="mt-4 text-[14px]" style={{ color: "rgba(240,236,224,0.7)" }}>
              That&apos;s the gap between Daytona and us, on this exact 4 vCPU / 8 GB box. Multiply by your number of agents.
            </p>
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
        <Reveal>
          <ChapterHead n="02" eyebrow="anatomy of the box" />
        </Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[52px]">
            Same Linux. <span style={{ color: DIM }}>Different bill.</span>
          </h2>
        </Reveal>

        <div className="relative mt-14 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <Reveal delay={140}>
            <SpecCard label="Daytona" sub="sandbox · per-second metered" mo={dayMo} muted />
          </Reveal>
          <Reveal delay={200}>
            <div className="hidden items-center justify-center lg:flex">
              <div className="font-heading text-[64px] font-semibold leading-none" style={{ color: DIM }}>=</div>
            </div>
          </Reveal>
          <Reveal delay={260}>
            <SpecCard label="just a vps" sub="dedicated · per-second metered" mo={vpsMo} accent />
          </Reveal>
        </div>

        <Reveal delay={360}>
          <p className="mx-auto mt-10 max-w-[640px] text-center text-[15px] leading-[1.65]" style={{ color: "rgba(240,236,224,0.7)" }}>
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
    <div className="overflow-hidden rounded-2xl border" style={{ borderColor: accent ? EMBER : HAIR, background: INK2 }}>
      <div className="flex items-baseline justify-between px-6 pt-5">
        <div className="font-heading text-[18px] font-semibold" style={{ color: accent ? EMBER : BONE }}>{label}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: DIM }}>{sub}</div>
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
            <dt className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>{k}</dt>
            <dd className="font-mono tabular-nums" style={{ color: muted ? DIM : BONE }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t px-6 py-5" style={{ borderColor: HAIR, background: accent ? "rgba(224,78,27,0.08)" : "transparent" }}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>monthly · 24/7</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-heading text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[56px]" style={{ color: accent ? EMBER : BONE, textDecoration: muted ? "line-through" : "none", textDecorationThickness: muted ? "2px" : undefined }}>
            ${mo}
          </span>
          <span className="font-mono text-[12px]" style={{ color: DIM }}>/ mo</span>
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
    <section id="calc" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR, background: INK2 }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal><ChapterHead n="03" eyebrow="run the numbers yourself" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
            Your shape. <span style={{ color: DIM }}>Your savings.</span>
          </h2>
        </Reveal>

        <Reveal delay={200}>
          <div className="mt-12 grid gap-4 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              <div className="rounded-2xl border p-6" style={{ borderColor: HAIR, background: INK }}>
                <div className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
                  <span>your workload</span>
                  <span style={{ color: EMBER }}>{fit.label.toLowerCase()}</span>
                </div>
                <div className="mt-5 space-y-6">
                  <Slider label="vCPU"    min={1}  max={16}   value={vcpu}    onChange={setVcpu}    unit="cores" />
                  <Slider label="memory"  min={1}  max={32}   value={ram}     onChange={setRam}     unit="GB" />
                  <Slider label="storage" min={20} max={1000} value={storage} onChange={setStorage} unit="GB" step={10} />
                </div>
              </div>
              <div className="rounded-2xl p-6" style={{ background: EMBER, color: BONE }}>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] opacity-80">
                  just a vps · billed by the second
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-y py-3" style={{ borderColor: "rgba(240,236,224,0.25)" }}>
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
                <button onClick={onDeploy} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-full px-3 font-mono text-[12.5px] font-medium" style={{ background: INK, color: BONE }}>
                  Deploy this box →
                </button>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="overflow-hidden rounded-2xl border" style={{ borderColor: HAIR, background: INK }}>
                <div className="grid grid-cols-[1.1fr_90px_110px_60px] items-center gap-3 border-b px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ borderColor: HAIR, color: DIM }}>
                  <span>vendor — at 24/7</span>
                  <span className="text-right">$/hour</span>
                  <span className="text-right">$/month</span>
                  <span className="text-right">vs us</span>
                </div>
                {competitors.map((c) => (
                  <Row key={c.k} name={c.name} hr={c.hr} mo={c.mo} max={maxMo} usMo={Math.max(1, usMo)} />
                ))}
                <div className="border-t" style={{ borderColor: HAIR, background: INK2 }}>
                  <Row name="just a vps" hr={usHr} mo={usMo} max={maxMo} usMo={Math.max(1, usMo)} us />
                </div>
                <div className="px-5 py-3 text-center font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: DIM, background: INK }}>
                  ≈ <b style={{ color: EMBER }}>{multiple}× cheaper</b> than the average sandbox
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

function Slider({ label, min, max, step = 1, value, onChange, unit }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; unit: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: DIM }}>{label}</span>
        <span className="font-heading text-[20px] font-semibold tabular-nums">
          {value}<span className="ml-1 font-mono text-[11px]" style={{ color: DIM }}>{unit}</span>
        </span>
      </div>
      <div className="relative mt-3 h-7">
        <div className="absolute inset-y-[13px] left-0 right-0 rounded-full" style={{ background: "rgba(240,236,224,0.1)" }} />
        <div className="absolute inset-y-[13px] left-0 rounded-full" style={{ width: `${pct}%`, background: EMBER }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-[color:var(--b)] [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-[color:var(--e)]
            [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-[color:var(--b)] [&::-moz-range-thumb]:border-0
            [&::-moz-range-thumb]:ring-2 [&::-moz-range-thumb]:ring-[color:var(--e)]"
          style={{ ["--b" as string]: BONE, ["--e" as string]: EMBER } as React.CSSProperties} />
      </div>
    </div>
  );
}

function Row({ name, hr, mo, max, usMo, us }: { name: string; hr: number; mo: number; max: number; usMo: number; us?: boolean }) {
  const pct = Math.max(6, (mo / max) * 100);
  const mult = us ? "1×" : `${Math.max(1, Math.round(mo / usMo))}×`;
  return (
    <div className="grid grid-cols-[1.1fr_90px_110px_60px] items-center gap-3 px-5 py-3" style={{ background: us ? "rgba(224,78,27,0.08)" : "transparent" }}>
      <div className="flex items-baseline gap-2">
        <span className="font-heading text-[15px] font-semibold" style={{ color: us ? EMBER : BONE }}>{name}</span>
        {us && <span className="font-mono text-[9.5px] uppercase tracking-[0.2em]" style={{ color: EMBER }}>per second</span>}
      </div>
      <div className="text-right font-mono tabular-nums text-[13px]" style={{ color: us ? EMBER : BONE }}>{fmtHourly(hr)}</div>
      <div className="text-right font-heading text-[16px] font-semibold tabular-nums" style={{ color: us ? EMBER : BONE }}>${mo.toLocaleString()}</div>
      <div className="flex items-center justify-end gap-2">
        <div className="hidden h-1 w-12 overflow-hidden rounded-full sm:block" style={{ background: "rgba(240,236,224,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: us ? EMBER : "rgba(240,236,224,0.55)" }} />
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: us ? EMBER : DIM }}>{mult}</span>
      </div>
    </div>
  );
}

/* ══════ CH 5 · HOW IT WORKS ═══════════════════════════════════ */
function Ch5HowItWorks() {
  const cards = [
    {
      n: "01",
      t: "We don't run microVMs.",
      b: "We provision boring, dedicated VMs from Hetzner / OVH / Contabo. Real Linux. Real disk. Same kernel as the sandboxes.",
    },
    {
      n: "02",
      t: "We add what they don't have.",
      b: "Authenticated port proxy on every port. SSH key fleet management. Snapshots. 1-click agent templates. The wrapper sandbox vendors built — minus the markup.",
    },
    {
      n: "03",
      t: "We bill per-second.",
      b: "CPU-seconds, GB-hours of RAM, GB-hours of disk. Same model the sandboxes use. We just don't markup compute 10×.",
    },
  ];
  return (
    <section id="how" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal><ChapterHead n="04" eyebrow="how is this even possible" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[48px]">
            No magic. <span style={{ color: DIM }}>Just the right stack.</span>
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {cards.map((c) => (
              <div key={c.n} className="rounded-2xl border p-6" style={{ borderColor: HAIR, background: INK2 }}>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: EMBER }}>step {c.n}</div>
                <h3 className="mt-3 font-heading text-[19px] font-semibold leading-[1.25]">{c.t}</h3>
                <p className="mt-3 text-[14px] leading-[1.65]" style={{ color: "rgba(240,236,224,0.72)" }}>{c.b}</p>
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
    <section className="border-b py-24" style={{ borderColor: HAIR, background: INK2 }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal><ChapterHead n="05" eyebrow="we are not for everyone" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center font-heading text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[44px]">
            When you should <span style={{ color: EMBER }}>stick with sandboxes</span>.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal delay={140}>
            <div className="relative rounded-2xl border-2 p-6" style={{ borderColor: EMBER, background: "rgba(224,78,27,0.05)" }}>
              <span className="absolute -top-3 left-5 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ background: EMBER, color: BONE }}>
                use us
              </span>
              <h3 className="mt-1 flex items-center gap-2 font-heading text-[16px] font-semibold">
                <span className="inline-flex size-5 items-center justify-center rounded-full text-[11px]" style={{ background: EMBER, color: BONE }}>✓</span>
                Your agent is a long-running process
              </h3>
              <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55]" style={{ color: "rgba(240,236,224,0.85)" }}>
                <li>Runs <b style={{ color: BONE }}>24/7</b>, not minutes.</li>
                <li>Has <b style={{ color: BONE }}>persistent state</b> on disk.</li>
                <li>Reboots maybe once a month — not per request.</li>
                <li>You want a <b style={{ color: BONE }}>predictable bill</b>.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={220}>
            <div className="rounded-2xl border p-6" style={{ borderColor: HAIR, background: INK }}>
              <span className="rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ borderColor: HAIR, color: DIM }}>
                stick with daytona / e2b / modal
              </span>
              <h3 className="mt-3 flex items-center gap-2 font-heading text-[16px] font-semibold">
                <span className="inline-flex size-5 items-center justify-center rounded-full text-[11px]" style={{ background: HAIR, color: DIM }}>→</span>
                Your workload is bursty
              </h3>
              <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55]" style={{ color: "rgba(240,236,224,0.7)" }}>
                <li>Sandboxes live <b style={{ color: BONE }}>seconds</b>, not days.</li>
                <li>You spawn <b style={{ color: BONE }}>thousands</b> per day.</li>
                <li>You need <b style={{ color: BONE }}>sub-second cold start</b>.</li>
                <li>Fresh environment per request is the point.</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ══════ CH 7 · KORTIX AUTHORITY ═══════════════════════════════ */
function Ch7Kortix() {
  return (
    <section className="border-b py-24" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: HAIR, background: INK2 }}>
            <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
              <div className="relative aspect-[4/3] md:aspect-auto">
                <Image src="/team.png" alt="Kortix team" fill className="object-cover" />
                <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(10,10,11,0.5) 100%)" }} />
              </div>
              <div className="flex flex-col justify-center gap-4 p-7 sm:p-9">
                <ChapterHead n="06" eyebrow="who built this" />
                <h3 className="font-heading text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[32px]">
                  We ran <span style={{ color: EMBER }}>3+ million sandboxes</span>. Then we hit the ceiling.
                </h3>
                <p className="text-[14.5px] leading-[1.65]" style={{ color: "rgba(240,236,224,0.78)" }}>
                  We&apos;re the team behind{" "}
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80" style={{ color: BONE }}>Kortix</a> — the
                  Autonomous Company OS. We burned through a lot of incumbent-sandbox bills running real agents.
                  When the math stopped working, we built our own.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px]" style={{ borderColor: HAIR, color: DIM }}>kortix.com ↗</a>
                  <a href="https://github.com/kortix-ai/suna" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px]" style={{ borderColor: HAIR, color: DIM }}>github.com/kortix-ai/suna ↗</a>
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
    <section id="faq" className="border-b py-24" style={{ borderColor: HAIR, background: INK2 }}>
      <div className="mx-auto max-w-[760px] px-6">
        <Reveal><ChapterHead n="07" eyebrow="the honest answers" /></Reveal>
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
    <div className="rounded-xl border" style={{ borderColor: HAIR, background: INK }}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <span className="font-heading text-[16px] font-medium">{q}</span>
        <span className="font-mono text-[18px] leading-none" style={{ color: EMBER }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-[14px] leading-[1.65]" style={{ color: "rgba(240,236,224,0.78)" }}>
          {a}
        </div>
      )}
    </div>
  );
}

/* ══════ CH 9 · DEPLOY ═════════════════════════════════════════ */
function Ch9Deploy({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section className="relative overflow-hidden border-b py-32" style={{ borderColor: HAIR }}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[80%]"
           style={{ background: `radial-gradient(55% 70% at 50% 100%, ${EMBER}30 0%, ${EMBER}00 60%)` }} />
      <div className="relative mx-auto max-w-[1080px] px-6 text-center">
        <Reveal>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
            our rate
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-3 font-heading font-semibold leading-[0.86] tracking-[-0.04em]"
               style={{ fontSize: "clamp(80px, 16vw, 200px)", color: EMBER }}>
            ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div className="font-mono text-[12px] uppercase tracking-[0.28em]" style={{ color: DIM }}>per vCPU · per hour</div>
        </Reveal>
        <Reveal delay={300}>
          <button onClick={onDeploy} className="mt-12 inline-flex h-14 items-center gap-2 rounded-full px-8 text-[15px] font-medium" style={{ background: EMBER, color: BONE }}>
            Deploy a box →
          </button>
        </Reveal>
        <Reveal delay={380}>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
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
        <div className="inline-flex items-center gap-2.5"><Mark /><span className="font-mono text-[12.5px]">just a vps</span><span className="font-mono text-[11px]" style={{ color: MUT }}>· by <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="hover:text-[color:var(--b)]" style={{ ["--b" as string]: BONE }}>Kortix</a></span></div>
        <div className="flex flex-wrap gap-5 font-mono text-[12px]" style={{ color: DIM }}>
          <a href="#calc" className="hover:text-[color:var(--b)]" style={{ ["--b" as string]: BONE }}>pricing</a>
          <a href="#how" className="hover:text-[color:var(--b)]" style={{ ["--b" as string]: BONE }}>how</a>
          <a href="#faq" className="hover:text-[color:var(--b)]" style={{ ["--b" as string]: BONE }}>faq</a>
          <a href="/docs" className="hover:text-[color:var(--b)]" style={{ ["--b" as string]: BONE }}>docs</a>
          <a href="/login" className="hover:text-[color:var(--b)]" style={{ ["--b" as string]: BONE }}>sign in</a>
          <a href="mailto:hey@justavps.com" className="hover:text-[color:var(--b)]" style={{ ["--b" as string]: BONE }}>contact</a>
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
      className={`fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border py-1.5 pl-5 pr-1.5 backdrop-blur-md transition-all duration-300 ${show ? "opacity-100" : "pointer-events-none translate-y-20 opacity-0"}`}
      style={{ borderColor: HAIR, background: "rgba(10,10,11,0.92)" }}
    >
      <span className="hidden text-[12.5px] sm:inline" style={{ color: DIM }}>
        <b style={{ color: BONE }}>${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}/vCPU·h</b>
      </span>
      <button onClick={onDeploy} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-mono text-[12.5px] font-medium" style={{ background: EMBER, color: BONE }}>
        DEPLOY →
      </button>
    </div>
  );
}
