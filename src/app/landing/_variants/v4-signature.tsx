"use client";

/* ═══════════════════════════════════════════════════════════════════
 *  V4 · "Signature"   —   paper · ink · ember
 *
 *  The reference version. Combines:
 *   • Stripe Press editorial restraint
 *   • Linear-grade motion choreography
 *   • growth.design narrative + annotated visuals
 *   • Fly.io developer honesty
 *
 *  Signature moves (only here):
 *   • Typewriter hero — /etc/justavps/rate.conf prints live
 *   • The Receipt — two printed receipts print line-by-line
 *   • Guilt gauge — needle meter, not card grid
 *   • Persistent shape state — calculator shape propagates to every
 *     section (Receipt, Gauge, Same-Linux all update when you slide)
 *   • Choreographed entry motion with spring-feel easing
 * ═══════════════════════════════════════════════════════════════════ */

import Image from "next/image";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

/* ── palette · paper editorial ──────────────────────────────────── */
const PAPER = "#FAFAF7";
const PAPER2 = "#F4F2EB";
const INK = "#0A0A0B";
const CHAR = "#1B1B1F";
const MUT = "#6B6B6B";
const DIM = "#9A9894";
const HAIR = "#E8E6DD";
const EMBER = "#E04E1B";

/* ══════ SHAPE CONTEXT · signature persistent state ══════════════ */
type Shape = { vcpu: number; ram: number; storage: number };
type ShapeCtx = { shape: Shape; setShape: (s: Shape) => void };
const ShapeContext = createContext<ShapeCtx | null>(null);
function useShape() {
  const ctx = useContext(ShapeContext);
  if (!ctx) throw new Error("shape context missing");
  return ctx;
}

export function V4Signature({ onDeploy }: { onDeploy: () => void }) {
  const [shape, setShape] = useState<Shape>({ vcpu: 4, ram: 8, storage: 160 });
  return (
    <ShapeContext.Provider value={{ shape, setShape }}>
      <div className="min-h-screen" style={{ background: PAPER, color: INK }}>
        <Nav onDeploy={onDeploy} />
        <Hero onDeploy={onDeploy} />
        <ChReceipt />
        <ChGauge />
        <ChCalculator onDeploy={onDeploy} />
        <ChSameLinux />
        <ChHow />
        <ChWhenNot />
        <ChKortix />
        <ChFaq />
        <ChDeploy onDeploy={onDeploy} />
        <Footer />
        <FloatingCta onDeploy={onDeploy} />
      </div>
    </ShapeContext.Provider>
  );
}

/* ══════ PRIMITIVES ═════════════════════════════════════════════ */
function Mark() {
  return (
    <svg viewBox="0 0 28 28" width="22" height="22" aria-hidden>
      <rect x="0" y="0" width="28" height="28" rx="7" fill={INK} />
      <path d="M8 9 L13 14 L8 19" stroke={PAPER} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="15" y="18" width="6" height="2.2" rx="0.6" fill={EMBER} />
    </svg>
  );
}

function Kicker({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.3em]" style={{ color: MUT }}>
      <span style={{ color: EMBER }}>№ {n}</span>
      <span className="block h-px w-8" style={{ background: HAIR }} />
      <span>{label}</span>
    </div>
  );
}

/* Highlighted text using a soft rectangle rather than a swoosh */
function Mark1({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block">
      <span aria-hidden className="absolute inset-x-[-4px] bottom-[10%] h-[42%] -z-0"
            style={{ background: `${EMBER}22`, borderRadius: 3 }} />
      <span className="relative">{children}</span>
    </span>
  );
}

/* ══════ NAV ════════════════════════════════════════════════════ */
function Nav({ onDeploy }: { onDeploy: () => void }) {
  return (
    <header className="sticky top-10 z-40 border-b backdrop-blur" style={{ borderColor: HAIR, background: `${PAPER}dd` }}>
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between px-6">
        <a href="#top" className="inline-flex items-center gap-2.5">
          <Mark />
          <span className="font-mono text-[13px]">just a vps</span>
        </a>
        <nav className="hidden gap-7 md:flex">
          {[["receipt", "#receipt"], ["math", "#calc"], ["how", "#how"], ["faq", "#faq"]].map(([l, h]) => (
            <a key={l} href={h} className="font-mono text-[12.5px] transition-colors hover:text-[color:var(--i)]" style={{ color: MUT, ["--i" as string]: INK }}>{l}</a>
          ))}
        </nav>
        <button onClick={onDeploy} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium text-white" style={{ background: INK }}>
          Deploy
        </button>
      </div>
    </header>
  );
}

