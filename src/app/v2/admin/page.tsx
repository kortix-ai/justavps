"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CircuitBoard,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Globe2,
  LayoutDashboard,
  MemoryStick,
  Network,
  Server,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { buttonVariants } from "@/shared/ui/button";
import { deriveClusterRef } from "@/shared/lib/fleet-clusters";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { api } from "@/shared/hooks/api-client";
import { ADMIN_NAV } from "@/v2/components/admin/nav";
import {
  AdminKpiCard,
  AdminKpiGrid,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
} from "@/v2/components/admin/primitives";
import {
  admissionStateTone,
  hostStatusTone,
  machineStatusTone,
  sellabilityStateTone,
} from "@/v2/components/admin/tones";
import {
  useFleetConfigAudit,
  useFleetControlPlaneServices,
  useFleetHostAudit,
  useFleetHosts,
  useFleetProcurementRecommendations,
  useFleetProcurements,
  useFleetRegions,
  type FleetHost,
  type FleetRegion,
} from "@/shared/hooks/use-fleet";

type Attention = {
  id: string;
  label: string;
  count: number;
  tone: "danger" | "warning" | "info";
  href: string;
  hint?: string;
};

export default function AdminOverviewPage() {
  const hosts = useFleetHosts();
  const regions = useFleetRegions();
  const hostAudit = useFleetHostAudit();
  const configAudit = useFleetConfigAudit();
  const procurements = useFleetProcurements();
  const recommendations = useFleetProcurementRecommendations();
  const services = useFleetControlPlaneServices();

  const loading =
    hosts.isLoading || regions.isLoading || hostAudit.isLoading || configAudit.isLoading;

  const hostList = hosts.data ?? [];
  const regionList = regions.data ?? [];
  const summary = hostAudit.data?.summary;
  const staleServices = (services.data ?? []).filter((s) => s.stale);
  const criticalStale = staleServices.filter((s) => s.critical);
  const configErrors = configAudit.data?.counts.error ?? 0;
  const configWarnings = configAudit.data?.counts.warning ?? 0;
  const openProcurements = (procurements.data ?? []).filter((p) => p.resolved_at === null);
  const awaitingApproval = openProcurements.filter((p) => p.status === "requested");

  const attention: Attention[] = [];
  if (configErrors > 0) attention.push({ id: "cfg-err", label: "Config errors", count: configErrors, tone: "danger", href: "/v2/admin/audit", hint: "Fix before shipping" });
  if ((summary?.blocking_drift_hosts ?? 0) > 0) attention.push({ id: "drift", label: "Hosts with blocking drift", count: summary!.blocking_drift_hosts, tone: "danger", href: "/v2/admin/audit" });
  if (criticalStale.length > 0) attention.push({ id: "svc", label: "Critical services stale", count: criticalStale.length, tone: "danger", href: "/v2/admin/control-plane", hint: criticalStale.map((s) => s.service).join(", ") });
  if ((summary?.quarantined_hosts ?? 0) > 0) attention.push({ id: "quarantine", label: "Quarantined hosts", count: summary!.quarantined_hosts, tone: "warning", href: "/v2/admin/hosts" });
  if ((summary?.pending_validation_hosts ?? 0) > 0) attention.push({ id: "pending", label: "Hosts pending validation", count: summary!.pending_validation_hosts, tone: "warning", href: "/v2/admin/hosts" });
  if (awaitingApproval.length > 0) attention.push({ id: "proc", label: "Procurements awaiting approval", count: awaitingApproval.length, tone: "info", href: "/v2/admin/procurements" });
  if (configWarnings > 0) attention.push({ id: "cfg-warn", label: "Config warnings", count: configWarnings, tone: "warning", href: "/v2/admin/audit" });
  if ((summary?.warning_drift_hosts ?? 0) > 0) attention.push({ id: "warn-drift", label: "Hosts with warning drift", count: summary!.warning_drift_hosts, tone: "warning", href: "/v2/admin/audit" });

  const allClear = !loading && attention.length === 0;

  const totalHosts = hostList.length;
  const totalClusters = new Set(
    hostList.map((host) => (host.cluster?.id ?? deriveClusterRef({ region: host.region, hostName: host.name, metadata: host.metadata }).id)),
  ).size;
  const activeHosts = hostList.filter((h) => h.status === "active").length;
  const schedulable = hostList.filter((h) => h.status === "active" && h.scheduler.schedulable !== false).length;
  const totalVcpu = hostList.reduce((s, h) => s + (h.total_vcpu ?? 0), 0);
  const usedVcpu = hostList.reduce((s, h) => s + h.used_vcpu, 0);
  const totalRam = hostList.reduce((s, h) => s + (h.total_memory_gb ?? 0), 0);
  const usedRam = hostList.reduce((s, h) => s + h.used_memory_gb, 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Fleet Overview"
        description="What needs your attention right now — and the rest of the fleet at a glance."
      />

      {/* ATTENTION RAIL — primary real estate */}
      {loading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : allClear ? (
        <AllClearBanner />
      ) : (
        <AttentionRail items={attention} />
      )}

      {/* FLEET TOPOLOGY — Region → Host → Machine hierarchy */}
      <AdminSectionCard
        title="Fleet topology"
        description="Live Region → Cluster → Host → Machine hierarchy"
        actions={
          <Link
            href="/v2/admin/clusters"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 gap-1 text-xs")}
          >
            <Network className="size-3" /> Clusters
          </Link>
        }
      >
        <FleetTopology
          regions={regionList}
          hosts={hostList}
          loading={loading}
        />
      </AdminSectionCard>

      {/* CAPACITY — secondary, calm */}
      <AdminSectionCard
        title="Capacity"
        description="Current fleet footprint"
        actions={
          <Link
            href="/v2/admin/hosts"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 gap-1 text-xs")}
          >
            Hosts <ArrowRight className="size-3" />
          </Link>
        }
      >
        <AdminKpiGrid>
          <AdminKpiCard
            icon={Server}
            label="Active hosts"
            value={`${activeHosts}/${totalHosts}`}
            hint={`${schedulable} schedulable`}
            tone={activeHosts > 0 && schedulable === activeHosts ? "success" : activeHosts === 0 ? "warning" : "neutral"}
          />
          <AdminKpiCard
            icon={Cpu}
            label="vCPU used"
            value={`${usedVcpu}/${totalVcpu}`}
            hint={totalVcpu > 0 ? `${Math.round((usedVcpu / totalVcpu) * 100)}% utilization` : "—"}
          />
          <AdminKpiCard
            icon={MemoryStick}
            label="RAM used"
            value={`${usedRam}/${totalRam} GB`}
          />
          <AdminKpiCard
            icon={Globe2}
            label="Regions"
            value={regionList.length}
            hint={`${regionList.filter((r) => r.admission_state === "open").length} open`}
          />
          <AdminKpiCard label="Clusters" value={totalClusters} hint="Incus clusters" />
        </AdminKpiGrid>
      </AdminSectionCard>

      {/* JUMP TO — tertiary, compact nav */}
      <AdminSectionCard title="Jump to" padding="tight">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ADMIN_NAV.filter((item) => item.href !== "/v2/admin").map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-3 rounded-xl border p-3 transition-colors hover:border-foreground/20 hover:bg-muted/40"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.description}</div>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground/40 group-hover:text-foreground" />
              </Link>
            );
          })}
        </div>
      </AdminSectionCard>

      {/* RECOMMENDATIONS — tertiary, only if present */}
      {recommendations.data && recommendations.data.length > 0 && (
        <AdminSectionCard
          title="Capacity recommendations"
          description="Reserve-aware planner suggestions"
          actions={
            <Link
              href="/v2/admin/procurements"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
            >
              View all
            </Link>
          }
        >
          <div className="space-y-1.5">
            {recommendations.data.slice(0, 3).map((rec) => (
              <div
                key={rec.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{rec.region_label}</div>
                  <div className="truncate text-xs text-muted-foreground">{rec.summary}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {rec.current_host_class} → {rec.recommended_host_class}
                </div>
              </div>
            ))}
          </div>
        </AdminSectionCard>
      )}
    </div>
  );
}

