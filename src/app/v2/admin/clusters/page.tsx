"use client";

import { useMemo } from "react";
import { CircuitBoard, Cpu, HardDrive, Loader2, MemoryStick, RefreshCw, Server } from "lucide-react";
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
import { useFleetClusters, useFleetHosts } from "@/shared/hooks/use-fleet";

export default function AdminClustersPage() {
  const clustersQuery = useFleetClusters();
  const hostsQuery = useFleetHosts();
  const clusters = useMemo(() => clustersQuery.data ?? [], [clustersQuery.data]);
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);

  const totals = useMemo(
    () => ({
      total: clusters.length,
      active: clusters.filter((cluster) => cluster.active_host_count > 0).length,
      members: clusters.reduce((sum, cluster) => sum + cluster.host_count, 0),
      schedulable: clusters.reduce((sum, cluster) => sum + cluster.active_schedulable_host_count, 0),
    }),
    [clusters],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={CircuitBoard}
        title="Clusters"
        description="Region-level Incus cluster groups. One cluster per region today, more later."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              clustersQuery.refetch();
              hostsQuery.refetch();
            }}
            disabled={clustersQuery.isFetching || hostsQuery.isFetching}
          >
            {clustersQuery.isFetching || hostsQuery.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        }
      />

      <AdminKpiGrid>
        <AdminKpiCard icon={CircuitBoard} label="Clusters" value={`${totals.active}/${totals.total}`} hint="active / defined" />
        <AdminKpiCard icon={Server} label="Hosts" value={totals.members} hint={`${totals.schedulable} schedulable`} />
        <AdminKpiCard icon={Cpu} label="vCPU used" value={clusters.reduce((sum, cluster) => sum + cluster.used_vcpu, 0)} />
        <AdminKpiCard icon={MemoryStick} label="RAM used" value={`${clusters.reduce((sum, cluster) => sum + cluster.used_memory_gb, 0)} GB`} />
      </AdminKpiGrid>

      {clustersQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : clusters.length === 0 ? (
        <AdminEmptyState icon={CircuitBoard} title="No clusters derived yet" description="Create or register a host to seed the first region cluster." />
      ) : (
        <div className="space-y-3">
          {clusters.map((cluster) => {
            const clusterHosts = hosts.filter((host) => host.cluster.id === cluster.id);
            const vcpuPct = cluster.total_vcpu > 0 ? Math.round((cluster.used_vcpu / cluster.total_vcpu) * 100) : 0;
            const memPct = cluster.total_memory_gb > 0 ? Math.round((cluster.used_memory_gb / cluster.total_memory_gb) * 100) : 0;
            const diskPct = cluster.total_disk_gb > 0 ? Math.round((cluster.used_disk_gb / cluster.total_disk_gb) * 100) : 0;

            return (
              <AdminSectionCard key={cluster.id} padding="tight">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-semibold">{cluster.name}</div>
                        <span className="font-mono text-xs text-muted-foreground">{cluster.id}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {cluster.region_label} · Incus cluster <span className="font-mono">{cluster.incus_cluster_name}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AdminStatusPill tone={admissionStateTone(cluster.admission_state)}>
                        admission {cluster.admission_state}
                      </AdminStatusPill>
                      <AdminStatusPill tone={sellabilityStateTone(cluster.sellability_state)}>
                        {cluster.sellability_state.replace(/_/g, " ")}
                      </AdminStatusPill>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <UsageBlock label="vCPU" icon={Cpu} used={cluster.used_vcpu} total={cluster.total_vcpu} pct={vcpuPct} />
                    <UsageBlock label="Memory" icon={MemoryStick} used={cluster.used_memory_gb} total={cluster.total_memory_gb} pct={memPct} unit="GB" />
                    <UsageBlock label="Disk" icon={HardDrive} used={cluster.used_disk_gb} total={cluster.total_disk_gb} pct={diskPct} unit="GB" />
                  </div>

                  <div className="grid gap-3 text-xs sm:grid-cols-4">
                    <AdminMetric label="Hosts" value={cluster.host_count} />
                    <AdminMetric label="Active hosts" value={cluster.active_host_count} />
                    <AdminMetric label="Schedulable hosts" value={cluster.active_schedulable_host_count} />
                    <AdminMetric label="Incus members" value={cluster.member_names.length} />
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-2.5">
                    <div className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">Hosts in cluster</div>
                    <div className="flex flex-wrap gap-1.5">
                      {clusterHosts.map((host) => (
                        <span
                          key={host.id}
                          className="rounded border bg-background px-2 py-0.5 font-mono text-[11px]"
                          title={`${host.status} · ${host.location} · member ${host.cluster.incus_member_name}`}
                        >
                          {host.name}
                          <span className="ml-1 text-muted-foreground">({host.cluster.incus_member_name})</span>
                        </span>
                      ))}
                    </div>
                  </div>
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
