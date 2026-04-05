/* ────────────────────────────────────────────────────────────
 * Hero inline glyphs — static SVG, no glow, no animation.
 * ──────────────────────────────────────────────────────────── */

import { AlarmClockIcon, InfinityIcon } from "lucide-react";

export function InfinityGlyph() {
  return (
    <span className="inline-block align-middle mx-1 sm:mx-2">
      <InfinityIcon className="size-[0.85em] text-brand" />
    </span>
  );
}

export function PowerGlyph() {
  return (
    <span className="inline-block align-middle mx-1 sm:mx-1.5">
      <AlarmClockIcon
        className="size-[0.85em] text-brand"
        style={{
          filter:
            "drop-shadow(0 0 10px rgba(251,191,36,0.7)) drop-shadow(0 0 22px rgba(245,158,11,0.4))",
        }}
      />
    </span>
  );
}

export function JustavpsMark() {
  return (
    <span className="relative inline-block text-foreground font-semibold italic">
      justavps
      <span
        aria-hidden
        className="pointer-events-none absolute left-[0.05em] right-[0.05em] -bottom-[0.08em] h-[0.06em] rounded-full bg-gradient-to-r from-amber-400/0 via-amber-400 to-amber-400/0"
        style={{
          boxShadow:
            "0 0 14px rgba(251,191,36,0.9), 0 0 28px rgba(245,158,11,0.5)",
        }}
      />
    </span>
  );
}

export function StrokeInfinityGlyph({
  size = 1.1,
  step = 0.35,
  layers = 3,
  strokeWidth = 0.5,
  className = "mx-1 sm:mx-2",
}: {
  size?: number;
  step?: number;
  layers?: number;
  strokeWidth?: number;
  className?: string;
} = {}) {
  const maxSize = size + (layers - 1) * step;

  return (
    <span
      className={`relative inline-block align-middle ${className}`}
      style={{ width: `${maxSize}em`, height: `${maxSize}em` }}
    >
      {Array.from({ length: layers }, (_, i) => {
        const layerSize = size + i * step;
        return (
          <InfinityIcon
            key={i}
            strokeWidth={strokeWidth}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-brand"
            style={{
              width: `${layerSize}em`,
              height: `${layerSize}em`,
            }}
          />
        );
      })}
    </span>
  );
}