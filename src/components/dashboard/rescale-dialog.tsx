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
import {
  ArrowRight,
  Loader2,
  AlertTriangle,
  LockKeyhole,
  TrendingUp,
  Crown,
} from "lucide-react";
import { PlanList } from "@/components/plan-list";
import { useServerTypes } from "@/hooks/use-server-types";
import { useResizeMachine } from "@/hooks/use-machines";
import { toast } from "sonner";
import type { Machine } from "@/lib/types";
import { planName } from "@/lib/utils";

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

  const canResize = machine.status === "ready";

  const currentIndex = useMemo(() => {
    if (!serverTypes) return -1;
    return serverTypes.findIndex((s) => s.name === machine.server_type);
  }, [serverTypes, machine.server_type]);

  const selectedSt = serverTypes?.find((s) => s.name === selectedType) ?? null;
  const currentSt = serverTypes?.find((s) => s.name === machine.server_type) ?? null;
  const priceDiff = selectedSt && currentSt ? selectedSt.price_monthly - currentSt.price_monthly : 0;

  const handleClose = (v: boolean) => {
    if (resizeMachine.isPending) return;
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
          const msg = err instanceof Error ? err.message : "Scale-up failed. Please try again.";
          setApiError(msg);
          toast.error("Scale-up failed", { description: msg });
        },
      },
    );
  };

  const isMaxTier = currentIndex !== -1 && currentIndex >= (serverTypes?.length ?? 0) - 1;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px] gap-0 p-0 overflow-hidden">
        {/* ── Header ── */}
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

        {/* ── Body ── */}
        <div className="px-5 py-4 space-y-4">
          {!canResize && (
            <div className="flex items-start gap-2.5 rounded-lg border border-brand/30 bg-brand/8 px-3.5 py-3">
              <AlertTriangle className="size-4 text-brand shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Machine must be running</p>
                <p className="text-xs text-amber-600/80 dark:text-brand/80 mt-0.5">Start your machine before scaling up.</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
            <LockKeyhole className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Scale-up is permanent.</span>{" "}
              Once upgraded, you cannot downgrade to a smaller plan. Disk is permanently enlarged.
              Billing is prorated from the moment of resize.
            </p>
          </div>

          {apiError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-3">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive leading-relaxed">{apiError}</p>
            </div>
          )}

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
            <PlanList
              plans={serverTypes ?? []}
              selected={selectedType ?? ""}
              onSelect={(name) => setSelectedType(name)}
              currentIndex={currentIndex}
              showCurrent
              disabled={!canResize}
            />
          )}

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

        {/* ── Footer ── */}
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
                  ? `Scale to ${planName(selectedSt.name)}`
                  : "Scale Up"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
