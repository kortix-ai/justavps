"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  DollarSign,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "sonner";
import { useAccount } from "@/shared/hooks/use-account";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminLoadingRows,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
  relativeShort,
} from "@/v2/components/admin/primitives";
import { machineStatusTone } from "@/v2/components/admin/tones";
import type { Tone } from "@/v2/components/admin/tones";
import {
  useAdminBillingSummary,
  useAdminStripeEvents,
  useAdminSubscription,
  useAdminSubscriptionList,
  type AdminSubscriptionListItem,
  type AdminSubscriptionStatus,
} from "@/shared/hooks/use-admin-billing";

// ─── Helpers ───────────────────────────────────────────────────────────────

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(value).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Failed to copy"),
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(value)}
      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
      title="Click to copy"
    >
      <span className="truncate">{value}</span>
      <Copy className="size-3 shrink-0" />
    </button>
  );
}

function formatUsdFromCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function subscriptionStatusTone(status: string): Tone {
  switch (status) {
    case "active":
      return "success";
    case "past_due":
    case "unpaid":
      return "danger";
    case "incomplete":
      return "warning";
    case "canceled":
      return "neutral";
    default:
      return "neutral";
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

// ─── Detail dialog ─────────────────────────────────────────────────────────

function SubscriptionDetailDialog({
  subscriptionId,
  onClose,
}: {
  subscriptionId: string | null;
  onClose: () => void;
}) {
  const open = Boolean(subscriptionId);
  const { data, isLoading, error } = useAdminSubscription(subscriptionId);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Subscription</span>
            {data?.subscription && (
              <AdminStatusPill tone={subscriptionStatusTone(data.subscription.status)}>
                {data.subscription.status}
              </AdminStatusPill>
            )}
            {data?.subscription.cancel_at_period_end && (
              <Badge variant="destructive" className="text-xs">cancelling</Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {data?.subscription.stripe_subscription_id && (
              <CopyButton value={data.subscription.stripe_subscription_id} />
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mr-2 inline size-4" />
            {error instanceof Error ? error.message : "Failed to load subscription"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Summary grid */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Price</div>
                <div className="text-lg font-semibold">
                  {data.machine?.price_monthly != null ? `$${data.machine.price_monthly}/mo` : "—"}
                </div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="text-sm font-semibold">{data.subscription.status}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Period end</div>
                <div className="text-sm font-medium">
                  {data.subscription.current_period_end
                    ? formatDate(data.subscription.current_period_end)
                    : "—"}
                </div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
                <div className="text-sm font-medium">{relativeShort(data.subscription.created_at)}</div>
              </div>
            </div>

            {/* Stripe IDs */}
            <section className="rounded-xl border p-4 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Stripe references
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Subscription: </span>
                  <CopyButton value={data.subscription.stripe_subscription_id} />
                </div>
                {data.subscription.stripe_subscription_item_id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Item: </span>
                    <CopyButton value={data.subscription.stripe_subscription_item_id} />
                  </div>
                )}
                {data.subscription.stripe_price_id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Price: </span>
                    <CopyButton value={data.subscription.stripe_price_id} />
                  </div>
                )}
                {data.subscription.stripe_checkout_session_id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Checkout session: </span>
                    <CopyButton value={data.subscription.stripe_checkout_session_id} />
                  </div>
                )}
              </div>
            </section>

            {/* Lifecycle */}
            <section className="rounded-xl border p-4 space-y-1.5 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Lifecycle
              </h3>
              <div>
                <span className="text-muted-foreground">Current period: </span>
                {formatDate(data.subscription.current_period_start)} → {formatDate(data.subscription.current_period_end)}
              </div>
              <div>
                <span className="text-muted-foreground">Cancel at period end: </span>
                {data.subscription.cancel_at_period_end ? "Yes" : "No"}
              </div>
              {data.subscription.cancel_at && (
                <div>
                  <span className="text-muted-foreground">Cancels at: </span>
                  {formatDate(data.subscription.cancel_at)}
                </div>
              )}
              {data.subscription.cancelled_at && (
                <div>
                  <span className="text-muted-foreground">Cancelled at: </span>
                  {formatDate(data.subscription.cancelled_at)}
                </div>
              )}
            </section>

            {/* Machine */}
            {data.machine && (
              <section className="rounded-xl border p-4">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Machine
                </h3>
                <Link
                  href={`/v2/admin/machines?highlight=${data.machine.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium">{data.machine.slug}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {data.machine.name} · {data.machine.server_type} · {data.machine.region}
                    </div>
                  </div>
                  <AdminStatusPill tone={machineStatusTone(data.machine.status)}>
                    {data.machine.status}
                  </AdminStatusPill>
                  <span className="text-xs text-muted-foreground">
                    heartbeat {data.machine.last_heartbeat_at ? relativeShort(data.machine.last_heartbeat_at) : "—"}
                  </span>
                </Link>
              </section>
            )}

            {/* Owner + Account */}
            <section className="rounded-xl border p-4 space-y-2 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Customer
              </h3>
              <div>
                <span className="text-muted-foreground">Owner: </span>
                {data.owner.email ?? "—"}
                {data.owner.name ? ` (${data.owner.name})` : ""}
              </div>
              {data.account && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Account: </span>
                  <Link
                    href={`/v2/admin/accounts?highlight=${data.account.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {data.account.name ?? data.account.slug ?? data.account.id.slice(0, 8)}
                  </Link>
                  {data.account.type && (
                    <Badge variant="outline" className="text-xs">{data.account.type}</Badge>
                  )}
                </div>
              )}
            </section>

            {/* Recent machine events */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent machine events ({data.recent_events.length})
              </h3>
              {data.recent_events.length === 0 ? (
                <div className="text-xs text-muted-foreground">No recent events</div>
              ) : (
                <div className="space-y-1.5">
                  {data.recent_events.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{ev.event}</div>
                        {ev.message && (
                          <div className="truncate text-xs text-muted-foreground">{ev.message}</div>
                        )}
                      </div>
                      {ev.stage && (
                        <Badge variant="outline" className="text-xs">{ev.stage}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {relativeShort(ev.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Subscription row ──────────────────────────────────────────────────────

function SubscriptionRow({
  sub,
  onOpen,
}: {
  sub: AdminSubscriptionListItem;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-mono text-sm font-medium tracking-tight">
              {sub.machine?.slug ?? "(no machine)"}
            </h3>
            {sub.machine && (
              <AdminStatusPill tone={machineStatusTone(sub.machine.status)}>
                {sub.machine.status}
              </AdminStatusPill>
            )}
            <AdminStatusPill tone={subscriptionStatusTone(sub.status)}>
              {sub.status}
            </AdminStatusPill>
            {sub.cancel_at_period_end && (
              <Badge variant="destructive" className="text-xs">cancelling</Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {sub.owner.email ?? "—"}
            {sub.account ? ` · ${sub.account.name ?? sub.account.slug}` : ""}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {sub.stripe_subscription_id}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <div className="min-w-[70px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Price</div>
            <div className="text-sm font-medium">
              {sub.machine?.price_monthly != null ? `$${sub.machine.price_monthly}/mo` : "—"}
            </div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Period end</div>
            <div className="text-sm font-medium">
              {sub.current_period_end ? relativeShort(sub.current_period_end) : "—"}
            </div>
          </div>
          <div className="min-w-[70px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
            <div className="text-sm font-medium">{relativeShort(sub.created_at)}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Stripe events widget ──────────────────────────────────────────────────

function StripeEventsList() {
  const { data, isLoading, error } = useAdminStripeEvents({ limit: 25 });
  if (isLoading) return <AdminLoadingRows count={3} />;
  if (error) {
    return (
      <div className="text-xs text-destructive">
        {error instanceof Error ? error.message : "Failed to load events"}
      </div>
    );
  }
  if (!data || data.events.length === 0) {
    return <div className="text-xs text-muted-foreground">No recent events</div>;
  }
  return (
    <div className="space-y-1">
      {data.events.map((ev) => (
        <div
          key={ev.event_id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
        >
          <span className="truncate font-mono">{ev.event_type}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{ev.event_id}</span>
          <span className="text-muted-foreground">{relativeShort(ev.processed_at)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AdminBillingPage() {
  const { data: account, isLoading: accountLoading } = useAccount();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AdminSubscriptionStatus | "all">("all");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);

  const summary = useAdminBillingSummary(Boolean(account?.is_admin));
  const subs = useAdminSubscriptionList({
    q: q.trim() || undefined,
    status,
    include_cancelled: includeCancelled,
    limit: 100,
    offset: 0,
    enabled: Boolean(account?.is_admin),
  });

  const hasFilters = Boolean(q) || status !== "all" || includeCancelled;

  // At-risk watchlist derived from the same subscription list when possible,
  // but we also show a dedicated query for past_due + unpaid even when the
  // user has filtered by a different status.
  const atRiskList = useAdminSubscriptionList({
    status: "past_due",
    include_cancelled: false,
    limit: 50,
    offset: 0,
    enabled: Boolean(account?.is_admin) && (summary.data?.at_risk_count ?? 0) > 0,
  });
  const unpaidList = useAdminSubscriptionList({
    status: "unpaid",
    include_cancelled: false,
    limit: 50,
    offset: 0,
    enabled: Boolean(account?.is_admin) && (summary.data?.mrr_by_status.unpaid ?? 0) > 0,
  });

  const atRiskSubs = useMemo(() => {
    const combined: AdminSubscriptionListItem[] = [];
    if (atRiskList.data?.subscriptions) combined.push(...atRiskList.data.subscriptions);
    if (unpaidList.data?.subscriptions) combined.push(...unpaidList.data.subscriptions);
    return combined;
  }, [atRiskList.data, unpaidList.data]);

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Admin — Billing</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  const summaryData = summary.data;
  const mrrDollars = summaryData ? summaryData.mrr_cents / 100 : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={DollarSign}
        title="Billing"
        description="Customer subscriptions, MRR, and payment health."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              summary.refetch();
              subs.refetch();
            }}
            disabled={summary.isFetching || subs.isFetching}
          >
            {summary.isFetching || subs.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        }
      />

      {/* KPI row */}
      <AdminKpiGrid>
        <AdminKpiCard
          label="MRR"
          value={
            mrrDollars != null
              ? formatUsdFromCents(summaryData!.mrr_cents)
              : "—"
          }
          hint={
            summaryData
              ? `${summaryData.active_count} active subs`
              : undefined
          }
          icon={DollarSign}
          tone="success"
        />
        <AdminKpiCard
          label="Active subs"
          value={summaryData?.active_count ?? "—"}
          icon={Zap}
          tone="success"
        />
        <AdminKpiCard
          label="At risk"
          value={summaryData?.at_risk_count ?? "—"}
          hint={
            summaryData
              ? `${summaryData.mrr_by_status.past_due} past due · ${summaryData.mrr_by_status.unpaid} unpaid`
              : undefined
          }
          icon={AlertTriangle}
          tone={(summaryData?.at_risk_count ?? 0) > 0 ? "danger" : "neutral"}
        />
        <AdminKpiCard
          label="Cancelling"
          value={summaryData?.cancelling_count ?? "—"}
          hint={
            summaryData
              ? `${summaryData.cancelled_last_30d} cancelled · last 30d`
              : undefined
          }
          icon={TrendingUp}
          tone={(summaryData?.cancelling_count ?? 0) > 0 ? "warning" : "neutral"}
        />
      </AdminKpiGrid>

      {/* At-risk watchlist */}
      {atRiskSubs.length > 0 && (
        <AdminSectionCard
          title="At-risk watchlist"
          description="Subscriptions in past_due or unpaid — investigate before Stripe cancels them."
        >
          <div className="space-y-1.5">
            {atRiskSubs.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSubId(s.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-left text-sm hover:bg-red-500/10"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.owner.email ?? "—"}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {s.machine?.slug ?? "(no machine)"}
                  </div>
                </div>
                <AdminStatusPill tone="danger">{s.status}</AdminStatusPill>
                <span className="text-xs text-muted-foreground">
                  period end {s.current_period_end ? relativeShort(s.current_period_end) : "—"}
                </span>
                <span className="text-xs font-medium underline-offset-2 hover:underline">View</span>
              </button>
            ))}
          </div>
        </AdminSectionCard>
      )}

      {/* Top accounts + webhook health row */}
      <div className="grid gap-4 md:grid-cols-2">
        <AdminSectionCard
          title="Top accounts by MRR"
          description="Highest-revenue customers — handle with care."
        >
          {summary.isLoading ? (
            <AdminLoadingRows count={3} />
          ) : !summaryData || summaryData.top_accounts_by_mrr.length === 0 ? (
            <div className="text-xs text-muted-foreground">No active subscriptions yet.</div>
          ) : (
            <div className="space-y-1.5">
              {summaryData.top_accounts_by_mrr.map((a) => (
                <Link
                  key={a.account_id}
                  href={`/v2/admin/accounts?highlight=${a.account_id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.account_name ?? a.account_id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.subscription_count} {a.subscription_count === 1 ? "sub" : "subs"}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">{formatUsdFromCents(a.mrr_cents)}</div>
                </Link>
              ))}
            </div>
          )}
        </AdminSectionCard>

        <AdminSectionCard
          title="Stripe webhook health"
          description="Last 24h webhook volume — drops to zero means misconfigured endpoint."
          actions={
            <button
              type="button"
              onClick={() => setEventsOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {eventsOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Recent events
            </button>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-semibold tabular-nums">
                {summaryData?.stripe_events_last_24h ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">events in last 24h</div>
              {summaryData && summaryData.stripe_events_last_24h === 0 && (
                <AdminStatusPill tone="warning" className="ml-auto">
                  No webhook events in 24h — check Stripe webhook config
                </AdminStatusPill>
              )}
            </div>
            {eventsOpen && <StripeEventsList />}
          </div>
        </AdminSectionCard>
      </div>

      {/* Subscriptions filter */}
      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search machine slug, email, or Stripe sub ID"
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus((v ?? "all") as typeof status)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="past_due">Past due</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="canceled">Cancelled</SelectItem>
            <SelectItem value="incomplete">Incomplete</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
            className="rounded"
          />
          Include cancelled
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setStatus("all");
              setIncludeCancelled(false);
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </AdminFilterBar>

      {/* Subscriptions list */}
      {subs.isLoading ? (
        <AdminLoadingRows count={5} />
      ) : subs.error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline size-4" />
          Failed to load: {subs.error instanceof Error ? subs.error.message : "Unknown error"}
        </div>
      ) : !subs.data || subs.data.subscriptions.length === 0 ? (
        <AdminEmptyState
          icon={CreditCard}
          title="No subscriptions found"
          description={hasFilters ? "Try clearing some filters." : "No subscriptions in the system yet."}
        />
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Showing {subs.data.subscriptions.length} of {subs.data.total}
          </div>
          {subs.data.subscriptions.map((s) => (
            <SubscriptionRow key={s.id} sub={s} onOpen={() => setSelectedSubId(s.id)} />
          ))}
        </div>
      )}

      <SubscriptionDetailDialog
        subscriptionId={selectedSubId}
        onClose={() => setSelectedSubId(null)}
      />
    </div>
  );
}
