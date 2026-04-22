"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Skull,
  Webhook as WebhookIcon,
  X,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { toast } from "sonner";
import { useAccount } from "@/shared/hooks/use-account";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminLoadingRows,
  AdminMetric,
  AdminPageHeader,
  AdminStatusPill,
  relativeShort,
} from "@/v2/components/admin/primitives";
import type { Tone } from "@/v2/components/admin/tones";
import { cn } from "@/shared/lib/utils";
import {
  useAdminWebhook,
  useAdminWebhookDelivery,
  useAdminWebhookDeliveryList,
  useAdminWebhookList,
  type AdminDeliveryStatus,
  type AdminWebhookDeliverySummary,
  type AdminWebhookSummary,
} from "@/shared/hooks/use-admin-webhooks";

// ─── Helpers ────────────────────────────────────────────────────────────────

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
      <Copy className="size-3" />
    </button>
  );
}

function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}

function deliveryStatusTone(status: string): Tone {
  switch (status) {
    case "delivered":
      return "success";
    case "failed":
      return "danger";
    case "dead_lettered":
      return "danger";
    case "queued":
      return "info";
    default:
      return "neutral";
  }
}

function deliveryStatusLabel(status: string): string {
  if (status === "dead_lettered") return "dead-lettered";
  return status;
}

