"use client";

import { useEffect, useState } from "react";

export type VariantId = "ascii" | "blueprint" | "live" | "signature";

export const VARIANTS: {
  id: VariantId;
  num: string;
  name: string;
  sub: string;
  swatch: [string, string, string];
}[] = [
  { id: "ascii",     num: "01", name: "ASCII",     sub: "README · b&w terminal",     swatch: ["#0A0A0A", "#F4F1EB", "#8A8A8A"] },
  { id: "blueprint", num: "02", name: "Blueprint", sub: "cobalt · schematic",        swatch: ["#F2F4F8", "#0B1220", "#2E5AFF"] },
  { id: "live",      num: "03", name: "Live",      sub: "ink · bone · ember",        swatch: ["#0A0A0B", "#F0ECE0", "#E04E1B"] },
  { id: "signature", num: "04", name: "Signature", sub: "paper · receipt · gauge",   swatch: ["#FAFAF7", "#0A0A0B", "#E04E1B"] },
];

const KEY = "justavps.landing.variant";

export function useVariant(): [VariantId, (v: VariantId) => void] {
  const [variant, setVariant] = useState<VariantId>("live");

  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("v");
    const stored = window.localStorage.getItem(KEY) as VariantId | null;
    const candidate = (q || stored || "live") as VariantId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration read
    if (VARIANTS.find((x) => x.id === candidate)) setVariant(candidate);
  }, []);

  const update = (v: VariantId) => {
    setVariant(v);
    try {
      window.localStorage.setItem(KEY, v);
      const url = new URL(window.location.href);
      url.searchParams.set("v", v);
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  return [variant, update];
}

export function DebugSwitcher({
  variant,
  onChange,
}: {
  variant: VariantId;
  onChange: (v: VariantId) => void;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "d" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setHidden((h) => !h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="fixed left-3 top-3 z-[100] rounded-md bg-black/85 px-2 py-1 font-mono text-[10px] text-white/70 backdrop-blur hover:text-white"
      >
        debug ▾
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-white/10 bg-[#07070A]/92 text-white backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1480px] items-center gap-3 px-4 py-2.5">
        <span className="hidden items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.22em] text-white/50 sm:inline-flex">
          <span className="inline-block size-[5px] animate-pulse rounded-full bg-emerald-400" />
          brand playground · JUSTAVPS!
        </span>
        <span className="hidden h-4 w-px bg-white/10 sm:block" />

        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              onClick={() => onChange(v.id)}
              className={`group flex shrink-0 items-center gap-2.5 rounded-md border px-2.5 py-1.5 transition-all ${
                variant === v.id
                  ? "border-white/30 bg-white/[0.08] text-white"
                  : "border-transparent text-white/55 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/90"
              }`}
            >
              <Swatches colors={v.swatch} />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
                {v.num} {v.name}
              </span>
              <span className="hidden font-mono text-[10px] text-white/40 md:inline">{v.sub}</span>
            </button>
          ))}
        </div>

        <span className="hidden font-mono text-[10px] text-white/30 md:inline">
          ⌘⇧D to hide · ?v=&hellip; · tap J anywhere to chant
        </span>
        <button
          onClick={() => setHidden(true)}
          className="rounded-md p-1 font-mono text-[11px] text-white/50 hover:bg-white/5 hover:text-white"
          aria-label="hide debug bar"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function Swatches({ colors }: { colors: [string, string, string] }) {
  return (
    <span className="flex items-center gap-[2px]">
      {colors.map((c, i) => (
        <span
          key={i}
          className="block size-2.5 rounded-[2px] ring-1 ring-black/20"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}
