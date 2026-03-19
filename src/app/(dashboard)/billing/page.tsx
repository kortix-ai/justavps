"use client";

import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsage, useBillingPortal, useSetupPaymentMethod } from "@/hooks/use-account";
import { ExternalLink, CreditCard, Receipt, AlertTriangle, CheckCircle2, Loader2, Plus } from "lucide-react";
import { planName } from "@/lib/utils";
import { useEffect } from "react";
import { toast } from "sonner";

export default function BillingPage() {
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: billing, isLoading: billingLoading } = useBillingPortal();
  const setupPayment = useSetupPaymentMethod();
  const searchParams = useSearchParams();

  const totalMachines = usage?.current_period?.total_machines ?? 0;
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

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Billing</h1>

      {/* Payment method status alert */}
      {!billingLoading && !hasPaymentMethod && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium">No payment method on file</p>
            <p className="text-sm text-muted-foreground">
              Add a payment method to create machines. You&apos;ll be redirected to Stripe to securely add your card.
            </p>
            <Button
              size="sm"
              onClick={() => setupPayment.mutate()}
              disabled={setupPayment.isPending}
            >
              {setupPayment.isPending ? (
                <><Loader2 className="size-4 animate-spin mr-2" />Redirecting...</>
              ) : (
                <><Plus className="size-4 mr-2" />Add Payment Method</>
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

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-5 rounded-xl bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            <CreditCard className="size-4" />
            Active Machines
          </div>
          {usageLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight">{totalMachines}</span>
              <Badge variant="secondary">{totalMachines > 0 ? "Active" : "None"}</Badge>
            </div>
          )}
        </div>

        <div className="p-5 rounded-xl bg-card">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            <Receipt className="size-4" />
            Estimated Monthly Cost
          </div>
          {usageLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight">${estimatedCost}</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
          )}
        </div>
      </div>

      {/* Machine breakdown */}
      {usage?.current_period?.machines?.length ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Machine Breakdown</h2>
          <div className="rounded-xl bg-card overflow-hidden divide-y divide-border">
            {usage.current_period.machines.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono">{m.slug}</span>
                  <span className="text-xs text-muted-foreground">{planName(m.server_type)}</span>
                </div>
                <Badge variant={m.status === "ready" ? "default" : "secondary"}>{m.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Stripe portal */}
      <div className="p-5 rounded-xl bg-card space-y-3">
        <h2 className="text-sm font-medium">Payment & Invoices</h2>
        <p className="text-sm text-muted-foreground">
          View invoices, update payment methods, and manage subscriptions through Stripe.
        </p>
        <div className="flex items-center gap-2">
          {billing?.portal_url ? (
            <a href={billing.portal_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline">
                <ExternalLink className="mr-2 size-4" />
                Open Billing Portal
              </Button>
            </a>
          ) : (
            <Button variant="outline" disabled={billingLoading}>
              {billingLoading ? "Loading..." : "No billing portal available"}
            </Button>
          )}

          {!hasPaymentMethod && !billingLoading && (
            <Button
              onClick={() => setupPayment.mutate()}
              disabled={setupPayment.isPending}
            >
              {setupPayment.isPending ? (
                <><Loader2 className="size-4 animate-spin mr-2" />Redirecting...</>
              ) : (
                <><Plus className="size-4 mr-2" />Add Payment Method</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