// Darker red for dead-lettered so it's visually distinct from regular "failed".
function deliveryStatusPillClass(status: string): string {
  if (status === "dead_lettered") {
    return "bg-red-700/15 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-700/30";
  }
  return "";
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK DETAIL DIALOG
// ═══════════════════════════════════════════════════════════════════════════

function WebhookDetailDialog({
  webhookId,
  onClose,
  onSelectDelivery,
}: {
  webhookId: string | null;
  onClose: () => void;
  onSelectDelivery: (id: string) => void;
}) {
  const open = Boolean(webhookId);
  const { data, isLoading, error, refetch, isFetching } = useAdminWebhook(webhookId);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <WebhookIcon className="size-4 text-muted-foreground" />
            <span className="truncate font-mono text-sm">
              {data ? truncateUrl(data.webhook.url, 56) : "Webhook"}
            </span>
            {data && (
              <AdminStatusPill tone={data.webhook.active ? "success" : "neutral"}>
                {data.webhook.active ? "active" : "disabled"}
              </AdminStatusPill>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {data && <CopyButton value={data.webhook.id} />}
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
            {error instanceof Error ? error.message : "Failed to load webhook"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Summary metrics */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <AdminMetric
                label="Failure count"
                value={data.webhook.failure_count}
                sub={data.webhook.failure_count > 0 ? "Consecutive failures" : undefined}
              />
              <AdminMetric label="Deliveries" value={data.deliveries.length} sub="Last 100" />
              <AdminMetric
                label="Last delivered"
                value={
                  data.webhook.last_delivered_at
                    ? relativeShort(data.webhook.last_delivered_at)
                    : "Never"
                }
              />
              <AdminMetric label="Created" value={relativeShort(data.webhook.created_at)} />
            </div>

            {/* Full URL */}
            <section className="rounded-xl border p-4 space-y-1.5 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Endpoint
              </h3>
              <div className="flex items-center gap-1">
                <CopyButton value={data.webhook.url} />
              </div>
              <div>
                <span className="text-muted-foreground">Secret: </span>
                <span className="font-mono text-xs">{data.webhook.secret_preview}</span>
              </div>
            </section>

            {/* Events */}
            <section className="rounded-xl border p-4 space-y-2 text-sm">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Subscribed events
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {data.webhook.events.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No events</span>
                ) : (
                  data.webhook.events.map((ev) => (
                    <Badge key={ev} variant="outline" className="font-mono text-[11px]">
                      {ev}
                    </Badge>
                  ))
                )}
              </div>
            </section>

            {/* Ownership */}
            <section className="rounded-xl border p-4 space-y-2 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Ownership
              </h3>
              <div>
                <span className="text-muted-foreground">Owner: </span>
                {data.owner.email ?? data.owner.id.slice(0, 8)}
                {data.owner.name ? ` · ${data.owner.name}` : ""}
              </div>
              {data.account && (
                <div>
                  <span className="text-muted-foreground">Account: </span>
                  <span className="font-medium">{data.account.name ?? data.account.slug ?? "—"}</span>
                  {data.account.type && (
                    <Badge variant="outline" className="ml-2 text-xs">{data.account.type}</Badge>
                  )}
                </div>
              )}
            </section>

            {/* Disabled state */}
            {!data.webhook.active && (data.webhook.disabled_at || data.webhook.disable_reason) && (
              <section className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-1.5 text-sm">
                <h3 className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="size-3.5" />
                  Disabled
                </h3>
                {data.webhook.disabled_at && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">At: </span>
                    {relativeShort(data.webhook.disabled_at)}
                  </div>
                )}
                {data.webhook.disable_reason && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Reason: </span>
                    {data.webhook.disable_reason}
                  </div>
                )}
              </section>
            )}

            {/* Delivery history */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent deliveries ({data.deliveries.length})
              </h3>
              {data.deliveries.length === 0 ? (
                <div className="text-xs text-muted-foreground">No delivery attempts yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.deliveries.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectDelivery(d.id);
                      }}
                      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs">{d.event_type}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          attempt {d.attempt}
                          {d.status_code != null ? ` · HTTP ${d.status_code}` : ""}
                          {d.error ? ` · ${d.error.slice(0, 60)}` : ""}
                        </div>
                      </div>
                      <AdminStatusPill
                        tone={deliveryStatusTone(d.status)}
                        className={cn(deliveryStatusPillClass(d.status))}
                      >
                        {deliveryStatusLabel(d.status)}
                      </AdminStatusPill>
                      <span className="w-16 text-right text-xs text-muted-foreground">
                        {formatDuration(d.duration_ms)}
                      </span>
                      <span className="w-16 text-right text-xs text-muted-foreground">
                        {relativeShort(d.created_at)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Refresh
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY DETAIL DIALOG
// ═══════════════════════════════════════════════════════════════════════════

function DeliveryDetailDialog({
  deliveryId,
  onClose,
}: {
  deliveryId: string | null;
  onClose: () => void;
}) {
  const open = Boolean(deliveryId);
  const { data, isLoading, error } = useAdminWebhookDelivery(deliveryId);
  const [payloadOpen, setPayloadOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <WebhookIcon className="size-4 text-muted-foreground" />
            <span className="truncate font-mono text-sm">
              {data?.delivery.event_type ?? "Delivery"}
            </span>
            {data && (
              <AdminStatusPill
                tone={deliveryStatusTone(data.delivery.status)}
                className={cn(deliveryStatusPillClass(data.delivery.status))}
              >
                {deliveryStatusLabel(data.delivery.status)}
              </AdminStatusPill>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {data && <CopyButton value={data.delivery.id} />}
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
            {error instanceof Error ? error.message : "Failed to load delivery"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Summary metrics */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <AdminMetric
                label="Status code"
                value={data.delivery.status_code ?? "—"}
              />
              <AdminMetric label="Attempt" value={data.delivery.attempt} />
              <AdminMetric label="Duration" value={formatDuration(data.delivery.duration_ms)} />
              <AdminMetric label="Created" value={relativeShort(data.delivery.created_at)} />
            </div>

            {/* Identity */}
            <section className="rounded-xl border p-4 space-y-1.5 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Identity
              </h3>
              <div>
                <span className="text-muted-foreground">Event: </span>
                <span className="font-mono text-xs">{data.delivery.event_type}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Webhook: </span>
                <CopyButton value={data.delivery.webhook_id} />
              </div>
              <div>
                <span className="text-muted-foreground">Payload version: </span>
                <span className="font-mono text-xs">{data.delivery.payload_version}</span>
              </div>
            </section>

            {/* Status */}
            <section className="rounded-xl border p-4 space-y-1.5 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <AdminStatusPill
                  tone={deliveryStatusTone(data.delivery.status)}
                  className={cn(deliveryStatusPillClass(data.delivery.status))}
                >
                  {deliveryStatusLabel(data.delivery.status)}
                </AdminStatusPill>
                {data.delivery.success && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="size-3" /> success
                  </span>
                )}
              </div>
              {data.delivery.error && (
                <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-xs text-destructive">
                  {data.delivery.error}
                </div>
              )}
            </section>

            {/* Timing */}
            <section className="rounded-xl border p-4 space-y-1.5 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Timing
              </h3>
              <div>
                <span className="text-muted-foreground">Delivered: </span>
                {data.delivery.delivered_at ? relativeShort(data.delivery.delivered_at) : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Last attempt: </span>
                {data.delivery.last_attempt_at ? relativeShort(data.delivery.last_attempt_at) : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Next attempt: </span>
                {data.delivery.next_attempt_at ? relativeShort(data.delivery.next_attempt_at) : "—"}
              </div>
              {data.delivery.dead_lettered_at && (
                <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                  <Skull className="size-3.5" />
                  <span className="text-muted-foreground">Dead-lettered: </span>
                  {relativeShort(data.delivery.dead_lettered_at)}
                </div>
              )}
            </section>

            {/* Response body */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Response body
              </h3>
              {data.delivery.response_body ? (
                <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {data.delivery.response_body}
                </pre>
              ) : (
                <div className="text-xs text-muted-foreground">No response body captured.</div>
              )}
            </section>

            {/* Request payload */}
            <section className="rounded-xl border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Request payload
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPayloadOpen((v) => !v)}
                >
                  {payloadOpen ? "Hide" : "Show"}
                </Button>
              </div>
              {payloadOpen && (
                <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(data.delivery.payload, null, 2)}
                </pre>
              )}
            </section>

            {/* Associated webhook */}
            {data.webhook && (
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Webhook
                </h3>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">URL: </span>
                  {data.webhook.url && <CopyButton value={data.webhook.url} />}
                </div>
                {data.webhook.active != null && (
                  <div>
                    <span className="text-muted-foreground">Active: </span>
                    <AdminStatusPill tone={data.webhook.active ? "success" : "neutral"}>
                      {data.webhook.active ? "active" : "disabled"}
                    </AdminStatusPill>
                  </div>
                )}
                {data.account && (
                  <div>
                    <span className="text-muted-foreground">Account: </span>
                    <span className="font-medium">{data.account.name ?? data.account.slug ?? "—"}</span>
                  </div>
                )}
                {data.owner && (
                  <div>
                    <span className="text-muted-foreground">Owner: </span>
                    {data.owner.email ?? data.owner.name ?? "—"}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOKS TAB
// ═══════════════════════════════════════════════════════════════════════════

function WebhooksTab({
  onSelectWebhook,
}: {
  onSelectWebhook: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useAdminWebhookList({
    q: q.trim() || undefined,
    active: activeOnly ? true : undefined,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || activeOnly;

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Active webhooks"
          value={data?.summary.active_count ?? "—"}
          hint={data ? `${data.summary.disabled_count} disabled` : undefined}
          icon={WebhookIcon}
          tone="success"
        />
        <AdminKpiCard
          label="Deliveries (24h)"
          value={data?.summary.total_deliveries_24h ?? "—"}
          hint="All webhooks"
        />
        <AdminKpiCard
          label="Failures (24h)"
          value={data?.summary.total_failures_24h ?? "—"}
          tone={data && data.summary.total_failures_24h > 0 ? "warning" : "neutral"}
        />
        <AdminKpiCard
          label="Dead-lettered"
          value={data?.summary.dead_lettered_count ?? "—"}
          tone={data && data.summary.dead_lettered_count > 0 ? "danger" : "neutral"}
          icon={Skull}
        />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search URL, account, or owner email"
            className="pl-9"
          />
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          Active only
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setActiveOnly(false);
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
      </AdminFilterBar>

      {isLoading ? (
        <AdminLoadingRows count={5} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline size-4" />
          Failed to load: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : !data || data.webhooks.length === 0 ? (
        <AdminEmptyState
          icon={WebhookIcon}
          title="No webhooks found"
          description={hasFilters ? "Try clearing some filters." : "No customer has configured a webhook yet."}
        />
      ) : (
        <div className="space-y-2">
          {data.webhooks.map((wh) => (
            <WebhookRow key={wh.id} webhook={wh} onOpen={() => onSelectWebhook(wh.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function WebhookRow({
  webhook,
  onOpen,
}: {
  webhook: AdminWebhookSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-mono text-sm">{truncateUrl(webhook.url, 60)}</h3>
            <AdminStatusPill tone={webhook.active ? "success" : "neutral"}>
              {webhook.active ? "active" : "disabled"}
            </AdminStatusPill>
            {webhook.failure_count > 0 && (
              <AdminStatusPill tone="warning">
                {webhook.failure_count} failures
              </AdminStatusPill>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {webhook.owner.email ?? webhook.owner.id.slice(0, 8)}
            {webhook.account?.name ? ` · ${webhook.account.name}` : webhook.account?.slug ? ` · ${webhook.account.slug}` : ""}
          </div>
          {webhook.events.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {webhook.events.slice(0, 6).map((ev) => (
                <Badge key={ev} variant="outline" className="font-mono text-[10px]">
                  {ev}
                </Badge>
              ))}
              {webhook.events.length > 6 && (
                <Badge variant="outline" className="text-[10px]">
                  +{webhook.events.length - 6}
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <div className="min-w-[70px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">24h sent</div>
            <div className="text-sm font-medium">
              <span className="text-emerald-600 dark:text-emerald-400">{webhook.success_count_24h}</span>
              <span className="text-muted-foreground"> / </span>
              <span className={webhook.failure_count_24h > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                {webhook.failure_count_24h}
              </span>
            </div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last sent</div>
            <div className="text-sm font-medium">
              {webhook.last_delivered_at ? relativeShort(webhook.last_delivered_at) : "never"}
            </div>
          </div>
          <div className="min-w-[70px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
            <div className="text-sm font-medium">{relativeShort(webhook.created_at)}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERIES TAB
// ═══════════════════════════════════════════════════════════════════════════

type QuickRange = "24h" | "7d" | "30d" | "all";

function rangeToSince(range: QuickRange): string | undefined {
  const now = Date.now();
  if (range === "24h") return new Date(now - 24 * 3600_000).toISOString();
  if (range === "7d") return new Date(now - 7 * 24 * 3600_000).toISOString();
  if (range === "30d") return new Date(now - 30 * 24 * 3600_000).toISOString();
  return undefined;
}

function DeliveriesTab({
  onSelectDelivery,
}: {
  onSelectDelivery: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AdminDeliveryStatus>("all");
  const [eventType, setEventType] = useState("");
  const [range, setRange] = useState<QuickRange>("24h");

  const { data, isLoading, error, refetch, isFetching } = useAdminWebhookDeliveryList({
    q: q.trim() || undefined,
    status,
    event_type: eventType.trim() || undefined,
    since: rangeToSince(range),
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || status !== "all" || Boolean(eventType) || range !== "24h";

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Total in range"
          value={data?.total ?? "—"}
          hint={`last ${range === "all" ? "∞" : range}`}
          icon={WebhookIcon}
        />
        <AdminKpiCard
          label="Delivered"
          value={data?.summary.delivered_count ?? "—"}
          tone="success"
        />
        <AdminKpiCard
          label="Failed"
          value={data?.summary.failed_count ?? "—"}
          tone={data && data.summary.failed_count > 0 ? "danger" : "neutral"}
        />
        <AdminKpiCard
          label="Dead-lettered"
          value={data?.summary.dead_lettered_count ?? "—"}
          tone={data && data.summary.dead_lettered_count > 0 ? "danger" : "neutral"}
          icon={Skull}
        />
        <AdminKpiCard
          label="Avg duration"
          value={data ? `${data.summary.avg_duration_ms}ms` : "—"}
        />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search error text or event type"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus((v ?? "all") as AdminDeliveryStatus)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="dead_lettered">Dead-lettered</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          placeholder="Event type"
          className="w-[160px]"
        />
        <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5">
          <Calendar className="ml-1.5 size-3.5 text-muted-foreground" />
          {(["24h", "7d", "30d", "all"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                range === r
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setStatus("all");
              setEventType("");
              setRange("24h");
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
      </AdminFilterBar>

      {isLoading ? (
        <AdminLoadingRows count={6} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline size-4" />
          Failed to load: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : !data || data.deliveries.length === 0 ? (
        <AdminEmptyState
          icon={WebhookIcon}
          title="No deliveries found"
          description={hasFilters ? "Try widening the time range or clearing filters." : "No webhook deliveries in the selected window."}
        />
      ) : (
        <div className="space-y-1.5">
          {data.deliveries.map((d) => (
            <DeliveryRow key={d.id} delivery={d} onOpen={() => onSelectDelivery(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryRow({
  delivery,
  onOpen,
}: {
  delivery: AdminWebhookDeliverySummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            {delivery.event_type}
          </Badge>
          <AdminStatusPill
            tone={deliveryStatusTone(delivery.status)}
            className={cn(deliveryStatusPillClass(delivery.status))}
          >
            {deliveryStatusLabel(delivery.status)}
          </AdminStatusPill>
          {delivery.attempt > 1 && (
            <Badge variant="outline" className="text-[10px]">
              attempt {delivery.attempt}
            </Badge>
          )}
          {delivery.status_code != null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              HTTP {delivery.status_code}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {delivery.webhook_url ? truncateUrl(delivery.webhook_url, 80) : delivery.webhook_id.slice(0, 8)}
        </div>
        {delivery.error && (
          <div className="truncate text-[11px] text-red-600 dark:text-red-400">
            {delivery.error}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-right">
        <div className="min-w-[60px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</div>
          <div className="text-sm font-medium">{formatDuration(delivery.duration_ms)}</div>
        </div>
        <div className="min-w-[70px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
          <div className="text-sm font-medium">{relativeShort(delivery.created_at)}</div>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminWebhooksPage() {
  const { data: account, isLoading: accountLoading } = useAccount();
  const [tab, setTab] = useState<"webhooks" | "deliveries">("webhooks");
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Admin — Webhooks</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={WebhookIcon}
        title="Webhooks"
        description="Fleet-wide view of customer webhook configurations plus delivery history across all accounts. Use this to diagnose failing subscribers and spot dead-letter buildup."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(((v as string) ?? "webhooks") as typeof tab)}>
        <TabsList>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
        </TabsList>
        <TabsContent value="webhooks" className="mt-4">
          <WebhooksTab onSelectWebhook={setSelectedWebhookId} />
        </TabsContent>
        <TabsContent value="deliveries" className="mt-4">
          <DeliveriesTab onSelectDelivery={setSelectedDeliveryId} />
        </TabsContent>
      </Tabs>

      <WebhookDetailDialog
        webhookId={selectedWebhookId}
        onClose={() => setSelectedWebhookId(null)}
        onSelectDelivery={(id) => {
          setSelectedDeliveryId(id);
        }}
      />
      <DeliveryDetailDialog
        deliveryId={selectedDeliveryId}
        onClose={() => setSelectedDeliveryId(null)}
      />
    </div>
  );
}
