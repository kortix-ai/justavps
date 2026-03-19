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
import { Check, Zap, Star, Rocket, Crown, ArrowUp, Loader2 } from "lucide-react";
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

  const currentIndex = useMemo(() => {
    if (!serverTypes) return -1;
    return serverTypes.findIndex((s) => s.name === machine.server_type);
  }, [serverTypes, machine.server_type]);

  const selectedSt = serverTypes?.find((s) => s.name === selectedType) ?? null;
  const currentSt = serverTypes?.find((s) => s.name === machine.server_type) ?? null;
  const priceDiff = selectedSt && currentSt ? selectedSt.price_monthly - currentSt.price_monthly : 0;

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

  // Is the current plan already the max tier?
  const isMaxTier = currentIndex >= (serverTypes?.length ?? 0) - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSelectedType(null); }}>
      <DialogContent className="sm:max-w-[540px] gap-0">
        <DialogHeader className="pb-4">
          <DialogTitle>Scale Up</DialogTitle>
          <DialogDescription>
            Upgrade to a larger plan. ~60-90s downtime while the machine restarts.
          </DialogDescription>
        </DialogHeader>

        {typesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : isMaxTier ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Your machine is already on the largest available plan.
          </div>
        ) : (
          <div className="space-y-2 py-2">
            {(serverTypes ?? []).map((s, idx) => {
              const meta = PLAN_META[idx] ?? { label: s.name, Icon: Zap };
              const { label, Icon } = meta;
              const isCurrent = s.name === machine.server_type;
              const isBelow = idx < currentIndex;
              const isDisabled = isCurrent || isBelow;
              const isSelected = selectedType === s.name;

              return (
                <button
                  key={s.name}
                  disabled={isDisabled}
                  onClick={() => setSelectedType(s.name)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all",
                    isSelected
                      ? "border-foreground bg-accent ring-1 ring-foreground"
                      : isCurrent
                        ? "border-primary/30 bg-primary/5 opacity-60"
                        : isBelow
                          ? "border-transparent opacity-30 cursor-not-allowed"
                          : "border-border hover:border-foreground/40 cursor-pointer",
                  )}
                >
                  {/* Radio */}
                  <div className={cn(
                    "size-4 rounded-full border-2 flex items-center justify-center shrink-0",
                    isSelected ? "border-foreground bg-foreground" :
                    isCurrent ? "border-primary bg-primary" : "border-muted-foreground/30",
                  )}>
                    {(isSelected || isCurrent) && <Check className="size-2.5 text-background" />}
                  </div>

                  {/* Icon */}
                  <div className={cn(
                    "size-8 rounded-lg flex items-center justify-center shrink-0",
                    isSelected ? "bg-foreground text-background" :
                    isCurrent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}>
                    <Icon className="size-3.5" />
                  </div>

                  {/* Label + specs */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      {isCurrent && (
                        <Badge variant="secondary" className="text-[9px] font-normal px-1.5 py-0 leading-tight">
                          CURRENT
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.vcpu} vCPU &middot; {s.ram_gb} GB RAM &middot; {s.disk_gb} GB SSD
                    </p>
                  </div>

                  {/* Price */}
                  <div className="text-right shrink-0 pl-2">
                    <div>
                      <span className="text-base font-semibold tabular-nums">${s.price_monthly}</span>
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Price change summary */}
        {selectedType && selectedSt && currentSt && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-muted/60 border mt-1 mb-1">
            <ArrowUp className="size-3.5 text-primary shrink-0" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">${currentSt.price_monthly}</span>
              {" \u2192 "}
              <span className="font-medium text-foreground">${selectedSt.price_monthly}/mo</span>
              <span className="ml-1">(+${priceDiff}, prorated)</span>
            </p>
          </div>
        )}

        <DialogFooter className="pt-4">
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
                Scaling...
              </>
            ) : (
              <>
                <ArrowUp className="size-4 mr-1" />
                Scale Up{selectedSt ? ` to ${PLAN_META[serverTypes?.indexOf(selectedSt) ?? -1]?.label ?? selectedSt.name}` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
