"use client";

import { cn } from "@/shared/lib/utils";
import { Check } from "lucide-react";
import type { ServerType } from "@/shared/lib/types";

/* ═══ Plan tier labels ═══ */

const PLAN_LABELS: string[] = [
  "Starter",
  "Basic",
  "Pro",
  "Power",
  "Ultra",
];

const RECOMMENDED_IDX = 1;

/* ═══ Shared PlanList ═══ */

interface PlanListProps {
  plans: ServerType[];
  /** Currently selected server type name */
  selected: string;
  /** Called when user picks a plan */
  onSelect: (name: string) => void;
  /** Index of the current plan (for rescale — plans at or below are disabled) */
  currentIndex?: number;
  /** Show "Popular" badge on the recommended plan (checkout flow) */
  showPopular?: boolean;
  /** Show "CURRENT" badge on the current plan (rescale flow) */
  showCurrent?: boolean;
  /** Disable all interaction (e.g. machine not running) */
  disabled?: boolean;
}

export function PlanList({
  plans,
  selected,
  onSelect,
  currentIndex = -1,
  showPopular = false,
  showCurrent = false,
  disabled = false,
}: PlanListProps) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {plans.map((plan, idx) => {
        const label = PLAN_LABELS[idx] ?? plan.name;
        const isActive = selected === plan.name;
        const isCurrent = showCurrent && idx === currentIndex;
        const isBelow = currentIndex >= 0 && idx < currentIndex;
        const isDisabled = disabled || isCurrent || isBelow;
        const isPopular = showPopular && idx === RECOMMENDED_IDX;

        return (
          <button
            key={plan.name}
            disabled={isDisabled}
            onClick={() => !isDisabled && onSelect(plan.name)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 text-left transition-all",
              "border-b border-border last:border-b-0",
              isActive && !isCurrent
                ? "bg-foreground/[0.04]"
                : isCurrent
                  ? "bg-primary/[0.03]"
                  : isBelow
                    ? "opacity-30 cursor-not-allowed"
                    : disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-muted/40",
              isPopular && !isActive && !isCurrent && "bg-primary/[0.02]",
            )}
          >
            {/* Radio */}
            <div className={cn(
              "size-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
              isActive
                ? "border-foreground bg-foreground"
                : isCurrent
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/25",
            )}>
              {(isActive || isCurrent) && <Check className="size-2.5 text-background" />}
            </div>

            {/* Name + specs */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[13px] font-medium",
                  isDisabled && !isCurrent ? "text-muted-foreground" : "text-foreground",
                )}>
                  {label}
                </span>
                {isCurrent && (
                  <span className="px-1.5 py-px rounded text-[9px] font-semibold leading-tight bg-primary/10 text-primary border border-primary/20 uppercase tracking-wide">
                    Current
                  </span>
                )}
                {isPopular && !isCurrent && (
                  <span className="px-1.5 py-px rounded text-[9px] font-semibold leading-tight bg-primary/10 text-primary uppercase tracking-wide">
                    Popular
                  </span>
                )}
                {isBelow && !isCurrent && (
                  <span className="text-[10px] text-muted-foreground/50">no downgrade</span>
                )}
              </div>
              <p className={cn(
                "text-[11px] mt-px",
                isDisabled && !isCurrent ? "text-muted-foreground/60" : "text-muted-foreground",
              )}>
                {plan.vcpu} vCPU · {plan.ram_gb} GB RAM · {plan.disk_gb} GB SSD
              </p>
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-px shrink-0">
              <span className={cn(
                "text-sm font-semibold tabular-nums",
                isDisabled && !isCurrent ? "text-muted-foreground" : "text-foreground",
              )}>
                ${plan.price_monthly}
              </span>
              <span className="text-[10px] text-muted-foreground">/mo</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
