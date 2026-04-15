"use client";

/* Interactive building blocks — self-contained, no deps beyond React. */

import { useEffect, useRef, useState } from "react";

/**
 * TypedText — types a string character by character.
 * `onDone` fires once the full text is revealed. `cursor` keeps a blinking bar at tail.
 */
export function TypedText({
  text,
  speed = 28,
  startDelay = 0,
  cursor = true,
  className,
  onDone,
}: {
  text: string;
  speed?: number;
  startDelay?: number;
  cursor?: boolean;
  className?: string;
  onDone?: () => void;
}) {
  const [i, setI] = useState(0);
  const doneRef = useRef(false);
  useEffect(() => {
    let t2: ReturnType<typeof setInterval> | undefined;
    const t1 = setTimeout(() => {
      t2 = setInterval(() => {
        setI((x) => {
          if (x + 1 >= text.length) {
            if (t2) clearInterval(t2);
            if (!doneRef.current && onDone) {
              doneRef.current = true;
              setTimeout(onDone, 0);
            }
            return text.length;
          }
          return x + 1;
        });
      }, speed);
    }, startDelay);
    return () => {
      clearTimeout(t1);
      if (t2) clearInterval(t2);
    };
  }, [text, speed, startDelay, onDone]);

  return (
    <span className={className}>
      {text.slice(0, i)}
      {cursor && <Cursor visible={i < text.length} />}
    </span>
  );
}

export function Cursor({ visible = true }: { visible?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.55em",
        height: "1em",
        background: "currentColor",
        verticalAlign: "-0.15em",
        marginLeft: "0.08em",
        opacity: visible ? 1 : 0,
        animation: visible ? "jv-blink 1s steps(1) infinite" : "none",
      }}
    />
  );
}

/**
 * Marquee — pure CSS infinite scroll. Renders children 3× for seamless loop.
 */