/* ══════ HERO · typewriter rate.conf ════════════════════════════ */
function Hero({ onDeploy }: { onDeploy: () => void }) {
  const lines = useMemo(() => [
    { t: "$ cat /etc/justavps/rate.conf", c: MUT },
    { t: "", c: MUT },
    { t: "# just a vps · per-second metered", c: MUT },
    { t: "# revision: a · april 2026", c: MUT },
    { t: "", c: MUT },
    { t: `vCPU     = $${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}   # per hour`, c: INK, emphasise: true },
    { t: `memory   = $${JUSTAVPS_RATES.vPerGb.toFixed(4)}  # per GB · hour`, c: INK },
    { t: `storage  = $${(JUSTAVPS_RATES.vPerStorage * 730).toFixed(3)}   # per GB · month`, c: INK },
    { t: "", c: MUT },
    { t: `# daytona = $${VENDOR_RATES.daytona.vPerVcpu.toFixed(4)}/vCPU·h  ← 10×`, c: DIM, strike: true },
    { t: `# modal   = $${VENDOR_RATES.modal.vPerVcpu.toFixed(4)}/vCPU·h  ← 28×`, c: DIM, strike: true },
    { t: "", c: MUT },
    { t: "# EOF", c: MUT },
  ], []);

  const [shown, setShown] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setShown((n) => Math.min(lines.length, n + 1)), 85);
    return () => clearInterval(iv);
  }, [lines.length]);

  return (
    <section id="top" className="relative overflow-hidden border-b" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6 pt-28 pb-20 sm:pt-32">
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ borderColor: HAIR, color: MUT }}>
            <span className="inline-block size-[6px] animate-pulse rounded-full" style={{ background: EMBER }} />
            just a vps · per-second metered
          </div>
        </Reveal>

        {/* Terminal printing the rate file */}
        <Reveal delay={100}>
          <div className="mt-8 overflow-hidden rounded-2xl border-2 shadow-2xl shadow-[#0A0A0B]/10" style={{ borderColor: INK, background: INK }}>
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-[#FF5F57]" />
              <span className="size-2.5 rounded-full bg-[#FEBC2E]" />
              <span className="size-2.5 rounded-full bg-[#28C840]" />
              <span className="ml-3 font-mono text-[11px] text-white/50">marko@home ~ · /etc/justavps/rate.conf</span>
            </div>
            <pre className="px-6 py-8 font-mono text-[13px] leading-[1.85] sm:px-10 sm:py-10" style={{ color: "#F4F2EB" }}>
              {lines.slice(0, shown).map((l, i) => (
                <div key={i} style={{ color: l.c, textDecoration: l.strike ? "line-through" : "none", opacity: l.c === MUT || l.c === DIM ? 0.7 : 1 }}>
                  {l.emphasise ? (
                    <>
                      <span>vCPU     = </span>
                      <span className="inline-block px-1.5" style={{ background: EMBER, color: PAPER }}>
                        ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}
                      </span>
                      <span>   # per hour</span>
                    </>
                  ) : (l.t || "\u00A0")}
                </div>
              ))}
              {shown < lines.length && (
                <span aria-hidden className="inline-block size-[10px] animate-pulse" style={{ background: "#F4F2EB" }} />
              )}
            </pre>
          </div>
        </Reveal>

        {/* Claim + CTAs below */}
        <Reveal delay={220}>
          <div className="mx-auto mt-12 max-w-[680px] text-center">
            <h1 className="font-heading font-semibold leading-[0.98] tracking-[-0.035em]"
                style={{ fontSize: "clamp(44px, 7vw, 68px)", color: INK }}>
              Just a VPS.
            </h1>
            <p className="mt-5 text-[17px] leading-[1.55] sm:text-[19px]" style={{ color: CHAR }}>
              Same per-second metered model as Daytona, E2B, Modal —
              at <Mark1>roughly one-tenth the price per CPU-hour</Mark1>.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <button onClick={onDeploy} className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-[14.5px] font-medium text-white" style={{ background: INK }}>
                Deploy a box →
              </button>
              <a href="#receipt" className="inline-flex h-12 items-center gap-2 rounded-full border px-5 text-[14px]" style={{ borderColor: HAIR, color: INK, background: "#fff" }}>
                See the receipt
              </a>
            </div>
            <div className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ color: MUT }}>
              scroll · the receipt
              <div aria-hidden className="mx-auto mt-2 h-5 w-px animate-pulse" style={{ background: INK }} />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ CH · THE RECEIPT ════════════════════════════════════════
 * Two printed-receipt cards print their lines in sequence via
 * staggered Reveal. Daytona receipt prints red total, then ours
 * prints a tiny fraction in ember.
 * ───────────────────────────────────────────────────────────────── */
