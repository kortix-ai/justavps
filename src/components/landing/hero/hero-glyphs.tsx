/* ────────────────────────────────────────────────────────────
 * Hero inline glyphs — static SVG, no glow, no animation.
 * ──────────────────────────────────────────────────────────── */

import { AlarmClockIcon, InfinityIcon } from "lucide-react";

const STROKE = "rgb(110 231 183)"; // emerald-300

export function InfinityGlyph() {
  return (
    <span className="inline-block align-middle mx-1 sm:mx-2">
      <InfinityIcon className="size-[0.85em] text-emerald-500" />
    </span>
  );
}

export function PowerGlyph() {
  return (
    <span className="inline-block align-middle mx-1 sm:mx-1.5">
      <AlarmClockIcon className="size-[0.85em] text-emerald-500" />
    </span>
  );
}

export function JustavpsMark() {
  return (
    <span className="relative inline-block text-foreground font-semibold italic">
      justavps
      <span
        aria-hidden
        className="pointer-events-none absolute left-[0.05em] right-[0.05em] -bottom-[0.08em] h-[0.06em] rounded-full bg-gradient-to-r from-emerald-400/0 via-emerald-300 to-emerald-400/0"
        style={{
          boxShadow:
            "0 0 14px rgba(52,211,153,0.9), 0 0 28px rgba(16,185,129,0.5)",
        }}
      />
    </span>
  );
}
