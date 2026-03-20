"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Check,
  Zap,
  Star,
  Rocket,
  Crown,
  ArrowRight,
  Loader2,
  AlertTriangle,
  LockKeyhole,
  TrendingUp,
} from "lucide-react";
import { useServerTypes } from "@/hooks/use-server-types";
import { useResizeMachine } from "@/hooks/use-machines";
import { toast } from "sonner";
import type { Machine } from "@/lib/types";

const PLAN_META = [
  { label: "Starter", Icon: Zap },
  { label: "Pro", Icon: Star },
  { label: "Power", Icon: Rocket },
  { label: "Ultra", Icon: Crown },
] as const;

interface RescaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: Machine;
}

export function RescaleDialog({ open, onOpenChange, machine }: RescaleDialogProps) {
  const { data: serverTypes, isLoading: typesLoading } = useServerTypes(machine.provider, machine.region);
  const resizeMachine = useResizeMachine();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Machine must be running (ready) to resize — backend enforces this too
  const canResize = machine.status === "ready";

  const currentIndex = useMemo(() => {
    if (!serverTypes) return -1;
    return serverTypes.findIndex((s) => s.name === machine.server_type);
  }, [serverTypes, machine.server_type]);

  const selectedSt = serverTypes?.find((s) => s.name === selectedType) ?? null;
  const currentSt = serverTypes?.find((s) => s.name === machine.server_type) ?? null;
  const priceDiff = selectedSt && currentSt ? selectedSt.price_monthly - currentSt.price_monthly : 0;

  const handleClose = (v: boolean) => {
    if (resizeMachine.isPending) return; // don't allow closing while pending
    onOpenChange(v);
    if (!v) {
      setSelectedType(null);
      setApiError(null);
    }
  };

  const handleResize = () => {
    if (!selectedType || !canResize) return;
    setApiError(null);
    resizeMachine.mutate(
      { id: machine.id, server_type: selectedType },
      {
        onSuccess: () => {
          toast.success("Scale-up initiated", {
            description: "Your machine is being resized. It will be back online in ~60–90 seconds.",
          });
          handleClose(false);
        },
        onError: (err) => {
          // Show error inline rather than just a toast so user can read it clearly
          const msg = err instanceof Error ? err.message : "Scale-up failed. Please try again.";
          setApiError(msg);
          toast.error("Scale-up failed", { description: msg });
        },
      },
    );
  };

  // Is the current plan already the max tier?
  const isMaxTier = currentIndex !== -1 && currentIndex >= (serverTypes?.length ?? 0) - 1;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px] gap-0 p-0 overflow-hidden">
        {/* ── Header ─────────────────────────────────────────────── */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <TrendingUp className="size-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base">Scale Up</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Upgrade to a larger plan. ~60–90s downtime while the machine restarts.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="px-5 py-4 space-y-4">

          {/* Machine must be running gate */}
          {!canResize && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3.5 py-3">
              <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Machine must be running
                </p>
                <p className="text-xs text-amber-600/80 dark:text-amber-500/80 mt-0.5">
                  Start your machine before scaling up.
                </p>
              </div>
            </div>
          )}

          {/* One-way upgrade notice */}
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
            <LockKeyhole className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Scale-up is permanent.</span>{" "}
              Once upgraded, you cannot downgrade to a smaller plan. Disk is permanently enlarged.
              Billing is prorated from the moment of resize.
            </p>
          </div>

          {/* API error */}
          {apiError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-3">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive leading-relaxed">{apiError}</p>
            </div>
          )}

          {/* Plan list */}
          {typesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : isMaxTier ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Crown className="size-8 text-muted-foreground/30 mb-2.5" strokeWidth={1.5} />
              <p className="text-sm font-medium">You&apos;re on the largest plan</p>
              <p className="text-xs text-muted-foreground mt-0.5">No further upgrades are available.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {(serverTypes ?? []).map((s, idx) => {
                const meta = PLAN_META[idx] ?? { label: s.name, Icon: Zap };
                const { label, Icon } = meta;
                const isCurrent = s.name === machine.server_type;
                const isBelow = idx < currentIndex;
                const isDisabled = isCurrent || isBelow || !canResize;
                const isSelected = selectedType === s.name;

                return (
                  <button
                    key={s.name}
                    disabled={isDisabled}
                    onClick={() => !isDisabled && setSelectedType(s.name)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-foreground bg-accent shadow-sm ring-1 ring-foreground/20"
                        : isCurrent
                          ? "border-primary/40 bg-primary/5"
                          : isBelow
                            ? "border-transparent opacity-30 cursor-not-allowed"
                            : !canResize
                              ? "border-border opacity-50 cursor-not-allowed"
                              : "border-border hover:border-foreground/40 hover:bg-muted/30 cursor-pointer",
                    )}
                  >
                    {/* Radio dot */}
                    <div className={cn(
                      "size-4 rounded-full border-2 flex items-center justify-center shrink-0",
                      isSelected
                        ? "border-foreground bg-foreground"
                        : isCurrent
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40 bg-transparent",
                    )}>
                      {(isSelected || isCurrent) && (
                        <Check className="size-2.5 text-background" />
                      )}
                    </div>

                    {/* Icon */}
                    <div className={cn(
                      "size-8 rounded-lg flex items-center justify-center shrink-0",
                      isSelected
                        ? "bg-foreground text-background"
                        : isCurrent
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}>
                      <Icon className="size-3.5" />
                    </div>

                    {/* Label + specs */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-sm font-semibold",
                          isDisabled && !isCurrent ? "text-muted-foreground" : "text-foreground",
                        )}>
                          {label}
                        </span>
                        {isCurrent && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-medium px-1.5 py-0 h-4 leading-tight border-primary/30 text-primary"
                          >
                            CURRENT
                          </Badge>
                        )}
                        {isBelow && (
                          <span className="text-[10px] text-muted-foreground/60">no downgrade</span>
                        )}
                      </div>
                      <p className={cn(
                        "text-xs mt-0.5",
                        isDisabled && !isCurrent ? "text-muted-foreground/60" : "text-muted-foreground",
                      )}>
                        {s.vcpu} vCPU &middot; {s.ram_gb} GB RAM &middot; {s.disk_gb} GB SSD
                      </p>
                    </div>

                    {/* Price */}
                    <div className="text-right shrink-0 pl-2">
                      <span className={cn(
                        "text-base font-bold tabular-nums",
                        isDisabled && !isCurrent ? "text-muted-foreground" : "text-foreground",
                      )}>
                        ${s.price_monthly}
                      </span>
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Price change summary */}
          {selectedType && selectedSt && currentSt && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-border bg-muted/40">
              <ArrowRight className="size-3.5 text-primary shrink-0" />
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">${currentSt.price_monthly}/mo</span>
                {" → "}
                <span className="font-semibold text-foreground">${selectedSt.price_monthly}/mo</span>
                <span className="text-muted-foreground ml-1.5 text-xs">(+${priceDiff.toFixed(2)}, prorated)</span>
              </p>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <DialogFooter className="mx-0 mb-0 rounded-none border-t bg-muted/20 px-5 py-4 gap-2">
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={resizeMachine.isPending}
            className="h-9"
          >
            Cancel
          </Button>
          <Button
            onClick={handleResize}
            disabled={!selectedType || resizeMachine.isPending || !canResize}
            className="h-9 gap-1.5"
          >
            {resizeMachine.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Scaling up…
              </>
            ) : (
              <>
                <TrendingUp className="size-4" />
                {selectedSt
                  ? `Scale to ${PLAN_META[serverTypes?.indexOf(selectedSt) ?? -1]?.label ?? selectedSt.name}`
                  : "Scale Up"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