export function Marquee({
  children,
  duration = 40,
  className,
  reverse,
}: {
  children: React.ReactNode;
  duration?: number;
  className?: string;
  reverse?: boolean;
}) {
  return (
    <div className={`jv-marquee ${className ?? ""}`} style={{ ["--d" as string]: `${duration}s`, ["--dir" as string]: reverse ? "reverse" : "normal" }}>
      <div className="jv-marquee__track">
        <div className="jv-marquee__row">{children}</div>
        <div className="jv-marquee__row" aria-hidden>{children}</div>
        <div className="jv-marquee__row" aria-hidden>{children}</div>
      </div>
      <style>{`
        .jv-marquee { overflow: hidden; width: 100%; }
        .jv-marquee__track {
          display: flex; width: max-content;
          animation: jv-scroll var(--d) linear infinite;
          animation-direction: var(--dir);
        }
        .jv-marquee__row { display: flex; flex-shrink: 0; }
        @keyframes jv-scroll { from { transform: translateX(0); } to { transform: translateX(-33.333%); } }
        @keyframes jv-blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}

/**
 * BootClicker — press Enter (or click) to advance a staged boot log. When done, "BOX BOOTED."
 * Each press streams a new line character-by-character.
 */
export type BootStep = { t: string; line: string };

export function BootClicker({
  steps,
  onBoot,
  promptHint = "press ENTER or click",
}: {
  steps: BootStep[];
  onBoot?: () => void;
  promptHint?: string;
}) {
  const [idx, setIdx] = useState(0);         // next step to reveal
  const [typed, setTyped] = useState("");    // characters of currently-streaming line
  const [streaming, setStreaming] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const revealed = steps.slice(0, idx);

  const advance = () => {
    if (streaming || idx >= steps.length) return;
    setStreaming(true);
    const step = steps[idx];
    let j = 0;
    const iv = setInterval(() => {
      j++;
      setTyped(step.line.slice(0, j));
      if (j >= step.line.length) {
        clearInterval(iv);
        setIdx((x) => x + 1);
        setTyped("");
        setStreaming(false);
        if (idx + 1 >= steps.length && onBoot) onBoot();
      }
    }, 14);
  };

  const reset = () => {
    setIdx(0);
    setTyped("");
    setStreaming(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current) return;
      if (e.key === "Enter" || e.key === " ") {
        if (document.activeElement === rootRef.current || rootRef.current.contains(document.activeElement)) {
          e.preventDefault();
          advance();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, streaming]);

  const done = idx >= steps.length && !streaming;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onClick={advance}
      className="group cursor-pointer outline-none"
      role="button"
      aria-label="advance boot sequence"
    >
      <pre className="whitespace-pre-wrap text-[12.5px] leading-[1.9] sm:text-[13px]">
{revealed.map((s, k) => (
  <span key={k}>
    <span style={{ opacity: 0.5 }}>{s.t.padEnd(7)}</span>
    <span> {s.line}</span>{"\n"}
  </span>
))}
{streaming && (
  <span>
    <span style={{ opacity: 0.5 }}>{steps[idx].t.padEnd(7)}</span>
    <span> {typed}</span>
    <Cursor />
    {"\n"}
  </span>
)}
{!streaming && !done && (
  <span style={{ opacity: 0.6 }}>
    {"\n"}› <span className="underline decoration-dotted underline-offset-4 group-hover:opacity-100">{promptHint}</span> to advance →
  </span>
)}
{done && (
  <span>
    {"\n"}<span className="inline-block px-2 py-0.5" style={{ background: "currentColor", color: "#0A0A0A" }}>
      BOX · BOOTED · JUSTAVPS!
    </span>
    <br />
    <button
      onClick={(e) => { e.stopPropagation(); reset(); }}
      className="mt-2 underline decoration-dotted underline-offset-4 opacity-60 hover:opacity-100"
    >
      › do it again
    </button>
  </span>
)}
      </pre>
    </div>
  );
}

/**
 * AsciiSlider — an accessible range input rendered as a monospace track: [======●----]
 * Still a real <input type=range> underneath for a11y.
 */
export function AsciiSlider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  unit,
  width = 28,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  width?: number;
}) {
  const pct = (value - min) / (max - min);
  const filled = Math.round(pct * width);
  const track =
    "[" +
    "=".repeat(Math.max(0, filled - 1)) +
    (filled > 0 && filled < width ? "●" : filled === 0 ? "●" : "") +
    "-".repeat(Math.max(0, width - filled)) +
    "]";
  return (
    <label className="block cursor-pointer select-none">
      <div className="flex items-baseline justify-between text-[11.5px] uppercase tracking-[0.2em] opacity-70">
        <span>{label}</span>
        <span>
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="relative mt-1 font-mono text-[15px] leading-none">
        <div aria-hidden style={{ letterSpacing: "0.05em" }}>{track}</div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={label}
        />
      </div>
    </label>
  );
}

/**
 * AsciiBar — renders a value as a █░ bar of fixed width.
 */
export function AsciiBar({
  value,
  max,
  width = 18,
  fill = "█",
  empty = "░",
}: {
  value: number;
  max: number;
  width?: number;
  fill?: string;
  empty?: string;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(pct * width);
  return <span>{fill.repeat(filled)}{empty.repeat(Math.max(0, width - filled))}</span>;
}

/**
 * CountUp — animates a number from 0 → target when element enters viewport.
 */
export function CountUp({
  target,
  duration = 1200,
  prefix = "",
  suffix = "",
  className,
}: {
  target: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ref.current || started.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const t0 = performance.now();
            const tick = (now: number) => {
              const p = Math.min(1, (now - t0) / duration);
              const eased = 1 - Math.pow(1 - p, 3);
              setN(Math.round(eased * target));
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            io.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {n.toLocaleString()}
      {suffix}
    </span>
  );
}

/**
 * Reveal — fades content up as it enters the viewport. Subtle scroll choreography.
 */
export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setTimeout(() => setShown(true), delay);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        transform: shown ? "translateY(0)" : `translateY(${y}px)`,
        opacity: shown ? 1 : 0,
        transition: "transform 520ms cubic-bezier(0.2,0.7,0.1,1), opacity 520ms cubic-bezier(0.2,0.7,0.1,1)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * StrikePrice — counts up to `from` then strikes through, reveals `to` underneath.
 * Great for the sandbox→vps price moment.
 */
export function StrikePrice({
  from,
  to,
  duration = 1400,
  className,
}: {
  from: number;
  to: number;
  duration?: number;
  className?: string;
}) {
  const [phase, setPhase] = useState<"counting" | "struck" | "revealed">("counting");
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ref.current || started.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            setN(Math.round(eased * from));
            if (p < 1) requestAnimationFrame(tick);
            else {
              setTimeout(() => setPhase("struck"), 250);
              setTimeout(() => setPhase("revealed"), 650);
            }
          };
          requestAnimationFrame(tick);
          io.disconnect();
        }
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [from, duration]);

  return (
    <span ref={ref} className={className}>
      <span
        style={{
          textDecoration: phase !== "counting" ? "line-through" : "none",
          textDecorationThickness: "0.08em",
          opacity: phase === "revealed" ? 0.35 : 1,
          transition: "opacity 400ms ease",
        }}
      >
        ${n.toLocaleString()}
      </span>
      <span
        style={{
          display: "inline-block",
          marginLeft: phase === "revealed" ? "0.4em" : 0,
          maxWidth: phase === "revealed" ? "8em" : 0,
          opacity: phase === "revealed" ? 1 : 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          transition: "all 400ms cubic-bezier(0.2,0.7,0.1,1)",
        }}
      >
        → ${to.toLocaleString()}
      </span>
    </span>
  );
}

/**
 * LiveLog — streams new log lines into a scrollback window over time.
 * Keeps the last `maxLines` lines in view, fades older lines out.
 * `seedLines` render immediately; remaining `pool` feed in at `cadenceMs`.
 */
export function LiveLog({
  seedLines,
  pool,
  maxLines = 8,
  cadenceMs = 2400,
  className,
  style,
}: {
  seedLines: string[];
  pool: string[];
  maxLines?: number;
  cadenceMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [lines, setLines] = useState<{ id: number; t: string; text: string }[]>(() => {
    const now = new Date();
    return seedLines.map((text, i) => ({
      id: i,
      t: timeStamp(new Date(now.getTime() - (seedLines.length - i) * 60_000)),
      text,
    }));
  });
  const counter = useRef(seedLines.length);

  useEffect(() => {
    const iv = setInterval(() => {
      const text = pool[Math.floor(Math.random() * pool.length)];
      const id = counter.current++;
      const t = timeStamp(new Date());
      setLines((prev) => {
        const next = [...prev, { id, t, text }];
        return next.slice(Math.max(0, next.length - maxLines));
      });
    }, cadenceMs);
    return () => clearInterval(iv);
  }, [pool, cadenceMs, maxLines]);

  return (
    <pre
      className={className}
      style={{ fontVariantNumeric: "tabular-nums", ...style }}
    >
      {lines.map((l, i) => (
        <div
          key={l.id}
          style={{
            opacity: Math.max(0.35, (i + 1) / lines.length),
            transition: "opacity 500ms ease",
          }}
        >
          <span style={{ opacity: 0.55 }}>{l.t}</span>  {l.text}
        </div>
      ))}
    </pre>
  );
}
function timeStamp(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

/**
 * LiveCounter — takes an anchor number and drifts it upward slowly, like
 * something being observed rather than computed. Great for "agents online".
 */
export function LiveCounter({
  anchor,
  stepMin = 0,
  stepMax = 2,
  intervalMs = 3800,
  className,
}: {
  anchor: number;
  stepMin?: number;
  stepMax?: number;
  intervalMs?: number;
  className?: string;
}) {
  const [n, setN] = useState(anchor);
  useEffect(() => {
    const iv = setInterval(() => {
      setN((x) => x + stepMin + Math.floor(Math.random() * (stepMax - stepMin + 1)));
    }, intervalMs);
    return () => clearInterval(iv);
  }, [stepMin, stepMax, intervalMs]);
  return <span className={className}>{n.toLocaleString()}</span>;
}

/**
 * FeatureDemo — rotating "command / response" showcase.
 * Tabs across features; active tab shows a terminal-style command + output pair.
 * Auto-advances every `rotateMs` unless the user interacts, then stops rotating.
 */
export type FeatureDemoItem = {
  key: string;
  label: string;
  command: string;
  output: string;
};
export function FeatureDemo({
  items,
  rotateMs = 4200,
  theme,
}: {
  items: FeatureDemoItem[];
  rotateMs?: number;
  theme: {
    bg: string;
    surface: string;
    fg: string;
    dim: string;
    accent: string;
    hair: string;
  };
}) {
  const [active, setActive] = useState(items[0].key);
  const [manual, setManual] = useState(false);
  const activeItem = items.find((i) => i.key === active) ?? items[0];

  useEffect(() => {
    if (manual) return;
    const iv = setInterval(() => {
      setActive((cur) => {
        const idx = items.findIndex((i) => i.key === cur);
        return items[(idx + 1) % items.length].key;
      });
    }, rotateMs);
    return () => clearInterval(iv);
  }, [items, rotateMs, manual]);

  const onPick = (k: string) => {
    setManual(true);
    setActive(k);
  };

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: theme.hair, background: theme.surface }}
    >
      {/* tab bar */}
      <div
        className="flex flex-wrap items-center gap-1 border-b p-2"
        style={{ borderColor: theme.hair, background: theme.bg }}
      >
        {items.map((i) => {
          const isActive = i.key === active;
          return (
            <button
              key={i.key}
              onClick={() => onPick(i.key)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors"
              style={{
                background: isActive ? theme.accent : "transparent",
                color: isActive ? theme.bg : theme.dim,
              }}
            >
              {isActive && <span className="inline-block size-[5px] rounded-full" style={{ background: theme.bg }} />}
              {i.label}
            </button>
          );
        })}
        <span className="ml-auto hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] sm:inline-flex" style={{ color: theme.dim }}>
          {manual ? "paused · click ↑" : "auto-rotating"}
        </span>
      </div>
      {/* terminal body */}
      <div className="px-5 pb-5 pt-4 font-mono text-[12.5px] leading-[1.85]" style={{ color: theme.fg, minHeight: 200 }}>
        <div style={{ color: theme.dim }}>
          <span style={{ color: theme.accent }}>$</span>{" "}
          <TypedText key={activeItem.key + "-cmd"} text={activeItem.command} speed={18} cursor={false} />
        </div>
        <pre
          key={activeItem.key + "-out"}
          className="whitespace-pre-wrap"
          style={{
            animation: "jv-fade-in 360ms ease both",
            animationDelay: `${Math.min(400, activeItem.command.length * 18)}ms`,
          }}
        >
          {activeItem.output}
        </pre>
        <style>{`@keyframes jv-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      </div>
    </div>
  );
}

/**
 * BigNumberReveal — counts up to a precise number with optional decimals.
 * Used for the cinematic hero "$0.005" reveal.
 */
export function BigNumberReveal({
  target,
  decimals = 3,
  prefix = "",
  suffix = "",
  duration = 1600,
  className,
}: {
  target: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const [v, setV] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!ref.current || started.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 4);
            setV(eased * target);
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          io.disconnect();
        }
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [target, duration]);
  return (
    <span ref={ref} className={className}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/**
 * GuiltCounter — live ticking counter. Increments since component-mount,
 * computing how much would have accrued at competitor vs vps rate.
 * Returns { seconds, daytonaCents, vpsCents } so the consumer renders.
 */
export function useGuiltCounter(
  daytonaPerSec: number,
  vpsPerSec: number,
): { seconds: number; daytona: number; vps: number; saved: number } {
  const [seconds, setSeconds] = useState(0);
  const t0Ref = useRef<number | null>(null);
  useEffect(() => {
    t0Ref.current = performance.now();
    let raf: number;
    const tick = () => {
      if (t0Ref.current != null) {
        setSeconds((performance.now() - t0Ref.current) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return {
    seconds,
    daytona: daytonaPerSec * seconds,
    vps: vpsPerSec * seconds,
    saved: (daytonaPerSec - vpsPerSec) * seconds,
  };
}

/**
 * ChantCounter — listens for "j" / "J" keypresses and increments. Shows the running tally.
 * Also increments automatically every N seconds (the internet is chanting).
 */
export function useJustAvpsChant(seedBase = 1247): number {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    // deterministic-ish seed that changes hourly
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const seeded = seedBase + (hourBucket % 733);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration seed
    setN(seeded);
    const autoTick = setInterval(() => setN((x) => (x == null ? x : x + Math.floor(1 + Math.random() * 2))), 4200);
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "j") setN((x) => (x == null ? x : x + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(autoTick);
      window.removeEventListener("keydown", onKey);
    };
  }, [seedBase]);
  return n ?? seedBase;
}
