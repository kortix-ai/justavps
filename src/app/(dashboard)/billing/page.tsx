"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsage, useBillingPortal } from "@/hooks/use-account";
import { ExternalLink, CreditCard, Receipt } from "lucide-react";

export default function BillingPage() {
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: billing, isLoading: billingLoading } = useBillingPortal();

  const totalMachines = usage?.current_period?.total_machines ?? 0;
  const estimatedCost = usage?.current_period?.estimated_cost ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Billing</h1>

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
                  <span className="text-xs text-muted-foreground">{m.server_type}</span>
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
        {billing?.portal_url ? (
          <a href={billing.portal_url} target="_blank" rel="noopener noreferrer">
            <Button>
              <ExternalLink className="mr-2 size-4" />
              Open Billing Portal
            </Button>
          </a>
        ) : (
          <Button disabled={billingLoading}>
            {billingLoading ? "Loading..." : "Create a machine to start billing"}
          </Button>
        )}
      </div>
    </div>
  );
}
