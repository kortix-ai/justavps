"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Cpu,
  Filter,
  HardDrive,
  Loader2,
  MemoryStick,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { toast } from "sonner";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMetric,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
  AdminUsageBar,
  relativeShort,
} from "@/v2/components/admin/primitives";
import {
  driftStatusTone,
  hostStatusTone,
  incusUiTone,
  maintenanceStateTone,
  validationStatusTone,
} from "@/v2/components/admin/tones";
import { HostActionBar } from "@/v2/components/admin/host-action-bar";
import {
  useCleanupFleetHostOrphans,
  useFleetHosts,
  useFleetRegions,
  useUpdateFleetHostMaintenanceState,
  useUpdateFleetHostOperatorSettings,
  useUpdateFleetHostSchedulerState,
  type FleetHost,
  type FleetHostMaintenanceState,
} from "@/shared/hooks/use-fleet";

type HostRowProps = {
  host: FleetHost;
  maintenancePending: boolean;
  onMaintenance: (state: FleetHostMaintenanceState) => void;
  orphansPending: boolean;
  onCleanupOrphans: () => void;
  schedulerPending: boolean;
  onQuarantine: () => void;
  onClearQuarantine: () => void;
  operatorPending: boolean;
  onDisableIncusUi: () => void;
  onEnableOperatorIncusUi: () => void;
};

