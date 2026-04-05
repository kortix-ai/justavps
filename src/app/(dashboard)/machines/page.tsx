"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatLimit, isUnlimitedLimit } from "@/lib/account-limits";
import { MachineCard } from "@/components/dashboard/machine-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountLimits } from "@/hooks/use-account";
import { useMachines } from "@/hooks/use-machines";
import {
  Server,
  Plus,
  AlertTriangle,
  Loader2,
  Activity,
  Search,
} from "lucide-react";
import { CheckoutModal } from "@/components/checkout-modal";

export default function MachinesPage() {
  const searchParams = useSearchParams();
  const isPostCheckout = searchParams.get("checkout") === "success";
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const startedWaiting = useRef(false);
  const [waitingForMachine, setWaitingForMachine] = useState(false);
  const initialMachineCount = useRef<number | null>(null);

  useEffect(() => {
    if (isPostCheckout && !startedWaiting.current) {
      startedWaiting.current = true;
      setWaitingForMachine(true);
      window.history.replaceState({}, "", "/machines");
    }
  }, [isPostCheckout]);

  const { data: machines, isLoading, error } = useMachines({
    refetchInterval: waitingForMachine ? 3000 : false,
  });
  const { data: limits } = useAccountLimits();

  useEffect(() => {
    if (machines && initialMachineCount.current === null) {
      initialMachineCount.current = machines.length;
    }
  }, [machines]);

  useEffect(() => {
    if (!waitingForMachine || !machines) return;
    const hasNewMachine =
      initialMachineCount.current !== null &&
      machines.length > initialMachineCount.current;
    const hasProvisioning = machines.some((m) => m.status === "provisioning");
    if (hasNewMachine || hasProvisioning) setWaitingForMachine(false);
  }, [waitingForMachine, machines]);

  useEffect(() => {
    if (!waitingForMachine) return;
    const timer = setTimeout(() => setWaitingForMachine(false), 90_000);
    return () => clearTimeout(timer);
  }, [waitingForMachine]);

  const machineUsage = limits?.usage.machines ?? 0;
  const machineMax = limits?.limits.max_machines;
  const machineUnlimited = isUnlimitedLimit(machineMax);
  const machineLimitReached = !machineUnlimited && machineMax !== undefined && machineUsage >= machineMax;
  const machineLimitNear =
    !machineUnlimited &&
    machineMax !== undefined &&
    machineMax > 0 &&
    machineUsage / machineMax >= 0.8 &&
    !machineLimitReached;

  const filteredMachines = machines?.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.name?.toLowerCase().includes(q) ||
      m.slug.toLowerCase().includes(q) ||
      m.ip?.toLowerCase().includes(q) ||
      m.server_type.toLowerCase().includes(q) ||
      m.region.toLowerCase().includes(q)
    );
  });

  const totalMachines = machines?.length ?? 0;
  const runningMachines = machines?.filter((m) => m.status === "ready").length ?? 0;
  const provisioningMachines = machines?.filter((m) => m.status === "provisioning").length ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl tracking-tight">Machines</h1>
          {!isLoading && totalMachines > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {runningMachines} running
              {provisioningMachines > 0 && ` · ${provisioningMachines} provisioning`}
              {machineMax !== undefined && ` · ${machineUsage}/${formatLimit(machineMax)} used`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {machineLimitReached ? (
            <Button disabled>
              <Plus className="size-4" />
              Limit Reached
            </Button>
          ) : (
            <Button onClick={() => setCheckoutOpen(true)}>
              <Plus className="size-4" />
              New Machine
            </Button>
          )}
        </div>
      </div>

      {/* ── Alerts ─────────────────────────────────────────────────────── */}
      {(machineLimitReached || machineLimitNear) && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border p-4",
            machineLimitReached
              ? "border-destructive/20 bg-destructive/5"
              : "border-brand/20 bg-brand/10",
          )}
        >
          <AlertTriangle
            className={cn(
              "mt-0.5 size-4 shrink-0",
              machineLimitReached ? "text-destructive" : "text-brand",
            )}
          />
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {machineLimitReached ? "Machine limit reached" : "Approaching machine limit"}
            </p>
            <p className="text-xs text-muted-foreground">
              You are using {machineUsage} of {formatLimit(machineMax)} machines.
              {machineLimitReached
                ? " Delete one to deploy another."
                : " You can still deploy, but you are close to your cap."}
            </p>
          </div>
        </div>
      )}

      {waitingForMachine && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <Loader2 className="size-4 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Setting up your machine…</p>
            <p className="text-xs text-muted-foreground">
              Payment complete. Your machine is being provisioned — usually takes 1–3 minutes.
            </p>
          </div>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="text-center py-12">
          <p className="text-destructive text-sm">Error: {error.message}</p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full shrink-0" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <div className="flex justify-between pt-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      ) : !error && machines?.length === 0 ? (
        /* ── Empty State ──────────────────────────────────────────────── */
        <div className="flex flex-col items-center justify-center py-24">
          <div className="relative mb-6">
            <div className="rounded-2xl bg-muted p-5">
              <Server className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
            </div>
            <div className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5">
              <Plus className="size-3 text-primary-foreground" />
            </div>
          </div>
          <h2 className="font-heading text-xl mb-1.5">No machines yet</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
            Deploy your first VPS in minutes. Pick a plan and go.
          </p>
          {machineLimitReached ? (
            <Button disabled><Plus className="size-4" />Limit Reached</Button>
          ) : (
            <Button onClick={() => setCheckoutOpen(true)}><Plus className="size-4" />New Machine</Button>
          )}
        </div>
      ) : (
        <>
          {/* ── Search ──────────────────────────────────────────────────── */}
          {totalMachines > 3 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name, IP, region…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          )}

          {/* ── Grid ────────────────────────────────────────────────────── */}
          {filteredMachines && filteredMachines.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredMachines.map((machine) => (
                <MachineCard key={machine.id} machine={machine} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Activity className="mx-auto size-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No machines match &quot;{searchQuery}&quot;</p>
              <Button variant="link" size="sm" onClick={() => setSearchQuery("")} className="mt-1 text-xs">
                Clear search
              </Button>
            </div>
          )}
        </>
      )}

      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
    </div>
  );
}
