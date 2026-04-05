import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────
 * IconTile
 *
 * Premium 3D-feeling icon container used across the landing
 * (Infrastructure cards, API group headers, etc).
 *
 * The dimensional look comes from three stacked effects:
 *  1. A vertical gradient fill (lighter top → darker bottom) —
 *     simulates a light source from above.
 *  2. A thin horizontal highlight line across the top edge
 *     (`before:` pseudo) — catches the "light" on the bezel.
 *  3. A soft `shadow-sm` outer shadow — lifts the tile off
 *     the surface it sits on.
 *
 * Uses theme tokens (`foreground/X`, `border`) so it inverts
 * cleanly between dark and light mode — the gradient becomes
 * a dark→transparent wash on white backgrounds, a white→
 * transparent wash on black.
 * ──────────────────────────────────────────────────────────── */

const SIZE_MAP = {
  sm: "size-9 rounded-lg [&_svg]:size-4",
  md: "size-11 rounded-xl [&_svg]:size-5",
  lg: "size-14 rounded-[14px] [&_svg]:size-6",
} as const;

export function IconTile({
  children,
  className,
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: keyof typeof SIZE_MAP;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center shrink-0 overflow-hidden",
        // Gradient fill — top catches "light", bottom recedes
        "bg-gradient-to-b from-foreground/[0.08] via-foreground/[0.03] to-transparent",
        // Outer definition
        "border border-border/80 shadow-sm",
        // Icon color
        "text-foreground/75",
        // Top highlight line (bezel) via pseudo-element
        "before:absolute before:inset-x-1.5 before:top-0 before:h-px",
        "before:bg-gradient-to-r before:from-transparent before:via-foreground/25 before:to-transparent",
        SIZE_MAP[size],
        className,
      )}
    >
      {children}
    </div>
  );
}
