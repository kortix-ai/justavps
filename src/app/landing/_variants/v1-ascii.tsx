"use client";

/* ═══════════════════════════════════════════════════════════════════
 *  V1 · "ASCII"   —   monochrome monospace
 *
 *  Same first-principles 9-chapter spine as V3 Live, dressed as a
 *  developer document. Hero = `cat /etc/justavps/rate.conf`. Counter
 *  rendered top(1)-style. # § NN section labels.
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
import { AsciiSlider, CountUp, Reveal, useGuiltCounter } from "../_shared/interactive";

const BG = "#0A0A0A";
const FG = "#F3EFE3";
const DIM = "#8F8A7C";
const MUT = "#5B5850";
const SOFT = "#1A1915";

export function V1Ascii({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div
      className="min-h-screen"
      style={{ background: BG, color: FG, fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}
    >
      <Nav onDeploy={onDeploy} />
      <Ch1Hero onDeploy={onDeploy} />
      <Ch2Top />
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

function SectionHead({ n, eyebrow }: { n: string; eyebrow: string }) {
  return (
    <div className="flex items-center justify-center gap-3 text-[10.5px] uppercase tracking-[0.3em]" style={{ color: DIM }}>
      <span className="block h-px w-8" style={{ background: SOFT }} />
      <span style={{ color: FG }}># § {n}</span>
      <span className="block h-px w-2" style={{ background: SOFT }} />
      <span>{eyebrow}</span>
      <span className="block h-px w-8" style={{ background: SOFT }} />
    </div>
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
          {[["./calc", "#calc"], ["./how", "#how"], ["./faq", "#faq"], ["./docs", "/docs"]].map(([l, h]) => (
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

/* ══════ CH 1 · cat /etc/justavps/rate.conf ════════════════════ */
function Ch1Hero({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section id="top" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 pt-28 pb-24 sm:pt-32">
        <Reveal>
          <div className="flex items-center justify-center gap-3 text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
            <span className="block h-px w-10" style={{ background: DIM }} />
            <span style={{ color: FG }}>just a vps</span>
            <span>· per-second metered</span>
            <span className="block h-px w-10" style={{ background: DIM }} />
          </div>
        </Reveal>

        <Reveal delay={120}>
          {/* terminal containing the rate file */}
          <div className="mx-auto mt-10 max-w-[860px] overflow-hidden border-2" style={{ borderColor: FG }}>
            <div className="flex items-center gap-2 border-b px-4 py-2 text-[10.5px] uppercase tracking-[0.22em]" style={{ borderColor: SOFT, color: DIM }}>
              <span className="size-2 rounded-full" style={{ background: "#FF5F57" }} />
              <span className="size-2 rounded-full" style={{ background: "#FEBC2E" }} />
              <span className="size-2 rounded-full" style={{ background: "#28C840" }} />
              <span className="ml-3">marko@home ~ · /etc/justavps/rate.conf</span>
            </div>
            <pre className="overflow-x-auto px-6 py-7 text-[12.5px] leading-[1.85] sm:px-10 sm:py-9">
<span style={{ color: DIM }}>$ </span>cat /etc/justavps/rate.conf

<span style={{ color: DIM }}># just a vps · billing rates · per resource · per hour</span>
<span style={{ color: DIM }}># revision: a · 04/2026</span>

<span>vCPU         = </span><span className="inline-block px-1" style={{ background: FG, color: BG }}>${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}</span><span>{" "}per hour</span>
<span>memory       = </span><span style={{ color: FG }}>${JUSTAVPS_RATES.vPerGb.toFixed(4)}</span><span>{" "}per GB-hour</span>
<span>storage      = </span><span style={{ color: FG }}>${(JUSTAVPS_RATES.vPerStorage * 730).toFixed(3)}</span><span>{" "}per GB-month</span>

<span style={{ color: DIM }}># for reference, the same shop charges:</span>
<span style={{ color: DIM }}>#   daytona vCPU = </span><span style={{ color: DIM, textDecoration: "line-through" }}>${VENDOR_RATES.daytona.vPerVcpu.toFixed(4)}</span><span style={{ color: DIM }}>{"  ← 10x"}</span>
<span style={{ color: DIM }}>#   modal   vCPU = </span><span style={{ color: DIM, textDecoration: "line-through" }}>${VENDOR_RATES.modal.vPerVcpu.toFixed(4)}</span><span style={{ color: DIM }}>{"  ← 28x"}</span>

<span style={{ color: DIM }}># EOF</span>
            </pre>
          </div>
        </Reveal>

        <Reveal delay={300}>
          <div className="mx-auto mt-10 max-w-[640px] text-center">
            <h1 className="text-[42px] font-semibold leading-[1] tracking-[-0.025em] sm:text-[60px]">
              Just a VPS.
            </h1>
            <p className="mt-5 text-[16px] leading-[1.6]" style={{ color: "rgba(243,239,227,0.85)" }}>
              Same per-second metered model as Daytona, E2B, Modal — at roughly one-tenth the price per CPU-hour.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button onClick={onDeploy} className="inline-flex h-11 items-center gap-2 border px-5 text-[13px]" style={{ borderColor: FG, background: FG, color: BG }}>
                deploy a box →
              </button>
              <a href="#calc" className="inline-flex h-11 items-center gap-2 border px-5 text-[13px]" style={{ borderColor: FG, color: FG }}>
                see your savings
              </a>
            </div>
          </div>
        </Reveal>

        <Reveal delay={500}>
          <div className="mt-20 flex flex-col items-center gap-2 text-[10.5px] uppercase tracking-[0.28em]" style={{ color: MUT }}>
            <span>scroll · the math</span>
            <span aria-hidden className="block h-6 w-px animate-pulse" style={{ background: FG }} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ CH 2 · top(1) GUILT COUNTER ═══════════════════════════ */
function Ch2Top() {
  const dayHr = vendorHourly("daytona", 4, 8);
  const vpsHr = justavpsHourly(4, 8, 160);
  const dayPerSec = dayHr / 3600;
  const vpsPerSec = vpsHr / 3600;
  const dayMo = vendorMonthly("daytona", 4, 8, 24);
  const vpsMo = justavpsMonthly(4, 8, 160);
  const yearlySaved = (dayMo - vpsMo) * 12;

  const { seconds, daytona, vps, saved } = useGuiltCounter(dayPerSec, vpsPerSec);

  // format an mm:ss-style elapsed string
  const t = Math.floor(seconds);
  const elapsed = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

  return (
    <section className="border-b" style={{ borderColor: SOFT, background: "#050505" }}>
      <div className="mx-auto max-w-[980px] px-5 py-24">
        <Reveal><SectionHead n="01" eyebrow="the guilt counter" /></Reveal>

        <Reveal delay={100}>
          <h2 className="mx-auto mt-8 max-w-[720px] text-center text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[42px]">
            While you&apos;ve been here,
            <br />
            <span style={{ color: DIM }}>your agent has cost you this much.</span>
          </h2>
        </Reveal>

        <Reveal delay={200}>
          {/* top(1)-style live process display */}
          <div className="mx-auto mt-12 max-w-[920px] overflow-hidden border" style={{ borderColor: SOFT }}>
            <div className="flex items-center justify-between border-b px-4 py-2 text-[10.5px] uppercase tracking-[0.22em]" style={{ borderColor: SOFT, color: DIM }}>
              <span>top · live · agent-prod · 4 vCPU / 8 GB</span>
              <span className="flex items-center gap-3"><span style={{ color: FG }}>elapsed {elapsed}</span></span>
            </div>
            <pre className="overflow-x-auto px-5 py-5 text-[12.5px] leading-[1.95]">
<span style={{ color: DIM }}>{`PROCESS              RATE/sec           ACCRUED            DELTA
─────────────────────────────────────────────────────────────────`}</span>{"\n"}
<span>{`agent-prod (daytona) `}</span><span>{` $${dayPerSec.toFixed(7)}   $${daytona.toFixed(8)}      —`}</span>{"\n"}
<span style={{ color: FG }}>{`agent-prod (just-vps) `}<span className="inline-block px-1" style={{ background: FG, color: BG }}>{`$${vpsPerSec.toFixed(7)}`}</span>{`  $${vps.toFixed(8)}      `}<span style={{ color: BG, background: FG, padding: "0 4px" }}>{`-$${saved.toFixed(8)}`}</span></span>{"\n"}
<span style={{ color: DIM }}>{"─".repeat(65)}</span>{"\n"}
<span>{`                                       saved · so far  · `}</span><span style={{ color: FG }}>{`$${saved.toFixed(8)}`}</span>
            </pre>
          </div>
        </Reveal>

        <Reveal delay={300}>
          <div className="mx-auto mt-8 max-w-[920px] border p-6 text-center sm:p-8" style={{ borderColor: FG, background: "rgba(243,239,227,0.02)" }}>
            <div className="text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
              extrapolate · 1 year of always-on, per agent
            </div>
            <div className="mt-3 text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[64px]">
              <CountUp target={yearlySaved} prefix="$" /> <span style={{ color: DIM, fontSize: "0.5em" }}>/ yr</span>
            </div>
            <p className="mt-4 text-[13px]" style={{ color: "rgba(243,239,227,0.7)" }}>
              that&apos;s the gap between daytona and us, on this exact 4 vCPU / 8 GB box. multiply by your agents.
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
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-24">
        <Reveal><SectionHead n="02" eyebrow="anatomy of the box" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
            Same Linux. <span style={{ color: DIM }}>Different bill.</span>
          </h2>
        </Reveal>

        <div className="relative mt-12 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <Reveal delay={140}><SpecCard label="Daytona" sub="sandbox · per-sec" mo={dayMo} muted /></Reveal>
          <Reveal delay={200}>
            <div className="hidden items-center justify-center lg:flex">
              <div className="text-[60px] font-semibold leading-none" style={{ color: DIM }}>=</div>
            </div>
          </Reveal>
          <Reveal delay={260}><SpecCard label="just a vps" sub="dedicated · per-sec" mo={vpsMo} accent /></Reveal>
        </div>

        <Reveal delay={360}>
          <p className="mx-auto mt-10 max-w-[640px] text-center text-[14px] leading-[1.7]" style={{ color: DIM }}>
            a vCPU is a vCPU. a gb of ram is a gb of ram. the kernel is the same kernel. we just don&apos;t charge sandbox markup.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function SpecCard({ label, sub, mo, accent, muted }: { label: string; sub: string; mo: number; accent?: boolean; muted?: boolean }) {
  return (
    <div className="border-2" style={{ borderColor: accent ? FG : SOFT }}>
      <div className="flex items-baseline justify-between border-b px-5 py-3" style={{ borderColor: SOFT }}>
        <div className="text-[15px] font-semibold" style={{ color: accent ? FG : FG }}>{label}</div>
        <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: DIM }}>{sub}</div>
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-[12.5px] leading-[1.85]">
{`kernel  Linux 6.1
arch    x86_64
vCPU    4 cores
memory  8 GB
disk    160 GB SSD
uptime  24 / 7`}
      </pre>
      <div className="border-t px-5 py-4" style={{ borderColor: SOFT, background: accent ? "rgba(243,239,227,0.04)" : "transparent" }}>
        <div className="text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>monthly · 24/7</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[52px]"
                style={{ color: accent ? FG : FG, textDecoration: muted ? "line-through" : "none", textDecorationThickness: muted ? "2px" : undefined, opacity: muted ? 0.7 : 1 }}>
            ${mo}
          </span>
          <span className="text-[12px]" style={{ color: DIM }}>/ mo</span>
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
        <Reveal><SectionHead n="03" eyebrow="run the numbers yourself" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
            Your shape. <span style={{ color: DIM }}>Your savings.</span>
          </h2>
        </Reveal>

        <Reveal delay={200}>
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
                <div className="text-[10.5px] uppercase tracking-[0.22em]" style={{ color: FG }}>just a vps · billed by the second</div>
                <pre className="mt-3 text-[12.5px] leading-[1.95]">
{`per sec   $${(usHr / 3600).toFixed(7)}
per hour  ${fmtHourly(usHr)}
24/7 mo   $${usMo}`}
                </pre>
                <p className="mt-3 text-[11.5px] leading-[1.65]" style={{ color: DIM }}>
                  &gt; you only pay for the seconds your agent uses cpu, the gb-hours of ram it touches, and the gb of disk it stores.
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
                ≈ <b style={{ color: FG }}>{multiple}× cheaper</b> than the average sandbox
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={300}>
          <p className="mt-5 text-center text-[11px]" style={{ color: MUT }}>
            our rates · ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}/vCPU·h · ${JUSTAVPS_RATES.vPerGb.toFixed(4)}/GB-RAM·h · ${(JUSTAVPS_RATES.vPerStorage * 730).toFixed(3)}/GB-storage·month
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ CH 5 · HOW IT WORKS ═══════════════════════════════════ */
function Ch5HowItWorks() {
  const cards = [
    { n: "01", t: "we don't run microvms.", b: "we provision boring, dedicated vms from hetzner / ovh / contabo. real linux. real disk. same kernel as the sandboxes." },
    { n: "02", t: "we add what they don't.", b: "authenticated port proxy on every port. ssh key fleet. snapshots. 1-click agent templates. the wrapper sandbox vendors built — minus the markup." },
    { n: "03", t: "we bill per-second.", b: "cpu-seconds, gb-hours of ram, gb-hours of disk. same model the sandboxes use. we just don't markup compute 10×." },
  ];
  return (
    <section id="how" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-24">
        <Reveal><SectionHead n="04" eyebrow="how is this even possible" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
            no magic. <span style={{ color: DIM }}>just the right stack.</span>
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <div className="mt-12 grid gap-3 md:grid-cols-3">
            {cards.map((c) => (
              <div key={c.n} className="border p-5" style={{ borderColor: SOFT }}>
                <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: FG }}>step {c.n}</div>
                <h3 className="mt-3 text-[17px] font-semibold leading-[1.25]">{c.t}</h3>
                <p className="mt-3 text-[13px] leading-[1.65]" style={{ color: DIM }}>{c.b}</p>
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
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-20">
        <Reveal><SectionHead n="05" eyebrow="we are not for everyone" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[40px]">
            when you should <span style={{ color: FG }}>stick with sandboxes</span>.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-3 md:grid-cols-2">
          <Reveal delay={140}>
            <div className="relative border-2 p-5" style={{ borderColor: FG }}>
              <span className="absolute -top-2.5 left-4 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]" style={{ background: FG, color: BG }}>use us</span>
              <h3 className="mt-1 flex items-center gap-2 text-[15px] font-semibold">
                <span className="border px-1.5" style={{ borderColor: FG, color: FG }}>✓</span>
                long-running process
              </h3>
              <ul className="mt-4 space-y-2 text-[13px] leading-[1.55]" style={{ color: "rgba(243,239,227,0.85)" }}>
                <li>runs <b>24/7</b>, not minutes.</li>
                <li>has <b>persistent state</b> on disk.</li>
                <li>reboots maybe once a month.</li>
                <li>you want a <b>predictable bill</b>.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={220}>
            <div className="border p-5" style={{ borderColor: SOFT }}>
              <span className="border px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]" style={{ borderColor: SOFT, color: DIM }}>stick with sandboxes</span>
              <h3 className="mt-3 flex items-center gap-2 text-[15px] font-semibold">
                <span className="border px-1.5" style={{ borderColor: SOFT, color: DIM }}>→</span>
                bursty workload
              </h3>
              <ul className="mt-4 space-y-2 text-[13px] leading-[1.55]" style={{ color: DIM }}>
                <li>sandboxes live <b style={{ color: FG }}>seconds</b>, not days.</li>
                <li>you spawn <b style={{ color: FG }}>thousands</b> per day.</li>
                <li>you need <b style={{ color: FG }}>sub-second cold start</b>.</li>
                <li>fresh env per request is the point.</li>
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
                <SectionHead n="06" eyebrow="who built this" />
                <h3 className="text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[28px]">
                  we ran <span style={{ color: FG }}>3+ million sandboxes</span>. then we hit the ceiling.
                </h3>
                <p className="text-[13.5px] leading-[1.65]" style={{ color: "rgba(243,239,227,0.78)" }}>
                  we&apos;re the team behind{" "}
                  <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80" style={{ color: FG }}>kortix</a> — the autonomous company OS.
                  we burned through a lot of incumbent-sandbox bills running real agents. when the math stopped working, we built our own.
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

/* ══════ CH 8 · FAQ ════════════════════════════════════════════ */
function Ch8Faq() {
  const items = [
    { q: "what if i hate it?", a: "cancel anytime. no contracts. your data is yours — download it and leave whenever." },
    { q: "is it really cheaper, or is there a catch?", a: "no catch. run the calculator. daytona / e2b / modal charge ~$0.05/vCPU·h. we charge ~$0.005. same model, different markup." },
    { q: "why is it ~10× cheaper?", a: "we don't use microvms. dedicated vms are an order of magnitude cheaper at the substrate, and we don't take the same margin sandbox vendors do on top." },
    { q: "what about cold-start?", a: "first boot is ~10 seconds. after that the machine is on — no per-request cold start. that's the point of a vps." },
    { q: "which agents can i run?", a: "claude code, codex, opencode, pi coding agents, cursor workflows. anything that runs on linux." },
    { q: "how secure is it?", a: "ssh uses keys, not passwords. every public port is gated by an authenticated proxy. api + session auth supported." },
  ];
  return (
    <section id="faq" className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[760px] px-5 py-24">
        <Reveal><SectionHead n="07" eyebrow="the honest answers" /></Reveal>
        <Reveal delay={100}>
          <h2 className="mt-8 text-center text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[42px]">
            six objections. answered.
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

/* ══════ CH 9 · DEPLOY ═════════════════════════════════════════ */
function Ch9Deploy({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section className="border-b" style={{ borderColor: SOFT }}>
      <div className="mx-auto max-w-[980px] px-5 py-32 text-center">
        <Reveal>
          <div className="text-[10.5px] uppercase tracking-[0.28em]" style={{ color: DIM }}>
            $ cat /etc/justavps/rate.conf | head -1
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-3 font-semibold leading-[0.86] tracking-[-0.04em]"
               style={{ fontSize: "clamp(72px, 14vw, 168px)" }}>
            ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div className="text-[12px] uppercase tracking-[0.28em]" style={{ color: DIM }}>per vCPU · per hour</div>
        </Reveal>
        <Reveal delay={300}>
          <button onClick={onDeploy} className="mt-12 inline-flex h-12 items-center gap-2 border px-7 text-[14px]" style={{ borderColor: FG, background: FG, color: BG }}>
            $ deploy now →
          </button>
        </Reveal>
        <Reveal delay={380}>
          <p className="mt-5 text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
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
      <div className="mx-auto flex max-w-[980px] flex-col items-center gap-3 px-5 sm:flex-row sm:justify-between text-[12px]" style={{ color: MUT }}>
        <span>just a vps · © {new Date().getFullYear()} · by <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>kortix</a></span>
        <div className="flex flex-wrap gap-5">
          <a href="#calc" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>./pricing</a>
          <a href="#how" className="hover:text-[color:var(--f)]" style={{ ["--f" as string]: FG }}>./how</a>
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
function FloatingCta({ onDeploy }: { onDeploy: () => void }) {
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
        <b style={{ color: FG }}>${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}/vCPU·h</b>
      </span>
      <button onClick={onDeploy} className="border px-3 py-1.5 text-[12px] hover:bg-[color:var(--f)] hover:text-[color:var(--b)]"
              style={{ borderColor: FG, ["--f" as string]: FG, ["--b" as string]: BG }}>
        $ DEPLOY →
      </button>
    </div>
  );
}
