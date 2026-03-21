"use client";

import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsage, useBillingPortal, useSetupPaymentMethod } from "@/hooks/use-account";
import { useMachines, useCancelMachine, useReactivateMachine } from "@/hooks/use-machines";
import { useConfirm } from "@/hooks/use-confirm";
import {
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  CalendarX2,
  Power,
  Server,
  DollarSign,
} from "lucide-react";
import { planName, cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

const statusConfig: Record<string, { label: string; dotClass: string; badgeClass: string }> = {
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

export default function BillingPage() {
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: billing, isLoading: billingLoading } = useBillingPortal();
  const { data: allMachines, isLoading: machinesLoading } = useMachines();
  const setupPayment = useSetupPaymentMethod();
  const cancelMachine = useCancelMachine();
  const reactivateMachine = useReactivateMachine();
  const searchParams = useSearchParams();
  const [confirmCancel, ConfirmCancelDialog] = useConfirm();
  const [pendingCancelMachineId, setPendingCancelMachineId] = useState<string | null>(null);
  const [pendingReactivateMachineId, setPendingReactivateMachineId] = useState<string | null>(null);

  const estimatedCost = usage?.current_period?.estimated_cost ?? 0;
  const hasPaymentMethod = billing?.has_payment_method ?? false;

  // Show toast on return from Stripe setup/checkout
  useEffect(() => {
    if (searchParams.get("setup") === "success") {
      toast.success("Payment method added successfully!");
    } else if (searchParams.get("checkout") === "success") {
      toast.success("Payment successful! Your machine is being provisioned.");
    }
  }, [searchParams]);

  const activeMachines = allMachines?.filter((m) => m.status !== "deleted") ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-heading text-3xl tracking-tight">Billing</h1>

      {/* Payment method status */}
      {!billingLoading && !hasPaymentMethod && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium">No payment method on file</p>
            <p className="text-xs text-muted-foreground">
              Add a payment method to create machines.
            </p>
            <Button
              size="sm"
              onClick={() => setupPayment.mutate()}
              disabled={setupPayment.isPending}
            >
              {setupPayment.isPending ? (
                <><Loader2 className="size-4 animate-spin" />Redirecting…</>
              ) : (
                <><Plus className="size-4" />Add Payment Method</>
              )}
            </Button>
          </div>
        </div>
      )}

      {!billingLoading && hasPaymentMethod && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="size-4 text-emerald-500" />
          <span className="text-sm text-emerald-700 dark:text-emerald-400">Payment method on file</span>
        </div>
      )}

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-5 rounded-xl border bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Server className="size-4" />
            Machines
          </div>
          {machinesLoading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{activeMachines.length}</span>
          )}
        </div>
        <div className="p-5 rounded-xl border bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <DollarSign className="size-4" />
            Monthly
          </div>
          {usageLoading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight tabular-nums">${estimatedCost}</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
          )}
        </div>
      </div>

      {/* Subscriptions — the main show */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Subscriptions</h2>
        <div className="rounded-xl border bg-card overflow-hidden divide-y divide-border">
          {machinesLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : activeMachines.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Server className="size-7 text-muted-foreground/25 mb-2" />
              <p className="text-sm text-muted-foreground">No active machines</p>
            </div>
          ) : (
            activeMachines.map((m) => {
              const isCancelling = m.subscription?.cancel_at_period_end;
              const cancelDate = m.subscription?.cancel_at ?? m.subscription?.current_period_end;
              const status = statusConfig[m.status] ?? statusConfig.stopped;
              const isCancellingThisMachine = cancelMachine.isPending && pendingCancelMachineId === m.id;
              const isReactivatingThisMachine = reactivateMachine.isPending && pendingReactivateMachineId === m.id;
              const hasPendingMutation = cancelMachine.isPending || reactivateMachine.isPending;

              return (
                <div key={m.id} className="px-4 py-3 space-y-2">
                  {/* Row: machine info + actions */}
                  <div className="flex items-center justify-between gap-3">
                    {/* Left: slug, plan, price, status */}
                    <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                      <Link
                        href={`/machines/${m.id}`}
                        className="text-sm font-mono font-medium hover:underline"
                      >
                        {m.slug}
                      </Link>
                      <span className="text-xs text-muted-foreground">{planName(m.server_type)}</span>
                      {m.price_monthly != null && (
                        <span className="text-xs text-muted-foreground tabular-nums">${m.price_monthly}/mo</span>
                      )}
                      <Badge
                        variant="outline"
                        className={cn("gap-1.5 text-[10px] font-medium h-5 px-1.5", status.badgeClass)}
                      >
                        <span className={cn("size-1.5 rounded-full shrink-0", status.dotClass)} />
                        {status.label}
                      </Badge>
                    </div>

                    {/* Right: cancel or reactivate */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isCancelling ? (
                        <Button
                          variant="outline"
                          size="sm"
                           className="h-7 text-xs gap-1.5 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/10 border-emerald-500/30"
                           onClick={() => {
                             setPendingReactivateMachineId(m.id);
                             reactivateMachine.mutate(m.id, {
                               onSuccess: () => {
                                 setPendingReactivateMachineId(null);
                                 toast.success(`${m.slug} reactivated`);
                               },
                               onError: (err: Error) => {
                                 setPendingReactivateMachineId(null);
                                 toast.error(err.message);
                               },
                             });
                           }}
                           disabled={hasPendingMutation}
                         >
                           {isReactivatingThisMachine ? (
                             <Loader2 className="size-3 animate-spin" />
                           ) : (
                             <Power className="size-3" />
                          )}
                          Reactivate
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5 text-red-600 hover:text-red-600 hover:bg-red-500/10 border-red-500/30"
                          onClick={async () => {
                            const ok = await confirmCancel({
                              title: `Cancel ${m.slug}`,
                              description: m.subscription
                                ? "Your machine will keep running until the end of your billing period, then it will be permanently deleted. You can reactivate any time before then."
                                : "This machine has no active subscription. To delete it, go to the machine detail page.",
                              confirmLabel: "Cancel Subscription",
                              variant: "destructive",
                             });
                             if (!ok) return;
                             setPendingCancelMachineId(m.id);
                             cancelMachine.mutate(m.id, {
                               onSuccess: () => {
                                 setPendingCancelMachineId(null);
                                 toast.success(`${m.slug} subscription cancelled`);
                               },
                               onError: (err: Error) => {
                                 setPendingCancelMachineId(null);
                                 toast.error(err.message);
                               },
                             });
                           }}
                           disabled={hasPendingMutation}
                         >
                           {isCancellingThisMachine ? (
                             <Loader2 className="size-3 animate-spin" />
                           ) : (
                             <CalendarX2 className="size-3" />
                          )}
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Cancellation notice */}
                  {isCancelling && (
                    <p className="text-[11px] text-destructive pl-0.5">
                      Ends {cancelDate
                        ? new Date(cancelDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                        : "at end of billing period"}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Stripe portal */}
      <div className="p-5 rounded-xl border bg-card space-y-3">
        <h2 className="text-sm font-medium">Payment & Invoices</h2>
        <p className="text-sm text-muted-foreground">
          View invoices, update payment methods, and manage subscriptions through Stripe.
        </p>
        <div className="flex items-center gap-2">
          {billing?.portal_url ? (
            <a href={billing.portal_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline">
                <ExternalLink className="size-4" />
                Open Billing Portal
              </Button>
            </a>
          ) : (
            <Button variant="outline" disabled={billingLoading}>
              {billingLoading ? "Loading…" : "No billing portal available"}
            </Button>
          )}
          {!hasPaymentMethod && !billingLoading && (
            <Button
              onClick={() => setupPayment.mutate()}
              disabled={setupPayment.isPending}
            >
              {setupPayment.isPending ? (
                <><Loader2 className="size-4 animate-spin" />Redirecting…</>
              ) : (
                <><Plus className="size-4" />Add Payment Method</>
              )}
            </Button>
          )}
        </div>
      </div>

      <ConfirmCancelDialog />
    </div>
  );
}
