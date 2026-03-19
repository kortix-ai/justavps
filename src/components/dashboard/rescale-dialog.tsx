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
import { Check, Zap, Star, Rocket, Crown, Shield, ArrowUp, Loader2, AlertTriangle } from "lucide-react";
import { useServerTypes } from "@/hooks/use-server-types";
import { useResizeMachine } from "@/hooks/use-machines";
import { toast } from "sonner";
import type { Machine } from "@/lib/types";

/* Plan labels — must match plan-picker.tsx order */
const PLAN_META = [
  { label: "Starter", Icon: Zap, tagline: "Light workloads" },
  { label: "Pro", Icon: Star, tagline: "Most workloads" },
  { label: "Power", Icon: Rocket, tagline: "Heavy & parallel" },
  { label: "Ultra", Icon: Crown, tagline: "Maximum performance" },
] as const;

interface RescaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: Machine;
}

export function RescaleDialog({ open, onOpenChange, machine }: RescaleDialogProps) {
  const { data: serverTypes, isLoading: typesLoading } = useServerTypes("cloud", machine.region);
  const resizeMachine = useResizeMachine();

  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Find the current plan index so we can grey out anything at or below it
  const currentIndex = useMemo(() => {
    if (!serverTypes) return -1;
    return serverTypes.findIndex((s) => s.name === machine.server_type);
  }, [serverTypes, machine.server_type]);

  const selectedSt = serverTypes?.find((s) => s.name === selectedType) ?? null;
  const currentSt = serverTypes?.find((s) => s.name === machine.server_type) ?? null;

  const priceDiff = selectedSt && currentSt
    ? selectedSt.price_monthly - currentSt.price_monthly
    : 0;

  const handleResize = () => {
    if (!selectedType) return;
    resizeMachine.mutate(
      { id: machine.id, server_type: selectedType },
      {
        onSuccess: () => {
          toast.success("Scale-up initiated", {
            description: "Your machine is being resized. It will be back online in ~60-90 seconds.",
          });
          onOpenChange(false);
          setSelectedType(null);
        },
        onError: (err) => {
          toast.error("Scale-up failed", { description: err.message });
        },
      },
    );
  };

  const formatMoney = (amount: number) => {
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSelectedType(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUp className="size-5" />
            Scale Up Machine
          </DialogTitle>
          <DialogDescription>
            Upgrade to a larger plan. The machine will restart (~60-90s downtime). Disk is permanently enlarged. Billing is prorated.
          </DialogDescription>
        </DialogHeader>

        {typesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2 py-2">
            {(serverTypes ?? []).map((s, idx) => {
              const meta = PLAN_META[idx] ?? { label: s.name, Icon: Zap, tagline: "" };
              const { label, Icon, tagline } = meta;
              const isCurrent = s.name === machine.server_type;
              const isBelow = idx <= currentIndex;
              const isDisabled = isBelow;
              const isSelected = selectedType === s.name;

              return (
                <button
                  key={s.name}
                  disabled={isDisabled}
                  onClick={() => setSelectedType(s.name)}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                    isSelected
                      ? "border-foreground bg-card ring-1 ring-foreground"
                      : isCurrent
                        ? "border-primary/30 bg-primary/5"
                        : isDisabled
                          ? "border-border opacity-40 cursor-not-allowed"
                          : "border-border hover:border-foreground/50 cursor-pointer",
                  )}
                >
                  {/* Radio / current indicator */}
                  <div className={cn(
                    "size-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                    isSelected
                      ? "border-foreground bg-foreground"
                      : isCurrent
                        ? "border-primary bg-primary"
                        : "border-border",
                  )}>
                    {(isSelected || isCurrent) && <Check className="size-3 text-background" />}
                  </div>

                  {/* Icon */}
                  <div className={cn(
                    "size-10 rounded-xl flex items-center justify-center shrink-0",
                    isSelected
                      ? "bg-foreground text-background"
                      : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                  )}>
                    <Icon className="size-4" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      {isCurrent && (
                        <Badge variant="secondary" className="text-[9px] font-normal px-1.5 py-0">
                          CURRENT
                        </Badge>
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
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <Shield className="size-2.5 text-green-600 dark:text-green-400" />
                      <span className="text-[10px] text-green-600 dark:text-green-400">
                        includes ${formatMoney(s.backup_price_monthly)} backups
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Price change summary */}
        {selectedType && selectedSt && currentSt && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
            <AlertTriangle className="size-4 text-yellow-500 shrink-0" />
            <div className="text-sm">
              <span className="text-muted-foreground">Price change: </span>
              <span className="font-medium">${currentSt.price_monthly}/mo</span>
              <span className="text-muted-foreground"> &rarr; </span>
              <span className="font-medium">${selectedSt.price_monthly}/mo</span>
              <span className="text-muted-foreground"> (+${priceDiff}/mo, prorated)</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleResize}
            disabled={!selectedType || resizeMachine.isPending}
          >
            {resizeMachine.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Scaling up...
              </>
            ) : (
              <>
                <ArrowUp className="size-4 mr-2" />
                Scale Up
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
