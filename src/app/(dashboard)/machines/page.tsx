"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MachineCard } from "@/components/dashboard/machine-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountLimits } from "@/hooks/use-account";
import { useMachines, useDeleteMachine } from "@/hooks/use-machines";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { Server, Plus, Trash2, AlertTriangle } from "lucide-react";

export default function MachinesPage() {
  const { data: machines, isLoading, error } = useMachines();
  const { data: limits } = useAccountLimits();
  const deleteMachine = useDeleteMachine();
  const [confirm, ConfirmDialog] = useConfirm();
  const machineUsage = limits?.usage.machines ?? 0;
  const machineMax = limits?.limits.max_machines;
  const machineLimitReached = machineMax !== undefined && machineUsage >= machineMax;
  const machineLimitNear = machineMax !== undefined && machineMax > 0 && machineUsage / machineMax >= 0.8 && !machineLimitReached;

  const handleDelete = async (id: string) => {
    const machine = machines?.find((m) => m.id === id);
    const ok = await confirm({
      title: "Delete Machine",
      description: `This will permanently destroy ${machine?.slug || "this machine"} and all data on it. This action cannot be undone.`,
      confirmLabel: "Delete Forever",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;

    deleteMachine.mutate(id, {
      onSuccess: () => toast.success("Machine deleted"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-3xl tracking-tight">Machines</h1>
        {machineLimitReached ? (
          <Button disabled>
            <Plus className="size-4" />
            Machine Limit Reached
          </Button>
        ) : (
          <Link href="/machines/new" className={cn(buttonVariants())}>
            <Plus className="size-4" />
            New Machine
          </Link>
        )}
      </div>

      {(machineLimitReached || machineLimitNear) && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 ${machineLimitReached ? "border-destructive/20 bg-destructive/5" : "border-amber-500/20 bg-amber-500/10"}`}>
          <AlertTriangle className={`mt-0.5 size-5 shrink-0 ${machineLimitReached ? "text-destructive" : "text-amber-500"}`} />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {machineLimitReached ? "Machine limit reached" : "Approaching machine limit"}
            </p>
            <p className="text-sm text-muted-foreground">
              You are using {machineUsage} of {machineMax} machines.
              {machineLimitReached
                ? " Delete one to deploy another."
                : " You can still deploy, but you are close to your cap."}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="text-center py-12">
          <p className="text-destructive text-sm">Error: {error.message}</p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-5 border rounded-lg space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : !error && machines?.length === 0 ? (
        <div className="text-center py-20">
          <Server className="mx-auto size-12 text-muted-foreground/40 mb-4" strokeWidth={1} />
          <h2 className="font-heading text-2xl mb-2">No machines yet</h2>
          <p className="text-muted-foreground mb-6">
            Get started by creating your first VPS.
          </p>
          {machineLimitReached ? (
            <Button disabled>
              <Plus className="size-4" />
              Machine Limit Reached
            </Button>
          ) : (
            <Link href="/machines/new" className={cn(buttonVariants())}>
              <Plus className="size-4" />
              New Machine
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {machines?.map((machine) => (
            <MachineCard key={machine.id} machine={machine} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
