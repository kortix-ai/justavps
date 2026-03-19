"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Trash2,
  Shield,
  Globe,
  Cpu,
  ChevronRight,
  Activity,
} from "lucide-react";
import { cn, regionDisplay, planName } from "@/lib/utils";
import type { Machine } from "@/lib/types";

const statusConfig = {
  provisioning: {
    label: "Provisioning",
    dotClass: "bg-yellow-500 animate-pulse",
    badgeClass:
      "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  },
  ready: {
    label: "Running",
    dotClass: "bg-emerald-500",
    badgeClass:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  error: {
    label: "Error",
    dotClass: "bg-red-500",
    badgeClass:
      "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  stopped: {
    label: "Stopped",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
};

interface MachineCardProps {
  machine: Machine;
  onDelete?: (id: string) => void;
}

export function MachineCard({ machine, onDelete }: MachineCardProps) {
  const status =
    statusConfig[machine.status as keyof typeof statusConfig] ||
    statusConfig.stopped;

  return (
    <div className="group relative">
      <Link
        href={`/machines/${machine.id}`}
        className={cn(
          "block rounded-xl border bg-card p-5 transition-all duration-200",
          "hover:border-foreground/15 hover:shadow-md hover:shadow-black/[0.04] dark:hover:shadow-black/20",
          machine.status === "error" && "border-red-500/20",
        )}
      >
        {/* Top row: name + status */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold truncate">
                {machine.name || machine.slug}
              </h3>
              {machine.source === "kortix" && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                >
                  Kortix
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {machine.slug}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 gap-1.5 text-[11px] font-medium h-5 px-2",
              status.badgeClass,
            )}
          >
            <span
              className={cn("size-1.5 rounded-full shrink-0", status.dotClass)}
            />
            {status.label}
          </Badge>
        </div>

        {/* Resource specs row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Cpu className="size-3 shrink-0" />
            <span className="font-mono text-foreground truncate">
              {planName(machine.server_type)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="size-3 shrink-0" />
            <span className="text-foreground">
              {regionDisplay(machine.region).label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity className="size-3 shrink-0" />
            <span className="font-mono text-foreground truncate">
              {machine.ip || "Assigning..."}
            </span>
          </div>
        </div>

        {/* Bottom row: metadata + price */}
        <div className="flex items-center justify-between pt-3 border-t border-border/60">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>
              {new Date(machine.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            {machine.backups_enabled && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Shield className="size-2.5" />
                Backups
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {machine.source === "kortix" ? (
              <span className="text-[11px] text-muted-foreground">
                via Kortix
              </span>
            ) : machine.price_monthly ? (
              <span className="text-sm font-semibold tabular-nums">
                ${machine.price_monthly}
                <span className="text-[11px] text-muted-foreground font-normal">
                  /mo
                </span>
              </span>
            ) : null}
            <ChevronRight className="size-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
          </div>
        </div>
      </Link>

      {/* Delete button — overlaid */}
      {onDelete && machine.source !== "kortix" && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "absolute top-3 right-3 size-7 p-0 rounded-lg",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(machine.id);
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
