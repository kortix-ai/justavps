"use client";

import { cn, regionDisplay } from "@/lib/utils";
import { Check, Zap, Star, Rocket, Crown } from "lucide-react";
import type { Region, ServerType } from "@/lib/types";

/* ═══ Shared plan constants — single source of truth ═══ */

const PLAN_META = [
  { label: "Starter",  Icon: Zap,    tagline: "Side projects & light agents",         anchor: 121 },
  { label: "Pro",      Icon: Star,   tagline: "Most popular — fits 90% of workloads", anchor: 242 },
  { label: "Power",    Icon: Rocket, tagline: "Heavy agents & parallel tasks",         anchor: 483 },
  { label: "Ultra",    Icon: Crown,  tagline: "Maximum performance, zero bottlenecks", anchor: 966 },
] as const;

export const INCLUDED_FEATURES = [
  "SSH access", "Browser IDE", "Web terminal", "Auth proxy",
  "Daily backups", "Docker", "Claude Code / OpenCode", "sandbox-agent SDK",
];

export type BillingInterval = "monthly" | "yearly" | "2year";

const INTERVAL_DISCOUNT: Record<BillingInterval, number> = {
  monthly: 0,
  yearly: 0.20,   // 20% off
  "2year": 0.30,  // 30% off — best deal
};

const INTERVAL_MONTHS: Record<BillingInterval, number> = {
  monthly: 1,
  yearly: 12,
  "2year": 24,
};

/** Compute effective monthly price based on billing interval */
export function effectiveMonthlyPrice(priceMonthly: number, interval: BillingInterval): number {
  const discount = INTERVAL_DISCOUNT[interval];
  if (discount === 0) return priceMonthly;
  return Math.round(priceMonthly * (1 - discount) * 100) / 100;
}

/** Compute total price for the full billing period */
export function totalPrice(priceMonthly: number, interval: BillingInterval): number {
  return Math.round(effectiveMonthlyPrice(priceMonthly, interval) * INTERVAL_MONTHS[interval] * 100) / 100;
}

/** Human-readable billing label */
export function intervalLabel(interval: BillingInterval): string {
  if (interval === "yearly") return "yr";
  if (interval === "2year") return "2yr";
  return "mo";
}

/* ═══ BillingToggle component ═══ */

interface BillingToggleProps {
  interval: BillingInterval;
  onChange: (interval: BillingInterval) => void;
}

export function BillingToggle({ interval, onChange }: BillingToggleProps) {
  const options: { value: BillingInterval; label: string; badge?: string }[] = [
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly", badge: "20% off" },
    { value: "2year", label: "2 Year", badge: "30% off" },
  ];

  return (
    <div className="inline-flex items-center rounded-xl border border-border bg-muted/30 p-1 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all",
            interval === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
          {opt.badge && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
              interval === opt.value
                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                : "bg-green-500/10 text-green-600/70 dark:text-green-400/70"
            )}>
              {opt.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ═══ PlanPicker component ═══ */

interface PlanPickerProps {
  regions?: Region[];
  serverTypes?: ServerType[];
  selectedRegion: string;
  selectedServerType: string;
  onRegionChange: (region: string) => void;
  onServerTypeChange: (serverType: string) => void;
  showIncluded?: boolean;
  billingInterval?: BillingInterval;
  onBillingIntervalChange?: (interval: BillingInterval) => void;
  showBillingToggle?: boolean;
}

export function PlanPicker({
  regions,
  serverTypes,
  selectedRegion,
  selectedServerType,
  onRegionChange,
  onServerTypeChange,
  showIncluded = true,
  billingInterval = "monthly",
  onBillingIntervalChange,
  showBillingToggle = false,
}: PlanPickerProps) {
  const isDiscounted = billingInterval !== "monthly";

  return (
    <div className="space-y-5">
      {/* Billing interval toggle */}
      {showBillingToggle && onBillingIntervalChange && (
        <div className="flex justify-center">
          <BillingToggle interval={billingInterval} onChange={onBillingIntervalChange} />
        </div>
      )}

      {/* Region picker */}
      {regions && regions.length > 1 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Region</p>
          <div className="flex gap-2">
            {regions.map((r) => {
              const active = selectedRegion === r.id;
              const rm = regionDisplay(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => onRegionChange(r.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  )}
                >
                  <span>{rm.flag}</span>
                  {rm.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Plan cards — anchored pricing with competitor comparison */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Plan</p>
        <div className="space-y-2">
          {(serverTypes ?? []).map((s, idx) => {
            const meta = PLAN_META[idx] ?? { label: s.name, Icon: Zap, tagline: "", anchor: 0 };
            const { label, Icon, tagline, anchor } = meta;
            const isPopular = idx === 1;
            const active = selectedServerType === s.name;
            const displayMonthly = effectiveMonthlyPrice(s.price_monthly, billingInterval);
            const total = totalPrice(s.price_monthly, billingInterval);
            const savingsPercent = anchor > 0 ? Math.round((1 - displayMonthly / anchor) * 100) : 0;

            return (
              <button
                key={s.name}
                onClick={() => onServerTypeChange(s.name)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all relative",
                  active
                    ? "border-foreground bg-card"
                    : "border-border hover:border-foreground/50",
                  isPopular && !active && "border-primary/40"
                )}
              >
                {/* Popular badge — social proof */}
                {isPopular && (
                  <span className="absolute -top-2 right-4 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold">
                    MOST POPULAR
                  </span>
                )}

                {/* Radio */}
                <div className={cn(
                  "size-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                  active ? "border-foreground bg-foreground" : "border-border"
                )}>
                  {active && <Check className="size-3 text-background" />}
                </div>

                {/* Icon */}
                <div className={cn(
                  "size-10 rounded-xl flex items-center justify-center shrink-0",
                  active ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                )}>
                  <Icon className="size-4" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    <span>{s.vcpu} vCPU</span>
                    <span className="text-border">&middot;</span>
                    <span>{s.ram_gb} GB RAM</span>
                    <span className="text-border">&middot;</span>
                    <span>{s.disk_gb} GB SSD</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">{tagline}</p>
                </div>

                {/* Price — anchored with competitor strikethrough */}
                <div className="text-right shrink-0">
                  {anchor > 0 && (
                    <div className="text-[10px] text-muted-foreground/50 line-through">${anchor}/mo elsewhere</div>
                  )}
                  <div className="flex items-baseline gap-0.5 justify-end">
                    {isDiscounted && (
                      <span className="text-[11px] text-muted-foreground/50 line-through mr-1">${s.price_monthly}</span>
                    )}
                    <span className="text-lg font-semibold">${displayMonthly}</span>
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    {savingsPercent > 0 && (
                      <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
                        Save {savingsPercent}%
                      </span>
                    )}
                  </div>
                  {isDiscounted && (
                    <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                      ${total}/{intervalLabel(billingInterval)} total
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Included features — value stack */}
      {showIncluded && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">Included with every plan</p>
          <div className="flex flex-wrap gap-1.5">
            {INCLUDED_FEATURES.map((item) => (
              <span key={item} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-xs text-muted-foreground">
                <Check className="size-3 text-green-600 dark:text-green-400" />
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
