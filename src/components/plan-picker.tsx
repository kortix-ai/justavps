"use client";

import { cn } from "@/lib/utils";
import { Check, Zap, Star, Rocket, Crown } from "lucide-react";
import type { Region, ServerType } from "@/lib/types";

/* ═══ Shared plan constants — single source of truth ═══ */

const PLAN_META = [
  { label: "Starter", Icon: Zap,    tagline: "Light workloads" },
  { label: "Pro",     Icon: Star,   tagline: "Most workloads" },
  { label: "Power",   Icon: Rocket, tagline: "Heavy & parallel" },
  { label: "Ultra",   Icon: Crown,  tagline: "Maximum performance" },
] as const;

export const REGION_MAP: Record<string, { flag: string; label: string }> = {
  hel1: { flag: "\u{1F1EA}\u{1F1FA}", label: "Europe" },
  fsn1: { flag: "\u{1F1EA}\u{1F1FA}", label: "Europe" },
  nbg1: { flag: "\u{1F1EA}\u{1F1FA}", label: "Europe" },
  hil:  { flag: "\u{1F1FA}\u{1F1F8}", label: "USA" },
  ash:  { flag: "\u{1F1FA}\u{1F1F8}", label: "USA" },
};

export const INCLUDED_FEATURES = [
  "SSH access", "Browser IDE", "Web terminal", "Auth proxy",
  "Daily backups", "Docker", "Claude Code / OpenCode", "sandbox-agent SDK",
];

/* ═══ PlanPicker component ═══ */

interface PlanPickerProps {
  regions?: Region[];
  serverTypes?: ServerType[];
  selectedRegion: string;
  selectedServerType: string;
  onRegionChange: (region: string) => void;
  onServerTypeChange: (serverType: string) => void;
  showIncluded?: boolean;
}

export function PlanPicker({
  regions,
  serverTypes,
  selectedRegion,
  selectedServerType,
  onRegionChange,
  onServerTypeChange,
  showIncluded = true,
}: PlanPickerProps) {
  return (
    <div className="space-y-6">
      {/* Region picker */}
      {regions && regions.length > 1 && (
        <div className="flex gap-2">
          {regions.map((r) => {
            const active = selectedRegion === r.id;
            const rm = REGION_MAP[r.id];
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
                <span>{rm?.flag ?? "\u{1F30D}"}</span>
                {rm?.label ?? r.city}
              </button>
            );
          })}
        </div>
      )}

      {/* Plan cards */}
      <div className="space-y-2">
        {(serverTypes ?? []).map((s, idx) => {
          const meta = PLAN_META[idx] ?? { label: s.name, Icon: Zap, tagline: "" };
          const { label, Icon, tagline } = meta;
          const isPopular = idx === 1;
          const active = selectedServerType === s.name;

          return (
            <button
              key={s.name}
              onClick={() => onServerTypeChange(s.name)}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                active ? "border-foreground bg-card" : "border-border hover:border-foreground/50"
              )}
            >
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
                  {isPopular && (
                    <span className="px-1.5 py-0.5 rounded bg-foreground text-background text-[9px] font-medium leading-none">
                      POPULAR
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground whitespace-nowrap">
                  <span>{s.vcpu} vCPU</span>
                  <span className="text-border">&middot;</span>
                  <span>{s.ram_gb} GB RAM</span>
                  <span className="text-border">&middot;</span>
                  <span>{s.disk_gb} GB SSD</span>
                  {tagline && (
                    <>
                      <span className="text-border">&middot;</span>
                      <span>{tagline}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Price */}
              <div className="text-right shrink-0">
                <span className="text-lg font-medium">${s.price_monthly}</span>
                <span className="text-xs text-muted-foreground">/mo</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Included features */}
      {showIncluded && (
        <div className="flex flex-wrap gap-1.5">
          {INCLUDED_FEATURES.map((item) => (
            <span key={item} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-xs text-muted-foreground">
              <Check className="size-3 text-green-600 dark:text-green-400" />
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
