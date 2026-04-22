"use client";

import { useMemo } from "react";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  AdminEmptyState,
  AdminKpiCard,
  AdminKpiGrid,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
} from "@/v2/components/admin/primitives";
import { configAuditTone, driftStatusTone } from "@/v2/components/admin/tones";
import { useFleetConfigAudit, useFleetHostAudit } from "@/shared/hooks/use-fleet";

export default function AdminAuditPage() {
  const configAudit = useFleetConfigAudit();
  const hostAudit = useFleetHostAudit();

  const orderedChecks = useMemo(() => {
    if (!configAudit.data) return [];
    return configAudit.data.checks.slice().sort((a, b) => {
      const order = { error: 0, warning: 1, ok: 2 } as const;
      return order[a.severity] - order[b.severity] || a.key.localeCompare(b.key);
    });
  }, [configAudit.data]);

  const refreshing = configAudit.isFetching || hostAudit.isFetching;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={ShieldCheck}
        title="Audit"
        description="Fleet config posture + host validation and drift. Start here when something looks off."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              configAudit.refetch();
              hostAudit.refetch();
            }}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        }
      />

      <AdminKpiGrid>
        <AdminKpiCard
          label="Config status"
          value={configAudit.data?.status ?? "—"}
          tone={configAuditTone(configAudit.data?.status ?? "ok")}
        />
        <AdminKpiCard
          label="Config errors"
          value={configAudit.data?.counts.error ?? 0}
          tone={(configAudit.data?.counts.error ?? 0) > 0 ? "danger" : "success"}
        />
        <AdminKpiCard
          label="Config warnings"
          value={configAudit.data?.counts.warning ?? 0}
          tone={(configAudit.data?.counts.warning ?? 0) > 0 ? "warning" : "success"}
        />
        <AdminKpiCard
          label="Blocking drift hosts"
          value={hostAudit.data?.summary.blocking_drift_hosts ?? 0}
          tone={(hostAudit.data?.summary.blocking_drift_hosts ?? 0) > 0 ? "danger" : "success"}
        />
      </AdminKpiGrid>

      <AdminSectionCard
        title="Config audit"
        description="Environment bindings and resource integration"
        actions={
          configAudit.data ? (
            <AdminStatusPill tone={configAuditTone(configAudit.data.status)}>
              {configAudit.data.status}
            </AdminStatusPill>
          ) : null
        }
      >
        {configAudit.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : orderedChecks.length === 0 ? (
          <AdminEmptyState title="No config audit results" />
        ) : (
          <div className="divide-y">
            {orderedChecks.map((check) => (
              <div key={check.key} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{check.key}</div>
                  <div className="text-xs text-muted-foreground">{check.message}</div>
                  {check.details ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70 break-all">{check.details}</div>
                  ) : null}
                </div>
                <AdminStatusPill tone={configAuditTone(check.severity)}>{check.severity}</AdminStatusPill>
              </div>
            ))}
          </div>
        )}
      </AdminSectionCard>

      <AdminSectionCard title="Host validation audit" description="Where each host sits on bootstrap and drift policy">
        {hostAudit.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : hostAudit.data ? (
          <div className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <AuditMetric label="Total" value={hostAudit.data.summary.total_hosts} />
              <AuditMetric label="Schedulable" value={hostAudit.data.summary.active_schedulable_hosts} />
              <AuditMetric label="Bootstrapping" value={hostAudit.data.summary.bootstrapping_hosts} />
              <AuditMetric label="Pending" value={hostAudit.data.summary.pending_validation_hosts} />
              <AuditMetric label="Quarantined" value={hostAudit.data.summary.quarantined_hosts} />
              <AuditMetric
                label="Blocking drift"
                value={hostAudit.data.summary.blocking_drift_hosts}
                danger={hostAudit.data.summary.blocking_drift_hosts > 0}
              />
            </div>
            {hostAudit.data.pending_validation.length > 0 ? (
              <AuditGroup
                title="Pending validation"
                items={hostAudit.data.pending_validation.map((host) => ({
                  id: host.id,
                  label: host.name,
                  hint: host.status,
                  tone: "warning" as const,
                }))}
              />
            ) : null}
            {hostAudit.data.blocking_drift.length > 0 ? (
              <AuditGroup
                title="Blocking drift"
                items={hostAudit.data.blocking_drift.map((host) => ({
                  id: host.id,
                  label: host.name,
                  hint: host.quarantined ? "quarantined" : undefined,
                  tone: driftStatusTone("blocking_drift"),
                }))}
              />
            ) : null}
            {hostAudit.data.quarantined.length > 0 ? (
              <AuditGroup
                title="Quarantined"
                items={hostAudit.data.quarantined.map((host) => ({
                  id: host.id,
                  label: host.name,
                  hint: host.unschedulable_reason ?? undefined,
                  tone: driftStatusTone(host.drift_status),
                }))}
              />
            ) : null}
            {hostAudit.data.warning_drift.length > 0 ? (
              <AuditGroup
                title="Warning drift"
                items={hostAudit.data.warning_drift.map((host) => ({
                  id: host.id,
                  label: host.name,
                  tone: driftStatusTone("warning_drift"),
                }))}
              />
            ) : null}
            {hostAudit.data.pending_validation.length === 0 &&
            hostAudit.data.blocking_drift.length === 0 &&
            hostAudit.data.warning_drift.length === 0 &&
            hostAudit.data.quarantined.length === 0 ? (
              <div className="rounded-lg border bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                All hosts are validated and in policy.
              </div>
            ) : null}
          </div>
        ) : (
          <AdminEmptyState title="No host audit data" />
        )}
      </AdminSectionCard>
    </div>
  );
}

function AuditMetric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${danger ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
    </div>
  );
}

function AuditGroup<T extends { id: string; label: string; hint?: string; tone: "success" | "warning" | "danger" | "info" | "neutral" | "accent" }>({
  title,
  items,
}: {
  title: string;
  items: T[];
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <AdminStatusPill key={item.id} tone={item.tone}>
            {item.label}
            {item.hint ? ` · ${item.hint}` : ""}
          </AdminStatusPill>
        ))}
      </div>
    </div>
  );
}
