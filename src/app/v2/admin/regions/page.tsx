"use client";

import { useMemo } from "react";
import { Cpu, Globe2, HardDrive, Loader2, MemoryStick, RefreshCw, Server } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  AdminEmptyState,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMetric,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
  AdminUsageBar,
} from "@/v2/components/admin/primitives";
import { admissionStateTone, sellabilityStateTone } from "@/v2/components/admin/tones";
import { useFleetClusters, useFleetHosts, useFleetRegions } from "@/shared/hooks/use-fleet";

export default function AdminRegionsPage() {
  const regionsQuery = useFleetRegions();
  const hostsQuery = useFleetHosts();
  const clustersQuery = useFleetClusters();
  const regions = useMemo(() => regionsQuery.data ?? [], [regionsQuery.data]);
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const clusters = useMemo(() => clustersQuery.data ?? [], [clustersQuery.data]);

  const hostsByRegion = useMemo(() => {
    const map = new Map<string, typeof hosts>();
    for (const h of hosts) {
      const arr = map.get(h.region) ?? [];
      arr.push(h);
      map.set(h.region, arr);
    }
    return map;
  }, [hosts]);

  const clustersByRegion = useMemo(() => {
    const map = new Map<string, typeof clusters>();
    for (const cluster of clusters) {
      const arr = map.get(cluster.region) ?? [];
      arr.push(cluster);
      map.set(cluster.region, arr);
    }
    return map;
  }, [clusters]);

  const totals = useMemo(
    () => ({
      active: regions.filter((r) => r.active).length,
      total: regions.length,
      open: regions.filter((r) => r.admission_state === "open").length,
      sellable: regions.filter((r) => r.sellability_state === "sellable").length,
    }),
    [regions],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Globe2}
        title="Regions"
        description="Top-level geographic buckets. Hosts live inside a region at a specific datacenter location."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              regionsQuery.refetch();
              hostsQuery.refetch();
              clustersQuery.refetch();
            }}
            disabled={regionsQuery.isFetching || hostsQuery.isFetching || clustersQuery.isFetching}
          >
            {regionsQuery.isFetching || hostsQuery.isFetching || clustersQuery.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        }
      />

      <AdminKpiGrid>
        <AdminKpiCard icon={Globe2} label="Regions" value={`${totals.active}/${totals.total}`} hint="active / defined" />
        <AdminKpiCard label="Open for admission" value={totals.open} tone={totals.open === totals.active ? "success" : "warning"} />
        <AdminKpiCard label="Sellable" value={totals.sellable} tone={totals.sellable === totals.active ? "success" : "warning"} />
        <AdminKpiCard icon={Server} label="Hosts" value={hosts.length} />
      </AdminKpiGrid>

      {regionsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : regions.length === 0 ? (
        <AdminEmptyState icon={Globe2} title="No regions configured" description="Seed src/shared/lib/regions.ts and re-run db:push" />
      ) : (
        <div className="space-y-3">
          {regions.map((region) => {
            const regionHosts = hostsByRegion.get(region.id) ?? [];
            const regionClusters = clustersByRegion.get(region.id) ?? [];
            const vcpuPct = region.total_vcpu > 0 ? Math.round((region.used_vcpu / region.total_vcpu) * 100) : 0;
            const memPct = region.total_memory_gb > 0 ? Math.round((region.used_memory_gb / region.total_memory_gb) * 100) : 0;
            const diskPct = region.total_disk_gb > 0 ? Math.round((region.used_disk_gb / region.total_disk_gb) * 100) : 0;
            return (
              <AdminSectionCard key={region.id} padding="tight">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-semibold">{region.label}</div>
                        <span className="font-mono text-xs text-muted-foreground">{region.id}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {region.continent} · {region.active ? "active" : "inactive"} · {region.host_count} host{region.host_count === 1 ? "" : "s"} ({region.active_schedulable_host_count} schedulable)
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AdminStatusPill tone={admissionStateTone(region.admission_state)}>
                        admission {region.admission_state}
                      </AdminStatusPill>
                      <AdminStatusPill tone={sellabilityStateTone(region.sellability_state)}>
                        {region.sellability_state.replace(/_/g, " ")}
                      </AdminStatusPill>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <UsageBlock label="vCPU" icon={Cpu} used={region.used_vcpu} total={region.total_vcpu} pct={vcpuPct} />
                    <UsageBlock label="Memory" icon={MemoryStick} used={region.used_memory_gb} total={region.total_memory_gb} pct={memPct} unit="GB" />
                    <UsageBlock label="Disk" icon={HardDrive} used={region.used_disk_gb} total={region.total_disk_gb} pct={diskPct} unit="GB" />
                  </div>

                  <div className="grid gap-3 text-xs sm:grid-cols-4">
                    <AdminMetric label="Clusters" value={regionClusters.length} />
                    <AdminMetric label="Available vCPU" value={region.available_vcpu} />
                    <AdminMetric label="Available memory" value={`${region.available_memory_gb} GB`} />
                    <AdminMetric label="Available disk" value={`${region.available_disk_gb} GB`} />
                    <AdminMetric label="Utilization score" value={`${(region.utilization_score / 100).toFixed(1)}%`} />
                  </div>

                  {regionClusters.length > 0 ? (
                    <div className="rounded-lg border bg-muted/20 p-2.5">
                      <div className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">Clusters in region</div>
                      <div className="flex flex-wrap gap-1.5">
                        {regionClusters.map((cluster) => (
                          <span
                            key={cluster.id}
                            className="rounded border bg-background px-2 py-0.5 font-mono text-[11px]"
                            title={`${cluster.host_count} host(s) · ${cluster.incus_cluster_name}`}
                          >
                            {cluster.name}
                            <span className="ml-1 text-muted-foreground">({cluster.incus_cluster_name})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {regionHosts.length > 0 ? (
                    <div className="rounded-lg border bg-muted/20 p-2.5">
                      <div className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">Hosts in region</div>
                      <div className="flex flex-wrap gap-1.5">
                        {regionHosts.map((h) => (
                          <span
                            key={h.id}
                            className="rounded border bg-background px-2 py-0.5 font-mono text-[11px]"
                            title={`${h.status} · ${h.host_class} · ${h.location}`}
                          >
                            {h.name}
                            <span className="ml-1 text-muted-foreground">({h.location})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </AdminSectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UsageBlock({
  label,
  icon: Icon,
  used,
  total,
  pct,
  unit,
}: {
  label: string;
  icon: typeof Cpu;
  used: number;
  total: number;
  pct: number;
  unit?: string;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3" />
          {label}
        </span>
        <span className="text-xs font-medium tabular-nums">{pct}%</span>
      </div>
      <div className="text-sm font-medium">
        {used}
        {unit ? ` ${unit}` : ""} / {total}
        {unit ? ` ${unit}` : ""}
      </div>
      <AdminUsageBar used={used} total={total} />
    </div>
  );
}
