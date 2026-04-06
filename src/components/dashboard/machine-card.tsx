"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Globe, Cpu, HardDrive, DollarSign, Clock, Shield, CalendarX2 } from "lucide-react";
import { cn, regionDisplay, planName, planSpecs, timeAgo } from "@/lib/utils";
import type { Machine } from "@/lib/types";

const statusConfig = {
  provisioning: {
    label: "Provisioning",
    dotClass: "bg-yellow-500 animate-pulse",
    badgeClass: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  },
  ready: {
    label: "Running",
    dotClass: "bg-emerald-500",
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  error: {
    label: "Error",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  stopped: {
    label: "Stopped",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
};

interface MachineCardProps {
  machine: Machine;
}

export function MachineCard({ machine }: MachineCardProps) {
  const status =
    statusConfig[machine.status as keyof typeof statusConfig] ||
    statusConfig.stopped;
  const specs = planSpecs(machine.server_type);
  const machineHref = machine.api_version === 'v2' ? `/v2/machines/${machine.id}` : `/machines/${machine.id}`;
  const versionLabel = machine.api_version === 'v2' ? 'V2' : 'V1';

  return (
    <div className="group rounded-xl border bg-card transition-all duration-200 hover:border-foreground/20 hover:shadow-md hover:shadow-black/[0.04] dark:hover:shadow-black/20">
      <Link
        href={machineHref}
        className={cn(
          "block",
          machine.status === "error" && "border-red-500/20",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-semibold truncate leading-snug">
                {machine.name || machine.slug}
              </h3>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-semibold tracking-wide shrink-0">
                {versionLabel}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
              {machine.slug}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 text-[11px] font-medium h-5 px-2",
                status.badgeClass,
              )}
            >
              <span className={cn("size-1.5 rounded-full shrink-0", status.dotClass)} />
              {status.label}
            </Badge>
            {machine.subscription?.cancel_at_period_end && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] font-medium h-5 px-1.5 bg-destructive/10 text-destructive border-destructive/20"
              >
                <CalendarX2 className="size-2.5" />
                Cancelling
              </Badge>
            )}
          </div>
        </div>

        {/* Specs */}
        <div className="px-4 pb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Cpu className="size-3 shrink-0" />
            <span>{planName(machine.server_type)}{specs ? ` · ${specs.vcpu} vCPU` : ""}</span>
          </span>
          {specs && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HardDrive className="size-3 shrink-0" />
              <span>{specs.memory} GB · {specs.disk} GB SSD</span>
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="size-3 shrink-0" />
            <span>{regionDisplay(machine.region).label}</span>
          </span>
        </div>
      </Link>

      {/* Footer — outside <Link> so delete button doesn't navigate */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/60">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {timeAgo(machine.created_at)}
          </span>
          {machine.backups_enabled && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Shield className="size-2.5" />
              Backups
            </span>
          )}
        </div>
        {machine.price_monthly ? (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <DollarSign className="size-3" />
            <span className="font-semibold text-foreground tabular-nums">{machine.price_monthly}</span>
            <span>/mo</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