function ChReceipt() {
  const { shape } = useShape();
  const dayLineCpu = VENDOR_RATES.daytona.vPerVcpu * shape.vcpu * 730;
  const dayLineRam = VENDOR_RATES.daytona.vPerGb * shape.ram * 730;
  const dayTotal = Math.round(dayLineCpu + dayLineRam);

  const usLineCpu = JUSTAVPS_RATES.vPerVcpu * shape.vcpu * 730;
  const usLineRam = JUSTAVPS_RATES.vPerGb * shape.ram * 730;
  const usLineDisk = JUSTAVPS_RATES.vPerStorage * shape.storage * 730;
  const usTotal = Math.round(usLineCpu + usLineRam + usLineDisk);
  const saved = dayTotal - usTotal;

  return (
    <section id="receipt" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR, background: PAPER2 }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <div className="text-center">
          <Reveal><Kicker n="01" label="the receipt" /></Reveal>
          <Reveal delay={80}>
            <h2 className="mx-auto mt-4 max-w-[820px] font-heading font-semibold leading-[1.08] tracking-[-0.025em]"
                style={{ fontSize: "clamp(30px, 4.6vw, 52px)", color: INK }}>
              One agent. 30 days. <span style={{ color: MUT }}>Two invoices.</span>
            </h2>
          </Reveal>
          <Reveal delay={140}>
            <p className="mx-auto mt-4 max-w-[560px] text-[14.5px] leading-[1.65]" style={{ color: CHAR }}>
              {shape.vcpu} vCPU · {shape.ram} GB · {shape.storage} GB storage ·
              running always-on. Prices below are the actual list rates at this shape.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <Reveal delay={220}>
            <Receipt
              vendor="Daytona"
              stamp="SANDBOX"
              stampColor="#B33A00"
              lines={[
                ["cpu usage", `${shape.vcpu} vCPU × 730 h × $${VENDOR_RATES.daytona.vPerVcpu.toFixed(4)}`, `$${dayLineCpu.toFixed(2)}`],
                ["ram usage", `${shape.ram} GB × 730 h × $${VENDOR_RATES.daytona.vPerGb.toFixed(4)}`, `$${dayLineRam.toFixed(2)}`],
                ["storage", "— bundled in compute rate —", "$0.00"],
              ]}
              totalLabel="monthly total"
              total={dayTotal}
              footer="for one machine · one agent · one month"
              muted
            />
          </Reveal>
          <Reveal delay={360}>
            <Receipt
              vendor="just a vps"
              stamp="PAID"
              stampColor={EMBER}
              lines={[
                ["cpu usage", `${shape.vcpu} vCPU × 730 h × $${JUSTAVPS_RATES.vPerVcpu.toFixed(4)}`, `$${usLineCpu.toFixed(2)}`],
                ["ram usage", `${shape.ram} GB × 730 h × $${JUSTAVPS_RATES.vPerGb.toFixed(4)}`, `$${usLineRam.toFixed(2)}`],
                ["storage",   `${shape.storage} GB × 730 h × $${JUSTAVPS_RATES.vPerStorage.toFixed(5)}`, `$${usLineDisk.toFixed(2)}`],
              ]}
              totalLabel="monthly total"
              total={usTotal}
              footer="same shape · same 730 h · pay for what you use"
            />
          </Reveal>
        </div>

        <Reveal delay={520}>
          <div className="mx-auto mt-10 flex max-w-[720px] flex-col items-center gap-1 rounded-full border bg-white px-6 py-4 text-center sm:flex-row sm:justify-between" style={{ borderColor: HAIR }}>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ color: MUT }}>
              you keep, per agent
            </span>
            <span className="font-heading text-[34px] font-semibold tabular-nums tracking-[-0.02em]" style={{ color: EMBER }}>
              <CountUp target={saved} prefix="$" />
              <span className="ml-2 font-mono text-[12px] uppercase tracking-[0.22em]" style={{ color: MUT }}>/ month</span>
            </span>
            <span className="font-mono text-[11px]" style={{ color: MUT }}>
              ≈ <span style={{ color: INK }}><CountUp target={saved * 12} prefix="$" />/yr</span>
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Receipt({
  vendor, stamp, stampColor, lines, totalLabel, total, footer, muted,
}: {
  vendor: string; stamp: string; stampColor: string;
  lines: [string, string, string][];
  totalLabel: string; total: number; footer: string; muted?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_60px_-24px_rgba(10,10,11,0.25)]"
         style={{ border: `1px solid ${HAIR}` }}>
      {/* top deckle edge */}
      <svg aria-hidden className="block w-full" height="10" preserveAspectRatio="none" viewBox="0 0 100 10">
        <polygon points={Array.from({ length: 41 }).map((_, i) => `${i * 2.5},${i % 2 === 0 ? 10 : 0}`).join(" ")} fill="white" />
        <polygon points={Array.from({ length: 41 }).map((_, i) => `${i * 2.5},${i % 2 === 0 ? 10 : 0}`).join(" ") + " 100,10 0,10"} fill={PAPER2} />
      </svg>

      <div className="px-7 pb-7 pt-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: MUT }}>invoice</div>
            <div className="mt-0.5 font-heading text-[17px] font-semibold">{vendor}</div>
          </div>
          <div className="text-right font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: MUT }}>
            acct · agent-prod<br />
            period · 04/2026
          </div>
        </div>

        {/* stamp */}
        <div className="absolute right-5 top-16 rotate-[-8deg] rounded border-2 px-3 py-1 font-heading text-[12px] font-bold uppercase tracking-[0.2em]"
             style={{ borderColor: stampColor, color: stampColor, opacity: 0.85 }}>
          {stamp}
        </div>

        {/* lines */}
        <div className="mt-6 space-y-3">
          {lines.map((ln, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-dashed pb-2.5 last:border-b-0" style={{ borderColor: HAIR }}>
              <div>
                <div className="text-[13.5px]" style={{ color: INK }}>{ln[0]}</div>
                <div className="mt-0.5 font-mono text-[11px]" style={{ color: MUT }}>{ln[1]}</div>
              </div>
              <div className="font-mono text-[13.5px] tabular-nums" style={{ color: muted ? MUT : INK }}>{ln[2]}</div>
            </div>
          ))}
        </div>

        {/* total */}
        <div className="mt-5 flex items-baseline justify-between border-t-2 pt-3" style={{ borderColor: INK }}>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.24em]" style={{ color: MUT }}>{totalLabel}</span>
          <span className="font-heading text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums" style={{ color: muted ? INK : EMBER }}>
            ${total.toLocaleString()}
          </span>
        </div>

        <div className="mt-4 text-center font-mono text-[11px]" style={{ color: MUT }}>{footer}</div>
        <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.22em]" style={{ color: DIM }}>
          <span>|| || |||| | |||| ||| | ||| || |||| || |||</span>
        </div>
      </div>

      {/* bottom deckle edge */}
      <svg aria-hidden className="block w-full" height="10" preserveAspectRatio="none" viewBox="0 0 100 10">
        <polygon points={Array.from({ length: 41 }).map((_, i) => `${i * 2.5},${i % 2 === 0 ? 0 : 10}`).join(" ") + " 100,0 0,0"} fill="white" />
      </svg>
    </div>
  );
}