function AllClearBanner() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
      <div className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4" />
      </div>
      <div>
        <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">All clear</div>
        <div className="text-xs text-muted-foreground">
          No blocking issues. Hosts are healthy, services are fresh, procurements are flowing.
        </div>
      </div>
    </div>
  );
}

function AttentionRail({ items }: { items: Attention[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <AlertTriangle className="size-3.5 text-yellow-500" />
        Needs attention
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <AttentionCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function AttentionCard({ item }: { item: Attention }) {
  const toneClass =
    item.tone === "danger"
      ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400"
      : item.tone === "warning"
      ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400"
      : "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400";
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-3 rounded-xl border p-3 transition-colors hover:brightness-110",
        toneClass,
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/60">
        <AttentionIcon id={item.id} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold tabular-nums leading-none">{item.count}</span>
          <span className="text-sm font-medium leading-tight">{item.label}</span>
        </div>
        {item.hint ? (
          <div className="mt-0.5 truncate text-xs opacity-70">{item.hint}</div>
        ) : null}
      </div>
      <ArrowRight className="size-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

// ─── Fleet topology diagram ───────────────────────────────────────────────

type TopoMachine = {
  id: string;
  slug: string;
  status: string;
  baremetal_host_id: string | null;
};

type TopoMachinesResponse = {
  total: number;
  limit: number;
  offset: number;
  machines: TopoMachine[];
};

function useTopologyMachines(enabled = true) {
  return useQuery({
    queryKey: ["admin", "topology-machines"],
    queryFn: () =>
      api.get<TopoMachinesResponse>(
        "/admin/machines?limit=500&status=ready,provisioning,stopped,error",
      ),
    enabled,
    refetchInterval: 20_000,
    refetchOnWindowFocus: false,
  });
}

function hostCluster(host: FleetHost) {
  return host.cluster ?? deriveClusterRef({
    region: host.region,
    hostName: host.name,
    metadata: host.metadata,
  });
}

function FleetTopology({
  regions,
  hosts,
  loading,
}: {
  regions: FleetRegion[];
  hosts: FleetHost[];
  loading: boolean;
}) {
  const machinesQuery = useTopologyMachines();
  const machines = useMemo(() => machinesQuery.data?.machines ?? [], [machinesQuery.data?.machines]);

  const clustersByRegion = useMemo(() => {
    const map = new Map<string, Array<{ cluster: ReturnType<typeof hostCluster>; hosts: FleetHost[] }>>();
    const perRegionCluster = new Map<string, Map<string, { cluster: ReturnType<typeof hostCluster>; hosts: FleetHost[] }>>();
    for (const h of hosts) {
      const cluster = hostCluster(h);
      const regionBucket = perRegionCluster.get(h.region) ?? new Map<string, { cluster: ReturnType<typeof hostCluster>; hosts: FleetHost[] }>();
      const clusterBucket = regionBucket.get(cluster.id) ?? { cluster, hosts: [] };
      clusterBucket.hosts.push(h);
      regionBucket.set(cluster.id, clusterBucket);
      perRegionCluster.set(h.region, regionBucket);
    }
    for (const [region, clusterMap] of perRegionCluster) {
      const clusters = Array.from(clusterMap.values())
        .map((entry) => ({
          cluster: entry.cluster,
          hosts: [...entry.hosts].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.cluster.name.localeCompare(b.cluster.name));
      map.set(region, clusters);
    }
    return map;
  }, [hosts]);

  const machinesByHost = useMemo(() => {
    const map = new Map<string, TopoMachine[]>();
    for (const m of machines) {
      if (!m.baremetal_host_id) continue;
      const arr = map.get(m.baremetal_host_id) ?? [];
      arr.push(m);
      map.set(m.baremetal_host_id, arr);
    }
    return map;
  }, [machines]);

  const orderedRegions = useMemo(() => {
    const copy = [...regions];
    copy.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.host_count !== b.host_count) return b.host_count - a.host_count;
      return a.id.localeCompare(b.id);
    });
    return copy;
  }, [regions]);

  if (loading && regions.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (regions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        No regions defined yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orderedRegions.map((region) => (
        <RegionNode
          key={region.id}
          region={region}
          clusters={clustersByRegion.get(region.id) ?? []}
          machinesByHost={machinesByHost}
          machinesLoading={machinesQuery.isLoading}
        />
      ))}
    </div>
  );
}

function RegionNode({
  region,
  clusters,
  machinesByHost,
  machinesLoading,
}: {
  region: FleetRegion;
  clusters: Array<{ cluster: ReturnType<typeof hostCluster>; hosts: FleetHost[] }>;
  machinesByHost: Map<string, TopoMachine[]>;
  machinesLoading: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean>(clusters.length > 0);
  const hosts = useMemo(() => clusters.flatMap((cluster) => cluster.hosts), [clusters]);

  const regionTotalVcpu = hosts.reduce((s, h) => s + (h.total_vcpu ?? 0), 0);
  const regionUsedVcpu = hosts.reduce((s, h) => s + h.used_vcpu, 0);

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm font-semibold">{region.id}</span>
        <span className="truncate text-xs text-muted-foreground">{region.label}</span>
        <AdminStatusPill tone={admissionStateTone(region.admission_state)} className="ml-1 text-[10px]">
          {region.admission_state}
        </AdminStatusPill>
        <AdminStatusPill tone={sellabilityStateTone(region.sellability_state)} className="text-[10px]">
          {region.sellability_state}
        </AdminStatusPill>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            {clusters.length} cluster{clusters.length === 1 ? "" : "s"}
          </span>
          <span>
            {hosts.length} host{hosts.length === 1 ? "" : "s"}
          </span>
          <span className="tabular-nums">
            {regionUsedVcpu}/{regionTotalVcpu} vCPU
          </span>
          <span className="tabular-nums">
            {Math.round(region.used_memory_gb)}/{Math.round(region.total_memory_gb)} GB
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="border-t bg-background px-3 py-2.5">
          {clusters.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
              No clusters in this region yet.{" "}
              <span className="opacity-70">
                Admission is <span className="font-mono">{region.admission_state}</span> /
                <span className="font-mono"> {region.sellability_state}</span>.
              </span>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {clusters.map((clusterEntry, idx) => (
                <ClusterNode
                  key={clusterEntry.cluster.id}
                  cluster={clusterEntry.cluster}
                  hosts={clusterEntry.hosts}
                  machinesByHost={machinesByHost}
                  machinesLoading={machinesLoading}
                  isLast={idx === clusters.length - 1}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ClusterNode({
  cluster,
  hosts,
  machinesByHost,
  machinesLoading,
  isLast,
}: {
  cluster: ReturnType<typeof hostCluster>;
  hosts: FleetHost[];
  machinesByHost: Map<string, TopoMachine[]>;
  machinesLoading: boolean;
  isLast: boolean;
}) {
  return (
    <li className="relative pl-4">
      <span aria-hidden className={cn("absolute left-0 top-0 w-px bg-border", isLast ? "h-3" : "h-full")} />
      <span aria-hidden className="absolute left-0 top-3 h-px w-3 bg-border" />
      <div className="rounded-lg border bg-muted/20 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <CircuitBoard className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs font-medium">{cluster.name}</span>
          <AdminStatusPill tone="neutral" className="text-[10px]">
            {cluster.incus_cluster_name}
          </AdminStatusPill>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {hosts.length} host{hosts.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-1 space-y-1.5 pl-4">
          {hosts.map((host, idx) => (
            <HostNode
              key={host.id}
              host={host}
              machines={machinesByHost.get(host.id) ?? []}
              machinesLoading={machinesLoading}
              isLast={idx === hosts.length - 1}
            />
          ))}
        </div>
      </div>
    </li>
  );
}

function HostNode({
  host,
  machines,
  machinesLoading,
  isLast,
}: {
  host: FleetHost;
  machines: TopoMachine[];
  machinesLoading: boolean;
  isLast: boolean;
}) {
  return (
    <li className="relative pl-4">
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 w-px bg-border",
          isLast ? "h-3" : "h-full",
        )}
      />
      <span aria-hidden className="absolute left-0 top-3 h-px w-3 bg-border" />
      <div className="rounded-lg border bg-card px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Server className="size-3 shrink-0 text-muted-foreground" />
          <Link
            href={`/v2/admin/hosts/${host.id}`}
            className="truncate font-mono text-xs font-medium hover:underline"
          >
            {host.name}
          </Link>
          <AdminStatusPill tone={hostStatusTone(host.status)} className="text-[10px]">
            {host.status}
          </AdminStatusPill>
          <span className="font-mono text-[10px] text-muted-foreground">
            {host.location}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {host.host_class}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {hostCluster(host).incus_member_name}
          </span>
          <span className="ml-auto flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
            <span title="vCPU used / total">
              {host.used_vcpu}/{host.total_vcpu ?? 0} vCPU
            </span>
            <span title="RAM used / total (GB)">
              {Math.round(host.used_memory_gb)}/{Math.round(host.total_memory_gb ?? 0)} GB
            </span>
            <span title="Disk used / total (GB)">
              {Math.round(host.used_disk_gb)}/{Math.round(host.total_disk_gb ?? 0)} GB disk
            </span>
          </span>
        </div>
        <div className="mt-1 pl-4">
          <HostMachinesList
            machines={machines}
            machinesLoading={machinesLoading}
            hostStatus={host.status}
          />
        </div>
      </div>
    </li>
  );
}

function HostMachinesList({
  machines,
  machinesLoading,
  hostStatus,
}: {
  machines: TopoMachine[];
  machinesLoading: boolean;
  hostStatus: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const PREVIEW = 5;

  if (machinesLoading && machines.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground/70">Loading machines…</div>
    );
  }

  if (machines.length === 0) {
    const hint =
      hostStatus === "active" ? null : `(host status: ${hostStatus})`;
    return (
      <div className="text-[10px] text-muted-foreground">
        0 machines{hint ? <span className="ml-1 opacity-70">{hint}</span> : null}
      </div>
    );
  }

  const visible = showAll ? machines : machines.slice(0, PREVIEW);
  const remaining = machines.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-muted-foreground">
        {machines.length} machine{machines.length === 1 ? "" : "s"}:
      </span>
      {visible.map((m) => (
        <Link
          key={m.id}
          href={`/v2/admin/machines?q=${encodeURIComponent(m.slug)}`}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
        >
          <span className="truncate max-w-[10rem]">{m.slug}</span>
          <AdminStatusPill
            tone={machineStatusTone(m.status)}
            className="px-1 py-0 text-[9px] leading-tight"
          >
            {m.status}
          </AdminStatusPill>
        </Link>
      ))}
      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded-md border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
        >
          +{remaining} more
        </button>
      ) : null}
      {showAll && machines.length > PREVIEW ? (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="rounded-md border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
        >
          show less
        </button>
      ) : null}
    </div>
  );
}

function AttentionIcon({ id }: { id: Attention["id"] }) {
  switch (id) {
    case "cfg-err":
    case "cfg-warn":
    case "quarantine":
      return <ShieldCheck className="size-4" />;
    case "drift":
    case "warn-drift":
      return <AlertTriangle className="size-4" />;
    case "svc":
      return <Activity className="size-4" />;
    case "pending":
      return <Server className="size-4" />;
    case "proc":
      return <ShoppingBag className="size-4" />;
    default:
      return <AlertTriangle className="size-4" />;
  }
}
