"use client";

import { useMemo } from "react";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  AdminEmptyState,
  AdminKpiCard,
  AdminKpiGrid,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
  HelpTip,
  relativeShort,
} from "@/v2/components/admin/primitives";
import { useFleetControlPlaneServices } from "@/shared/hooks/use-fleet";

export default function AdminControlPlanePage() {
  const servicesQuery = useFleetControlPlaneServices();
  const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);

  const stats = useMemo(
    () => ({
      total: services.length,
      stale: services.filter((s) => s.stale).length,
      critical: services.filter((s) => s.critical).length,
      leased: services.filter((s) => s.lease_owner).length,
    }),
    [services],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, typeof services>();
    for (const s of services) {
      const existing = map.get(s.service) ?? [];
      existing.push(s);
      map.set(s.service, existing);
    }
    for (const [service, arr] of map) {
      map.set(service, arr.slice().sort((a, b) => a.scope.localeCompare(b.scope)));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [services]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Activity}
        title="Control plane"
        description="Reconciler service leases, last-run timestamps and checkpoints — the heartbeat of the platform."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => servicesQuery.refetch()}
            disabled={servicesQuery.isFetching}
          >
            {servicesQuery.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        }
      />

      <AdminKpiGrid>
        <AdminKpiCard label="Services" value={stats.total} />
        <AdminKpiCard label="Critical" value={stats.critical} />
        <AdminKpiCard label="Held leases" value={stats.leased} tone="info" />
        <AdminKpiCard label="Stale" value={stats.stale} tone={stats.stale > 0 ? "warning" : "success"} />
      </AdminKpiGrid>

      {servicesQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <AdminEmptyState icon={Activity} title="No control-plane services yet" />
      ) : (
        <div className="space-y-3">
          {grouped.map(([service, rows]) => (
            <AdminSectionCard key={service} title={service} description={rows[0].description} padding="tight">
              <div className="space-y-2">
                {rows.map((row) => (
                  <div key={row.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">scope: {row.scope}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.mode} · {row.critical ? "critical" : "non-critical"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AdminStatusPill tone={row.stale ? "warning" : "success"}>
                          {row.stale ? "stale" : "fresh"}
                        </AdminStatusPill>
                        <HelpTip label="What does stale/fresh mean?">
                          <div className="font-semibold mb-0.5">Stale vs fresh</div>
                          <div className="text-background/80">
                            A service is <b>fresh</b> if it completed a pass recently (within its expected interval).
                            <b> Stale</b> means it hasn&apos;t run in too long — the control-plane worker may be down,
                            crashing, or blocked. Critical services being stale is an actionable alert.
                          </div>
                        </HelpTip>
                        <AdminStatusPill tone={row.lease_owner ? "info" : "neutral"}>
                          lease {row.lease_owner ? "held" : "idle"}
                        </AdminStatusPill>
                        <HelpTip label="What is a lease?">
                          <div className="font-semibold mb-0.5">Service lease</div>
                          <div className="text-background/80">
                            Only one worker process can run a periodic service at a time. The lease is the lock
                            that prevents concurrent runs. <b>Idle</b> = nothing is running right now, ready for next tick.
                            <b> Held</b> = a worker is actively executing this pass. A stuck lease (held long past
                            <code>lease_expires_at</code>) often means the worker crashed mid-task.
                          </div>
                        </HelpTip>
                        {row.critical ? (
                          <>
                            <AdminStatusPill tone="accent">critical</AdminStatusPill>
                            <HelpTip label="Why is this critical?">
                              <div className="font-semibold mb-0.5">Critical service</div>
                              <div className="text-background/80">
                                This service being stale impacts the user-facing platform (provisioning,
                                routing, billing). Non-critical services can be stale temporarily without
                                direct user impact.
                              </div>
                            </HelpTip>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <Metric label="Lease owner" value={row.lease_owner ?? "none"} />
                      <Metric label="Lease expires" value={row.lease_expires_at ? relativeShort(row.lease_expires_at) : "n/a"} />
                      <Metric label="Last started" value={row.last_started_at ? relativeShort(row.last_started_at) : "n/a"} />
                      <Metric
                        label="Last complete"
                        value={row.last_completed_at ? relativeShort(row.last_completed_at) : "n/a"}
                      />
                    </div>
                    {Object.keys(row.checkpoint).length > 0 ? (
                      <pre className="overflow-x-auto rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
                        {JSON.stringify(row.checkpoint, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </AdminSectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate text-sm">{value}</div>
    </div>
  );
}