/* ══════ CH · GUILT GAUGE (needle meter) ═══════════════════════ */
function ChGauge() {
  const { shape } = useShape();
  const dayHr = vendorHourly("daytona", shape.vcpu, shape.ram);
  const vpsHr = justavpsHourly(shape.vcpu, shape.ram, shape.storage);
  const dayPerSec = dayHr / 3600;
  const vpsPerSec = vpsHr / 3600;
  const { seconds, daytona, vps, saved } = useGuiltCounter(dayPerSec, vpsPerSec);
  const ratio = vpsHr / dayHr; // 0..1, closer to 0 = better
  // needle angle: -90deg (fully our side) to +90deg (fully Daytona side)
  const angle = -90 + ratio * 180;

  return (
    <section className="border-b py-24" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <div className="text-center">
          <Reveal><Kicker n="02" label="the gauge" /></Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 font-heading font-semibold leading-[1.08] tracking-[-0.025em]"
                style={{ fontSize: "clamp(30px, 4.6vw, 52px)", color: INK }}>
              Live meter. <span style={{ color: MUT }}>Where your bill points.</span>
            </h2>
          </Reveal>
        </div>

        <Reveal delay={160}>
          <div className="mx-auto mt-14 max-w-[680px]">
            <Gauge angle={angle} />
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                  accrued · daytona
                </div>
                <div className="mt-1 font-heading text-[18px] font-semibold tabular-nums sm:text-[22px]">
                  ${daytona.toFixed(6)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: EMBER }}>
                  accrued · us
                </div>
                <div className="mt-1 font-heading text-[18px] font-semibold tabular-nums sm:text-[22px]" style={{ color: EMBER }}>
                  ${vps.toFixed(6)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                  saved · so far
                </div>
                <div className="mt-1 font-heading text-[18px] font-semibold tabular-nums sm:text-[22px]">
                  ${saved.toFixed(6)}
                </div>
                <div className="mt-0.5 font-mono text-[10px]" style={{ color: DIM }}>in {seconds.toFixed(1)} s</div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Gauge({ angle }: { angle: number }) {
  // semicircular gauge from -90 to +90
  const W = 420, H = 240;
  const cx = W / 2, cy = H - 30;
  const r = 170;
  return (
    <div className="mx-auto" style={{ maxWidth: W }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* arc track */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={HAIR} strokeWidth="14" strokeLinecap="round" />
        {/* tick marks */}
        {Array.from({ length: 21 }).map((_, i) => {
          const t = -90 + (i / 20) * 180;
          const rad = (t * Math.PI) / 180;
          const inner = r - 12;
          const outer = r - 2;
          const major = i % 5 === 0;
          return (
            <line key={i}
              x1={cx + Math.sin(rad) * inner} y1={cy - Math.cos(rad) * inner}
              x2={cx + Math.sin(rad) * outer} y2={cy - Math.cos(rad) * outer}
              stroke={major ? INK : DIM} strokeWidth={major ? 1.5 : 0.8} opacity={major ? 0.9 : 0.5} />
          );
        })}
        {/* gradient zone — ember at left (good), dim at right (bad) */}
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={EMBER} />
            <stop offset="30%" stopColor={EMBER} stopOpacity="0.35" />
            <stop offset="70%" stopColor={INK} stopOpacity="0.2" />
            <stop offset="100%" stopColor={INK} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <path d={`M ${cx - r + 6} ${cy} A ${r - 6} ${r - 6} 0 0 1 ${cx + r - 6} ${cy}`} fill="none" stroke="url(#gauge-grad)" strokeWidth="6" strokeLinecap="round" opacity="0.75" />

        {/* labels */}
        <text x={cx - r + 6} y={cy + 22} fontSize="11" fontFamily="var(--font-mono, monospace)" fill={EMBER} textAnchor="start" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>us</text>
        <text x={cx + r - 6} y={cy + 22} fontSize="11" fontFamily="var(--font-mono, monospace)" fill={MUT} textAnchor="end" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>daytona</text>
        <text x={cx} y={cy - r - 6} fontSize="10" fontFamily="var(--font-mono, monospace)" fill={MUT} textAnchor="middle" style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}>per-second rate</text>

        {/* needle */}
        <g transform={`rotate(${angle}, ${cx}, ${cy})`} style={{ transition: "transform 800ms cubic-bezier(0.2,1.4,0.3,1)" }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 14} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <circle cx={cx} cy={cy - r + 14} r="3.5" fill={EMBER} />
        </g>
        <circle cx={cx} cy={cy} r="10" fill={INK} />
        <circle cx={cx} cy={cy} r="4" fill={PAPER} />
      </svg>
    </div>
  );
}

/* ══════ CH · CALCULATOR (persists shape) ══════════════════════ */
function ChCalculator({ onDeploy }: { onDeploy: () => void }) {
  const { shape, setShape } = useShape();
  const { vcpu, ram, storage } = shape;
  const setVcpu = (v: number) => setShape({ ...shape, vcpu: v });
  const setRam = (v: number) => setShape({ ...shape, ram: v });
  const setStorage = (v: number) => setShape({ ...shape, storage: v });

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
    <section id="calc" className="border-b py-24 lg:py-32" style={{ borderColor: HAIR, background: PAPER2 }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <div className="text-center">
          <Reveal><Kicker n="03" label="shape the box" /></Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 font-heading font-semibold leading-[1.08] tracking-[-0.025em]"
                style={{ fontSize: "clamp(30px, 4.6vw, 52px)", color: INK }}>
              Your shape. <span style={{ color: MUT }}>Your receipt rewrites itself.</span>
            </h2>
          </Reveal>
          <Reveal delay={140}>
            <p className="mx-auto mt-3 max-w-[540px] text-[14px]" style={{ color: MUT }}>
              Slide. Every number on the page above updates for your shape — the receipt, the gauge, everything.
            </p>
          </Reveal>
        </div>

        <Reveal delay={200}>
          <div className="mt-12 grid gap-4 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              <div className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: HAIR }}>
                <div className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>
                  <span>your workload</span>
                  <span style={{ color: EMBER }}>{fit.label.toLowerCase()}</span>
                </div>
                <div className="mt-5 space-y-6">
                  <SigSlider label="vCPU"    min={1}  max={16}   value={vcpu}    onChange={setVcpu}    unit="cores" />
                  <SigSlider label="memory"  min={1}  max={32}   value={ram}     onChange={setRam}     unit="GB" />
                  <SigSlider label="storage" min={20} max={1000} value={storage} onChange={setStorage} unit="GB" step={10} />
                </div>
              </div>
              <div className="rounded-2xl p-6 shadow-lg" style={{ background: INK, color: PAPER, boxShadow: `0 24px 50px -20px ${INK}66` }}>
                <div className="flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: DIM }}>
                  <span>just a vps · per-second</span>
                  <span style={{ color: EMBER }}>live</span>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-y py-3" style={{ borderColor: "rgba(250,250,247,0.15)" }}>
                  {[
                    ["sec", `$${(usHr / 3600).toFixed(7)}`],
                    ["hour", fmtHourly(usHr)],
                    ["24/7 mo", `$${usMo}`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[9.5px] uppercase tracking-[0.2em]" style={{ color: DIM }}>{k}</dt>
                      <dd className="mt-0.5 font-heading text-[17px] font-semibold leading-none tabular-nums sm:text-[19px]">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[12px] leading-[1.6]" style={{ color: "rgba(250,250,247,0.75)" }}>
                  Only the CPU-seconds, GB-hours of RAM, and GB of disk your agent actually uses.
                </p>
                <button onClick={onDeploy} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-full px-3 font-mono text-[12.5px] font-medium" style={{ background: EMBER, color: PAPER }}>
                  Deploy this box →
                </button>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
                <div className="grid grid-cols-[1.1fr_90px_110px_60px] items-center gap-3 border-b px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ borderColor: HAIR, color: MUT, background: PAPER2 }}>
                  <span>vendor — at 24/7</span>
                  <span className="text-right">$/hour</span>
                  <span className="text-right">$/month</span>
                  <span className="text-right">vs us</span>
                </div>
                {competitors.map((c) => (
                  <SigRow key={c.k} name={c.name} hr={c.hr} mo={c.mo} max={maxMo} usMo={Math.max(1, usMo)} />
                ))}
                <div style={{ borderTop: `2px solid ${INK}` }}>
                  <SigRow name="just a vps" hr={usHr} mo={usMo} max={maxMo} usMo={Math.max(1, usMo)} us />
                </div>
                <div className="px-5 py-3 text-center font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: MUT, background: PAPER2 }}>
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

function SigSlider({ label, min, max, step = 1, value, onChange, unit }: {
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
        <div className="absolute inset-y-[13px] left-0 right-0 rounded-full" style={{ background: HAIR }} />
        <div className="absolute inset-y-[13px] left-0 rounded-full" style={{ width: `${pct}%`, background: INK }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-[color:var(--i)]
            [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0
            [&::-moz-range-thumb]:ring-2 [&::-moz-range-thumb]:ring-[color:var(--i)]"
          style={{ ["--i" as string]: INK } as React.CSSProperties} />
      </div>
    </div>
  );
}

function SigRow({ name, hr, mo, max, usMo, us }: { name: string; hr: number; mo: number; max: number; usMo: number; us?: boolean }) {
  const pct = Math.max(6, (mo / max) * 100);
  const mult = us ? "1×" : `${Math.max(1, Math.round(mo / usMo))}×`;
  return (
    <div className="grid grid-cols-[1.1fr_90px_110px_60px] items-center gap-3 border-b px-5 py-3 last:border-b-0" style={{ borderColor: HAIR, background: us ? "rgba(224,78,27,0.06)" : "transparent" }}>
      <div className="flex items-baseline gap-2">
        <span className="font-heading text-[15px] font-semibold" style={{ color: us ? EMBER : INK }}>{name}</span>
        {us && <span className="font-mono text-[9.5px] uppercase tracking-[0.2em]" style={{ color: EMBER }}>per second</span>}
      </div>
      <div className="text-right font-mono tabular-nums text-[13px]" style={{ color: us ? EMBER : INK }}>{fmtHourly(hr)}</div>
      <div className="text-right font-heading text-[16px] font-semibold tabular-nums" style={{ color: us ? EMBER : INK }}>${mo.toLocaleString()}</div>
      <div className="flex items-center justify-end gap-2">
        <div className="hidden h-1 w-12 overflow-hidden rounded-full sm:block" style={{ background: HAIR }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: us ? EMBER : "#B8B6AC" }} />
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: us ? EMBER : MUT }}>{mult}</span>
      </div>
    </div>
  );
}

/* ══════ CH · SAME LINUX ═══════════════════════════════════════ */
function ChSameLinux() {
  const { shape } = useShape();
  const dayMo = vendorMonthly("daytona", shape.vcpu, shape.ram, 24);
  const vpsMo = justavpsMonthly(shape.vcpu, shape.ram, shape.storage);
  return (
    <section className="border-b py-24" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <div className="text-center">
          <Reveal><Kicker n="04" label="anatomy of the box" /></Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 font-heading font-semibold leading-[1.08] tracking-[-0.025em]" style={{ fontSize: "clamp(30px, 4.6vw, 52px)", color: INK }}>
              Same Linux. <span style={{ color: MUT }}>Different bill.</span>
            </h2>
          </Reveal>
        </div>
        <div className="relative mt-12 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <Reveal delay={140}><SpecCard label="Daytona" mo={dayMo} shape={shape} muted /></Reveal>
          <Reveal delay={200}>
            <div className="hidden items-center justify-center lg:flex">
              <div className="font-heading text-[56px] font-semibold leading-none" style={{ color: DIM }}>=</div>
            </div>
          </Reveal>
          <Reveal delay={260}><SpecCard label="just a vps" mo={vpsMo} shape={shape} accent /></Reveal>
        </div>
      </div>
    </section>
  );
}

function SpecCard({ label, mo, shape, accent, muted }: { label: string; mo: number; shape: Shape; accent?: boolean; muted?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: accent ? INK : HAIR }}>
      <div className="flex items-baseline justify-between px-6 pt-5">
        <div className="font-heading text-[18px] font-semibold" style={{ color: accent ? EMBER : INK }}>{label}</div>
      </div>
      <dl className="px-6 pt-4">
        {[
          ["kernel", "Linux 6.1"],
          ["arch", "x86_64"],
          ["vCPU", `${shape.vcpu} cores`],
          ["memory", `${shape.ram} GB`],
          ["disk", `${shape.storage} GB SSD`],
          ["uptime", "24 / 7"],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-2 items-baseline border-b py-2 text-[13.5px] last:border-b-0" style={{ borderColor: HAIR }}>
            <dt className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>{k}</dt>
            <dd className="font-mono tabular-nums" style={{ color: INK }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t px-6 py-5" style={{ borderColor: HAIR, background: accent ? "rgba(224,78,27,0.04)" : "transparent" }}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.22em]" style={{ color: MUT }}>monthly · 24/7</div>
        <div className="mt-1 font-heading text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[54px]"
             style={{ color: accent ? EMBER : INK, textDecoration: muted ? "line-through" : "none", textDecorationThickness: muted ? "2px" : undefined }}>
          ${mo.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

/* ══════ CH · HOW IT WORKS ═════════════════════════════════════ */
function ChHow() {
  return (
    <section id="how" className="border-b py-24" style={{ borderColor: HAIR, background: PAPER2 }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <div className="text-center">
          <Reveal><Kicker n="05" label="how is this even possible" /></Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 font-heading font-semibold leading-[1.08] tracking-[-0.025em]" style={{ fontSize: "clamp(30px, 4.6vw, 52px)", color: INK }}>
              No magic. <span style={{ color: MUT }}>Just the right stack.</span>
            </h2>
          </Reveal>
        </div>
        <Reveal delay={180}>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { n: "01", t: "We don't run microVMs.", b: "Dedicated VMs from Hetzner / OVH / Contabo. Same kernel as the sandboxes — without the microVM markup." },
              { n: "02", t: "We add what they have.", b: "Authenticated port proxy, SSH key fleet, snapshots, 1-click agent templates. The sandbox wrapper, without the 10×." },
              { n: "03", t: "We bill per-second.", b: "CPU-seconds, GB-hours of RAM, GB-hours of disk. Same invoice format. Different number at the bottom." },
            ].map((c) => (
              <div key={c.n} className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: HAIR }}>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: EMBER }}>step {c.n}</div>
                <h3 className="mt-3 font-heading text-[19px] font-semibold leading-[1.25]">{c.t}</h3>
                <p className="mt-3 text-[14px] leading-[1.65]" style={{ color: CHAR }}>{c.b}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════ CH · WHEN NOT ═════════════════════════════════════════ */
function ChWhenNot() {
  return (
    <section className="border-b py-20" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <div className="text-center">
          <Reveal><Kicker n="06" label="we are not for everyone" /></Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 font-heading font-semibold leading-[1.08] tracking-[-0.025em]" style={{ fontSize: "clamp(28px, 4.2vw, 44px)", color: INK }}>
              When you should <span style={{ color: EMBER }}>stick with sandboxes</span>.
            </h2>
          </Reveal>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal delay={140}>
            <div className="relative rounded-2xl border-2 bg-white p-6 shadow-sm" style={{ borderColor: INK }}>
              <span className="absolute -top-3 left-5 rounded-full bg-white px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: INK, border: `1px solid ${INK}` }}>use us</span>
              <h3 className="mt-1 flex items-center gap-2 font-heading text-[16px] font-semibold">
                <span className="inline-flex size-5 items-center justify-center rounded-full text-[11px] text-white" style={{ background: INK }}>✓</span>
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
              <ul className="mt-4 space-y-2.5 text-[14px] leading-[1.55]" style={{ color: CHAR }}>
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

/* ══════ CH · KORTIX ═══════════════════════════════════════════ */
function ChKortix() {
  return (
    <section className="border-b py-24" style={{ borderColor: HAIR, background: PAPER2 }}>
      <div className="mx-auto max-w-[1080px] px-6">
        <Reveal>
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: HAIR }}>
            <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
              <div className="relative aspect-[4/3] md:aspect-auto">
                <Image src="/team.png" alt="Kortix team" fill className="object-cover" />
              </div>
              <div className="flex flex-col justify-center gap-4 p-7 sm:p-10">
                <Kicker n="07" label="who built this" />
                <blockquote className="font-heading text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[32px]">
                  “We ran <span style={{ color: EMBER }}>3+ million sandboxes</span> on incumbent providers.
                  When the math stopped working, we built our own.”
                </blockquote>
                <div className="flex items-center gap-2.5">
                  <div className="font-mono text-[11.5px]" style={{ color: MUT }}>
                    — team behind{" "}
                    <a href="https://kortix.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-70" style={{ color: INK }}>Kortix</a>
                    {" "}· the Autonomous Company OS
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
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

/* ══════ CH · FAQ ══════════════════════════════════════════════ */
function ChFaq() {
  const items = [
    { q: "What if I hate it?", a: "Cancel anytime. No contracts. Your data is yours — download it and leave whenever." },
    { q: "Is it really cheaper, or is there a catch?", a: "No catch. Daytona / E2B / Modal charge ~$0.05/vCPU·h. We charge ~$0.005. Same model, different markup." },
    { q: "Why is it ~10× cheaper?", a: "We don't use microVMs. Dedicated VMs are an order of magnitude cheaper at the substrate, and we don't take the same margin sandbox vendors do on top." },
    { q: "What about cold-start?", a: "First boot is ~10 seconds. After that the machine is on — no per-request cold start. That's the point of a VPS." },
    { q: "Which agents can I run?", a: "Claude Code, Codex, OpenCode, PI Coding agents, Cursor workflows. Anything that runs on Linux." },
    { q: "How secure is it?", a: "SSH uses keys, not passwords. Every public port is gated by an authenticated proxy. API + session auth supported." },
  ];
  return (
    <section id="faq" className="border-b py-24" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[760px] px-6">
        <div className="text-center">
          <Reveal><Kicker n="08" label="the honest answers" /></Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 font-heading font-semibold leading-[1.08] tracking-[-0.025em]" style={{ fontSize: "clamp(28px, 4.2vw, 44px)", color: INK }}>
              Six objections. Answered.
            </h2>
          </Reveal>
        </div>
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
        <span className="font-mono text-[18px] leading-none" style={{ color: EMBER }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-[14px] leading-[1.65]" style={{ color: CHAR }}>{a}</div>
      )}
    </div>
  );
}

/* ══════ CH · DEPLOY ═══════════════════════════════════════════ */
function ChDeploy({ onDeploy }: { onDeploy: () => void }) {
  return (
    <section className="border-b py-32" style={{ borderColor: HAIR }}>
      <div className="mx-auto max-w-[1080px] px-6 text-center">
        <Reveal>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.28em]" style={{ color: MUT }}>
            rate.conf · line 1
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-3 font-heading font-semibold leading-[0.88] tracking-[-0.04em]"
               style={{ fontSize: "clamp(80px, 16vw, 200px)", color: INK }}>
            ${JUSTAVPS_RATES.vPerVcpu.toFixed(3)}
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div className="font-mono text-[12px] uppercase tracking-[0.28em]" style={{ color: MUT }}>per vCPU · per hour</div>
        </Reveal>
        <Reveal delay={300}>
          <button onClick={onDeploy} className="mt-12 inline-flex h-14 items-center gap-2 rounded-full px-8 text-[15px] font-medium text-white" style={{ background: INK, boxShadow: `0 16px 40px -16px ${INK}` }}>
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
          <a href="#receipt" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>receipt</a>
          <a href="#calc" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>pricing</a>
          <a href="#how" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>how</a>
          <a href="#faq" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>faq</a>
          <a href="/docs" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>docs</a>
          <a href="/login" className="hover:text-[color:var(--i)]" style={{ ["--i" as string]: INK }}>sign in</a>
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
      <button onClick={onDeploy} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-mono text-[12.5px] font-medium text-white" style={{ background: INK }}>
        DEPLOY →
      </button>
    </div>
  );
}