export default function AdminHostsPage() {
  const hostsQuery = useFleetHosts();
  const regionsQuery = useFleetRegions();
  const updateMaintenance = useUpdateFleetHostMaintenanceState();
  const cleanupOrphans = useCleanupFleetHostOrphans();
  const updateScheduler = useUpdateFleetHostSchedulerState();
  const updateOperator = useUpdateFleetHostOperatorSettings();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [maintenanceFilter, setMaintenanceFilter] = useState<string>("all");
  const [driftFilter, setDriftFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");

  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);

  const classOptions = useMemo(
    () => Array.from(new Set(hosts.map((h) => h.host_class))).sort(),
    [hosts],
  );
  const regionOptions = useMemo(
    () => Array.from(new Set(hosts.map((h) => h.region))).sort(),
    [hosts],
  );

  const regionLookup = useMemo(
    () => new Map((regionsQuery.data ?? []).map((r) => [r.id, r])),
    [regionsQuery.data],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return hosts.filter((host) => {
      if (statusFilter !== "all" && host.status !== statusFilter) return false;
      if (maintenanceFilter !== "all" && host.maintenance_state !== maintenanceFilter) return false;
      if (driftFilter !== "all" && host.drift_status !== driftFilter) return false;
      if (classFilter !== "all" && host.host_class !== classFilter) return false;
      if (regionFilter !== "all" && host.region !== regionFilter) return false;
      if (!query) return true;
      return (
        host.name.toLowerCase().includes(query) ||
        host.region.toLowerCase().includes(query) ||
        host.location.toLowerCase().includes(query) ||
        (host.public_ipv4 ?? "").toLowerCase().includes(query) ||
        host.host_class.toLowerCase().includes(query)
      );
    });
  }, [hosts, search, statusFilter, maintenanceFilter, driftFilter, classFilter, regionFilter]);

  const totals = useMemo(() => {
    return {
      active: hosts.filter((h) => h.status === "active").length,
      schedulable: hosts.filter((h) => h.status === "active" && h.scheduler.schedulable !== false).length,
      totalVcpu: hosts.reduce((s, h) => s + (h.total_vcpu ?? 0), 0),
      usedVcpu: hosts.reduce((s, h) => s + h.used_vcpu, 0),
      totalMemory: hosts.reduce((s, h) => s + (h.total_memory_gb ?? 0), 0),
      usedMemory: hosts.reduce((s, h) => s + h.used_memory_gb, 0),
      totalDisk: hosts.reduce((s, h) => s + (h.total_disk_gb ?? 0), 0),
      usedDisk: hosts.reduce((s, h) => s + h.used_disk_gb, 0),
    };
  }, [hosts]);

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (maintenanceFilter !== "all" ? 1 : 0) +
    (driftFilter !== "all" ? 1 : 0) +
    (classFilter !== "all" ? 1 : 0) +
    (regionFilter !== "all" ? 1 : 0) +
    (search ? 1 : 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Server}
        title="Hosts"
        description="Bare-metal inventory, lifecycle controls, validation and drift posture."
        actions={
          <>
            <Link
              href="/v2/admin/procurements"
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 gap-1.5 text-xs")}
            >
              <Plus className="size-3.5" />
              Order a host
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => hostsQuery.refetch()}
              disabled={hostsQuery.isFetching}
            >
              {hostsQuery.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh
            </Button>
          </>
        }
      />


      <AdminKpiGrid>
        <AdminKpiCard
          icon={Server}
          label="Active hosts"
          value={`${totals.active}/${hosts.length}`}
          hint={`${totals.schedulable} schedulable`}
        />
        <AdminKpiCard
          icon={Cpu}
          label="vCPU"
          value={`${totals.usedVcpu}/${totals.totalVcpu}`}
          hint={totals.totalVcpu ? `${Math.round((totals.usedVcpu / totals.totalVcpu) * 100)}% used` : "—"}
        />
        <AdminKpiCard
          icon={MemoryStick}
          label="Memory"
          value={`${totals.usedMemory}/${totals.totalMemory} GB`}
        />
        <AdminKpiCard
          icon={HardDrive}
          label="Disk"
          value={`${totals.usedDisk}/${totals.totalDisk} GB`}
        />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search host, region, IP, class"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="bootstrapping">Bootstrapping</SelectItem>
            <SelectItem value="ordering">Ordering</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={maintenanceFilter} onValueChange={(v) => setMaintenanceFilter(v ?? "all")}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Maintenance" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All maintenance</SelectItem>
            <SelectItem value="in_service">In service</SelectItem>
            <SelectItem value="drain_requested">Drain requested</SelectItem>
            <SelectItem value="draining">Draining</SelectItem>
            <SelectItem value="drained">Drained</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={driftFilter} onValueChange={(v) => setDriftFilter(v ?? "all")}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Drift" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All drift</SelectItem>
            <SelectItem value="in_policy">In policy</SelectItem>
            <SelectItem value="warning_drift">Warning</SelectItem>
            <SelectItem value="blocking_drift">Blocking</SelectItem>
          </SelectContent>
        </Select>
        <Select value={classFilter} onValueChange={(v) => setClassFilter(v ?? "all")}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Host class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {classOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={regionFilter} onValueChange={(v) => setRegionFilter(v ?? "all")}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regionOptions.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFilterCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
              setMaintenanceFilter("all");
              setDriftFilter("all");
              setClassFilter("all");
              setRegionFilter("all");
            }}
          >
            <X className="size-3" />
            Clear ({activeFilterCount})
          </Button>
        ) : null}
      </AdminFilterBar>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Filter className="size-3.5" />
          Showing {filtered.length} of {hosts.length} hosts
        </div>
      </div>

      {hostsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <AdminEmptyState
          icon={Server}
          title="No hosts match these filters"
          description="Adjust filters or refresh the list"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((host) => (
            <HostRow
              key={host.id}
              host={host}
              regionLabel={regionLookup.get(host.region)?.label ?? host.region}
              maintenancePending={updateMaintenance.isPending}
              onMaintenance={(state) =>
                updateMaintenance.mutate(
                  { hostId: host.id, state },
                  {
                    onSuccess: () => toast.success(`${host.name} → ${state.replace(/_/g, " ")}`),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
              orphansPending={cleanupOrphans.isPending}
              onCleanupOrphans={() =>
                cleanupOrphans.mutate(host.id, {
                  onSuccess: (data) =>
                    toast.success(`${host.name}: cleaned ${data.cleaned_instance_ids.length} orphan(s)`),
                  onError: (err) => toast.error(err.message),
                })
              }
              schedulerPending={updateScheduler.isPending}
              onQuarantine={() =>
                updateScheduler.mutate(
                  {
                    hostId: host.id,
                    schedulable: false,
                    reason: "host manually quarantined by operator",
                  },
                  {
                    onSuccess: () => toast.success(`${host.name} quarantined`),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
              onClearQuarantine={() =>
                updateScheduler.mutate(
                  { hostId: host.id, schedulable: true },
                  {
                    onSuccess: () => toast.success(`${host.name} returned to scheduling`),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
              operatorPending={updateOperator.isPending}
              onDisableIncusUi={() =>
                updateOperator.mutate(
                  { hostId: host.id, incusUiExposure: "disabled" },
                  {
                    onSuccess: () => toast.success(`${host.name} Incus UI disabled`),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
              onEnableOperatorIncusUi={() =>
                updateOperator.mutate(
                  {
                    hostId: host.id,
                    incusUiExposure: "operator_only",
                    incusUiUrl: host.public_ipv4 ? `https://${host.public_ipv4}:8443` : "",
                  },
                  {
                    onSuccess: () => toast.success(`${host.name}: Incus UI enabled for operators`),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HostRow({
  host,
  regionLabel,
  maintenancePending,
  onMaintenance,
  orphansPending,
  onCleanupOrphans,
  schedulerPending,
  onQuarantine,
  onClearQuarantine,
  operatorPending,
  onDisableIncusUi,
  onEnableOperatorIncusUi,
}: HostRowProps & { regionLabel: string }) {
  const vcpuPct =
    !host.total_vcpu || host.total_vcpu <= 0 ? 0 : Math.round((host.used_vcpu / host.total_vcpu) * 100);
  const memPct =
    !host.total_memory_gb || host.total_memory_gb <= 0
      ? 0
      : Math.round((host.used_memory_gb / host.total_memory_gb) * 100);
  const diskPct =
    !host.total_disk_gb || host.total_disk_gb <= 0
      ? 0
      : Math.round((host.used_disk_gb / host.total_disk_gb) * 100);

  return (
    <AdminSectionCard padding="tight">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/v2/admin/hosts/${host.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {host.name}
              </Link>
              <AdminStatusPill tone={hostStatusTone(host.status)}>{host.status}</AdminStatusPill>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {host.vendor} · {regionLabel} · {host.cluster.name} · {host.location} · {host.host_class}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <AdminStatusPill tone="neutral">
              cluster {host.cluster.incus_cluster_name}
            </AdminStatusPill>
            <AdminStatusPill tone={maintenanceStateTone(host.maintenance_state)}>
              {host.maintenance_state.replace(/_/g, " ")}
            </AdminStatusPill>
            <AdminStatusPill tone={validationStatusTone(host.bootstrap_validation.status)}>
              validation {host.bootstrap_validation.status ?? "pending"}
            </AdminStatusPill>
            <AdminStatusPill tone={driftStatusTone(host.drift_status)}>
              drift {host.drift_status?.replace(/_/g, " ") ?? "unknown"}
            </AdminStatusPill>
            <AdminStatusPill tone={incusUiTone(host.incus_ui.exposure)}>
              incus ui {host.incus_ui.exposure?.replace(/_/g, " ") ?? "unset"}
            </AdminStatusPill>
            {host.scheduler.schedulable === false ? (
              <AdminStatusPill tone="danger">
                <ShieldCheck className="mr-1 size-3" /> quarantined
              </AdminStatusPill>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <UsageBlock
            label="vCPU"
            icon={Cpu}
            used={host.used_vcpu}
            total={host.total_vcpu}
            pct={vcpuPct}
          />
          <UsageBlock
            label="Memory"
            icon={MemoryStick}
            used={host.used_memory_gb}
            total={host.total_memory_gb}
            pct={memPct}
            unit="GB"
          />
          <UsageBlock
            label="Disk"
            icon={HardDrive}
            used={host.used_disk_gb}
            total={host.total_disk_gb}
            pct={diskPct}
            unit="GB"
          />
        </div>

        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <AdminMetric label="Drain blockers" value={host.drain_report.blockers_total} />
          <AdminMetric label="Active machines" value={host.drain_report.active_machines} />
          <AdminMetric label="Stopped disks" value={host.drain_report.stopped_machines_retaining_disk} />
          <AdminMetric label="Reservations" value={host.drain_report.active_reservations} />
          <AdminMetric
            label="Bootstrap validated"
            value={
              host.bootstrap_validation.completed_at
                ? relativeShort(host.bootstrap_validation.completed_at)
                : "Pending"
            }
          />
          <AdminMetric
            label="Runner / Incus"
            value={`${host.bootstrap_validation.runnerd_version ?? "runnerd ?"} · ${host.bootstrap_validation.incus_version ?? "incus ?"}`}
          />
          <AdminMetric
            label="Storage"
            value={`${host.bootstrap_validation.storage_driver ?? "unknown"}/${host.bootstrap_validation.storage_pool ?? "default"}`}
          />
          <AdminMetric label="Incus member" value={host.cluster.incus_member_name} />
          <AdminMetric label="Last heartbeat" value={relativeShort(host.last_heartbeat_at)} />
        </div>

        {host.reconciliation_report.orphan_instance_ids.length > 0 ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <span className="font-medium">Orphans:</span> {host.reconciliation_report.orphan_instance_ids.join(", ")}
          </div>
        ) : null}
        {host.reconciliation_report.warm_pool_instance_ids.length > 0 ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <span className="font-medium">Warm reserves:</span> {host.reconciliation_report.warm_pool_instance_ids.join(", ")}
          </div>
        ) : null}
        {host.scheduler.unschedulable_reason ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300">
            Scheduler quarantine reason: {host.scheduler.unschedulable_reason}
          </div>
        ) : null}

        <div className="truncate text-xs text-muted-foreground">
          {host.public_ipv4 ? `IP: ${host.public_ipv4}` : "No IP yet"}
          {host.runner_base_url ? ` · Runner: ${host.runner_base_url}` : " · Runner not registered yet"}
        </div>

        <HostActionBar
          host={host}
          maintenancePending={maintenancePending}
          onMaintenance={onMaintenance}
          orphansPending={orphansPending}
          onCleanupOrphans={onCleanupOrphans}
          schedulerPending={schedulerPending}
          onQuarantine={onQuarantine}
          onClearQuarantine={onClearQuarantine}
          operatorPending={operatorPending}
          onDisableIncusUi={onDisableIncusUi}
          onEnableOperatorIncusUi={onEnableOperatorIncusUi}
        />
      </div>
    </AdminSectionCard>
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
  total: number | null | undefined;
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
        {unit ? ` ${unit}` : ""} / {total ?? 0}
        {unit ? ` ${unit}` : ""}
      </div>
      <AdminUsageBar used={used} total={total} />
    </div>
  );
}
