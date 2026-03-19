"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MachineCard } from "@/components/dashboard/machine-card";
import { ImportKortixModal } from "@/components/dashboard/import-kortix-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountLimits } from "@/hooks/use-account";
import { useMachines, useDeleteMachine } from "@/hooks/use-machines";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { Server, Plus, Trash2, AlertTriangle, Loader2, Download } from "lucide-react";

export default function MachinesPage() {
  const searchParams = useSearchParams();
  const isPostCheckout = searchParams.get("checkout") === "success";
  const isKortixImport = searchParams.get("import") === "kortix";
  const [importModalOpen, setImportModalOpen] = useState(false);

  useEffect(() => {
    if (isKortixImport) {
      setImportModalOpen(true);
      window.history.replaceState({}, "", "/machines");
    }
  }, [isKortixImport]);

  // Use ref to survive URL changes — once we start waiting, we keep waiting
  const startedWaiting = useRef(false);
  const [waitingForMachine, setWaitingForMachine] = useState(false);
  const initialMachineCount = useRef<number | null>(null);

  // Start waiting on first render if post-checkout
  useEffect(() => {
    if (isPostCheckout && !startedWaiting.current) {
      startedWaiting.current = true;
      setWaitingForMachine(true);
      // Clean URL immediately without re-mounting
      window.history.replaceState({}, "", "/machines");
    }
  }, [isPostCheckout]);

  // Poll every 3s while waiting
  const { data: machines, isLoading, error } = useMachines({
    refetchInterval: waitingForMachine ? 3000 : false,
  });
  const { data: limits } = useAccountLimits();
  const deleteMachine = useDeleteMachine();
  const [confirm, ConfirmDialog] = useConfirm();

  // Capture initial machine count once data loads
  useEffect(() => {
    if (machines && initialMachineCount.current === null) {
      initialMachineCount.current = machines.length;
    }
  }, [machines]);

  // Stop waiting once a NEW machine appears (count increased) or a provisioning machine exists
  useEffect(() => {
    if (!waitingForMachine || !machines) return;
    const hasNewMachine = initialMachineCount.current !== null && machines.length > initialMachineCount.current;
    const hasProvisioning = machines.some((m) => m.status === "provisioning");
    if (hasNewMachine || hasProvisioning) {
      setWaitingForMachine(false);
    }
  }, [waitingForMachine, machines]);

  // Timeout: stop waiting after 90s
  useEffect(() => {
    if (!waitingForMachine) return;
    const timer = setTimeout(() => setWaitingForMachine(false), 90_000);
    return () => clearTimeout(timer);
  }, [waitingForMachine]);

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setImportModalOpen(true)}
          >
            <Download className="size-4" />
            Import from Kortix
          </Button>
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

      {waitingForMachine && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <Loader2 className="size-5 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Setting up your machine...</p>
            <p className="text-sm text-muted-foreground">Payment complete. Your machine is being provisioned — this usually takes about 60 seconds.</p>
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
      <ImportKortixModal open={importModalOpen} onOpenChange={setImportModalOpen} />
    </div>
  );
}
