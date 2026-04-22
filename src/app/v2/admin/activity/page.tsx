"use client";

/**
 * Admin → Activity Timeline.
 *
 * Operator-facing unified event feed. During an incident the operator
 * should be able to land here, pick a time range, and see everything that
 * happened across Machines, Procurements, Webhooks, Restores, Host
 * maintenance, Backups and Bootstrap validations in one sorted column,
 * click a row to see the full metadata, and click through to the surface
 * that owns the subject for follow-up actions.
 *
 * All data lives in a single /admin/activity endpoint; the page is just
 * filters + a vertical list + a side drawer.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Skeleton } from "@/shared/ui/skeleton";
import { useAccount } from "@/shared/hooks/use-account";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminLoadingRows,
  AdminPageHeader,
  AdminStatusPill,
  relativeShort,
} from "@/v2/components/admin/primitives";
import type { Tone } from "@/v2/components/admin/tones";
import { cn } from "@/shared/lib/utils";
import {
  useAdminActivity,
  type AdminActivityEvent,
  type AdminActivitySeverity,
  type AdminActivitySource,
} from "@/shared/hooks/use-admin-activity";

// ─── Constants ─────────────────────────────────────────────────────────────

type QuickRange = "1h" | "6h" | "24h" | "7d";

const RANGE_TO_MS: Record<QuickRange, number> = {
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

const SOURCE_OPTIONS: Array<{ value: AdminActivitySource; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "machines", label: "Machines" },
  { value: "procurements", label: "Procurements" },
  { value: "webhooks", label: "Webhooks" },
  { value: "restores", label: "Restores" },
  { value: "maintenance", label: "Maintenance" },
  { value: "backups", label: "Backups" },
  { value: "bootstrap_validations", label: "Bootstrap validation" },
];

const SOURCE_LABEL: Record<string, string> = {
  machine: "Machine",
  procurement: "Procurement",
  webhook: "Webhook",
  restore: "Restore",
  maintenance: "Maintenance",
  backup: "Backup",
  bootstrap_validation: "Bootstrap",
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function severityTone(sev: AdminActivitySeverity): Tone {
  if (sev === "error") return "danger";
  if (sev === "warn") return "warning";
  return "success";
}

function severityDotClass(sev: AdminActivitySeverity): string {
  if (sev === "error") return "bg-red-500";
  if (sev === "warn") return "bg-yellow-500";
  return "bg-emerald-500";
}

function subjectHeadline(e: AdminActivityEvent): string {
  const s = e.subject as Record<string, unknown>;
  switch (e.source) {
    case "machine":
      return (s.slug as string) || (s.name as string) || (s.machine_id as string) || "machine";
    case "procurement":
      return `${(s.product_id as string) ?? "?"} @ ${(s.location as string) ?? "?"}`;
    case "webhook": {
      const url = s.webhook_url as string | null;
      return url ? truncateMiddle(url, 60) : (s.webhook_id as string) ?? "webhook";
    }
    case "restore":
      return `artifact ${(s.artifact_id as string)?.slice(0, 8) ?? "?"}`;
    case "maintenance":
      return (s.host_name as string) || (s.host_id as string) || "host";
    case "backup":
      return (
        (s.machine_slug as string) ||
        (s.host_id as string)?.slice(0, 8) ||
        (s.artifact_id as string)?.slice(0, 8) ||
        "backup"
      );
    case "bootstrap_validation":
      return (s.host_name as string) || (s.host_id as string) || "host";
    default:
      return "event";
  }
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.floor((max - 1) / 2);
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

/** Click-through URL for the source surface. Backend doesn't embed URLs. */
function clickThroughHref(e: AdminActivityEvent): string | null {
  const s = e.subject as Record<string, unknown>;
  switch (e.source) {
    case "machine":
      return s.machine_id ? `/v2/admin/machines?highlight=${encodeURIComponent(s.machine_id as string)}` : "/v2/admin/machines";
    case "procurement":
      return "/v2/admin/procurements";
    case "webhook":
      return s.webhook_id ? `/v2/admin/webhooks?highlight=${encodeURIComponent(s.webhook_id as string)}` : "/v2/admin/webhooks";
    case "restore":
    case "backup":
      return "/v2/admin/images";
    case "maintenance":
    case "bootstrap_validation":
      return s.host_id ? `/v2/admin/hosts?highlight=${encodeURIComponent(s.host_id as string)}` : "/v2/admin/hosts";
    default:
      return null;
  }
}

function formatExact(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Event row + drawer ────────────────────────────────────────────────────

function EventRow({
  event,
  onOpen,
}: {
  event: AdminActivityEvent;
  onOpen: () => void;
}) {
  const href = clickThroughHref(event);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/40"
    >
      {/* Timestamp column */}
      <div className="w-20 shrink-0 pt-0.5 text-right">
        <div
          className="text-xs font-medium"
          title={formatExact(event.occurred_at)}
        >
          {relativeShort(event.occurred_at)}
        </div>
        <div className="text-[10px] text-muted-foreground" title={formatExact(event.occurred_at)}>
          {new Date(event.occurred_at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Severity dot */}
      <div className="flex flex-col items-center pt-2">
        <span className={cn("size-2.5 rounded-full ring-2 ring-background", severityDotClass(event.severity))} />
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <AdminStatusPill tone="neutral" className="capitalize">
            {SOURCE_LABEL[event.source] ?? event.source}
          </AdminStatusPill>
          <span className="font-mono text-xs text-muted-foreground">{event.event_type}</span>
          <span className="truncate text-sm font-medium">{subjectHeadline(event)}</span>
          {href && (
            <span className="text-[10px] text-muted-foreground">→ {href.split("?")[0].replace("/v2/admin/", "")}</span>
          )}
        </div>
        {event.message && (
          <div className="truncate text-xs text-muted-foreground">{event.message}</div>
        )}
      </div>

      {/* Severity label on right */}
      <div className="pt-1.5">
        <AdminStatusPill tone={severityTone(event.severity)}>{event.severity}</AdminStatusPill>
      </div>
    </button>
  );
}

function EventDrawer({
  event,
  onClose,
}: {
  event: AdminActivityEvent | null;
  onClose: () => void;
}) {
  const open = Boolean(event);
  const href = event ? clickThroughHref(event) : null;
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {event && (
              <>
                <span className={cn("size-2.5 rounded-full", severityDotClass(event.severity))} />
                <AdminStatusPill tone="neutral" className="capitalize">
                  {SOURCE_LABEL[event.source] ?? event.source}
                </AdminStatusPill>
                <span className="font-mono text-sm">{event.event_type}</span>
              </>
            )}
          </SheetTitle>
          <SheetDescription>
            {event ? formatExact(event.occurred_at) : ""}
          </SheetDescription>
        </SheetHeader>

        {event && (
          <div className="mt-4 space-y-4">
            <section className="rounded-xl border p-4 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Message
              </h3>
              <div className="break-words text-sm">{event.message || "—"}</div>
            </section>

            <section className="rounded-xl border p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Subject
              </h3>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(event.subject, null, 2)}
              </pre>
            </section>

            <section className="rounded-xl border p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Metadata
              </h3>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </section>

            <section className="rounded-xl border p-4 text-xs">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Identity
              </h3>
              <div className="break-all font-mono">id: {event.id}</div>
              <div>
                <span className="text-muted-foreground">occurred_at: </span>
                <span className="font-mono">{event.occurred_at}</span>
              </div>
            </section>

            {href && (
              <div className="flex justify-end">
                <a
                  href={href}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted/50"
                >
                  Open {SOURCE_LABEL[event.source] ?? event.source} →
                </a>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AdminActivityPage() {
  const { data: account, isLoading: accountLoading } = useAccount();

  const [range, setRange] = useState<QuickRange>("24h");
  const [source, setSource] = useState<AdminActivitySource>("all");
  const [severityFilter, setSeverityFilter] = useState<AdminActivitySeverity | "all">("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminActivityEvent | null>(null);
  const limit = 100;

  // Debounce the search box — re-running a merge of 7 sources every keystroke
  // would be wasteful.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  // Reset pagination on filter change
  useEffect(() => {
    setOffset(0);
  }, [range, source, severityFilter, q]);

  // The since parameter moves with the quick range. We pin `until=now` on
  // initial render and let the query drive refetches forward from there.
  const sinceIso = useMemo(() => {
    return new Date(Date.now() - RANGE_TO_MS[range]).toISOString();
  }, [range]);

  const { data, isLoading, error, refetch, isFetching } = useAdminActivity({
    since: sinceIso,
    source,
    q: q || undefined,
    limit,
    offset,
    enabled: Boolean(account?.is_admin),
  });

  const events = useMemo(() => {
    if (!data) return [];
    if (severityFilter === "all") return data.events;
    return data.events.filter((e) => e.severity === severityFilter);
  }, [data, severityFilter]);

  const counts = data?.summary.counts_by_severity ?? { info: 0, warn: 0, error: 0 };
  const hasFilters = q !== "" || source !== "all" || severityFilter !== "all" || range !== "24h";

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Admin — Activity</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Activity}
        title="Activity Timeline"
        description="Everything that happened across the fleet. Use this during an incident to see every cross-cutting event in one sorted column without hopping between Machines, Procurements, Webhooks and Hosts."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        }
      />

      {/* KPI row — click to filter by severity */}
      <AdminKpiGrid>
        <AdminKpiCard
          label="Total events"
          value={data?.total ?? "—"}
          hint={`since ${relativeShort(sinceIso)}`}
          icon={Activity}
        />
        <button type="button" onClick={() => setSeverityFilter((s) => (s === "error" ? "all" : "error"))} className="text-left">
          <AdminKpiCard
            label="Errors"
            value={counts.error ?? 0}
            hint={severityFilter === "error" ? "Filtering — click to clear" : "Click to filter"}
            tone={(counts.error ?? 0) > 0 ? "danger" : "neutral"}
            icon={AlertTriangle}
          />
        </button>
        <button type="button" onClick={() => setSeverityFilter((s) => (s === "warn" ? "all" : "warn"))} className="text-left">
          <AdminKpiCard
            label="Warnings"
            value={counts.warn ?? 0}
            hint={severityFilter === "warn" ? "Filtering — click to clear" : "Click to filter"}
            tone={(counts.warn ?? 0) > 0 ? "warning" : "neutral"}
          />
        </button>
        <button type="button" onClick={() => setSeverityFilter((s) => (s === "info" ? "all" : "info"))} className="text-left">
          <AdminKpiCard
            label="Info"
            value={counts.info ?? 0}
            hint={severityFilter === "info" ? "Filtering — click to clear" : "Click to filter"}
            tone={severityFilter === "info" ? "info" : "neutral"}
            icon={CheckCircle2}
          />
        </button>
      </AdminKpiGrid>

      {/* Quick-range buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Range:</span>
        {(["1h", "6h", "24h", "7d"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              range === r ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            last {r}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <AdminFilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search message, subject, slug, URL…"
            className="pl-9"
          />
        </div>
        <Select value={source} onValueChange={(v) => setSource((v ?? "all") as AdminActivitySource)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {severityFilter !== "all" && (
          <AdminStatusPill tone={severityTone(severityFilter)}>
            severity: {severityFilter}
          </AdminStatusPill>
        )}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQInput("");
              setQ("");
              setSource("all");
              setSeverityFilter("all");
              setRange("24h");
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </AdminFilterBar>

      {/* Timeline */}
      {isLoading ? (
        <AdminLoadingRows count={8} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline size-4" />
          Failed to load activity: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : events.length === 0 ? (
        <AdminEmptyState
          icon={Activity}
          title="No events in range"
          description={hasFilters ? "Try widening the time range or clearing filters." : "No events across the fleet in the selected window."}
        />
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => (
            <EventRow key={e.id} event={e} onOpen={() => setSelected(e)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > limit && (
        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <div>
            Showing {offset + 1}–{Math.min(offset + events.length, data.total)} of {data.total}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={offset === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => o + limit)}
              disabled={offset + limit >= data.total}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
