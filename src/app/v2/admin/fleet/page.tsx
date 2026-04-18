"use client";

import { Skeleton } from "@/shared/ui/skeleton";
import { Badge } from "@/shared/ui/badge";
import { useAccount } from "@/shared/hooks/use-account";
import { useApproveProcurement, useCleanupFleetHostOrphans, useFleetCellCapacitySnapshots, useFleetCells, useFleetConfigAudit, useFleetControlPlaneServices, useFleetHostAudit, useFleetHosts, useFleetProcurementRecommendations, useFleetProcurements, useSyncProcurement, useUpdateFleetCellAdmissionState, useUpdateFleetCellReservePolicy, useUpdateFleetHostMaintenanceState, useUpdateFleetHostOperatorSettings, useUpdateFleetHostSchedulerState, type FleetHostMaintenanceState } from "@/shared/hooks/use-fleet";
import { cn } from "@/shared/lib/utils";
import { Activity, Cpu, HardDrive, Loader2, MemoryStick, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { toast } from "sonner";

function percent(used: number, total: number | null) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function statusTone(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "ordering":
    case "bootstrapping":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "error":
    case "failed":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function maintenanceTone(state: FleetHostMaintenanceState) {
  switch (state) {
    case "in_service":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "drain_requested":
    case "draining":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "drained":
    case "maintenance":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function validationTone(status: 'passed' | 'warning' | 'failed' | null) {
  switch (status) {
    case 'passed':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    case 'warning':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20';
    case 'failed':
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function driftTone(state: 'in_policy' | 'warning_drift' | 'blocking_drift' | null) {
  switch (state) {
    case 'in_policy':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    case 'warning_drift':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20';
    case 'blocking_drift':
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function incusUiTone(state: 'disabled' | 'operator_only' | 'cluster_console' | null) {
  switch (state) {
    case 'operator_only':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    case 'cluster_console':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
    case 'disabled':
      return 'bg-muted text-muted-foreground border-border';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function configAuditTone(state: 'ok' | 'warning' | 'error' | 'degraded') {
  switch (state) {
    case 'ok':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    case 'warning':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20';
    case 'error':
    case 'degraded':
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function admissionTone(state: "open" | "restricted" | "closed") {
  switch (state) {
    case "open":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "restricted":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "closed":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function sellabilityTone(state: "sellable" | "reserve_only" | "unsellable") {
  switch (state) {
    case "sellable":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "reserve_only":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "unsellable":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatMaintenanceLabel(state: FleetHostMaintenanceState) {
  return state.replaceAll("_", " ");
}

function reservePreset(cell: { host_class: string }, mode: 'none' | 'balanced' | 'failover') {
  if (mode === 'none') {
    return {
      warmReserve: { vcpu: 0, memory_gb: 0, disk_gb: 0 },
      failureReserve: { vcpu: 0, memory_gb: 0, disk_gb: 0 },
      procurementReserve: { vcpu: 0, memory_gb: 0, disk_gb: 0 },
    };
  }

  const base = cell.host_class === 'general-medium'
    ? { warm: { vcpu: 2, memory_gb: 4, disk_gb: 40 }, failure: { vcpu: 4, memory_gb: 8, disk_gb: 80 }, procurement: { vcpu: 2, memory_gb: 4, disk_gb: 40 } }
    : { warm: { vcpu: 1, memory_gb: 2, disk_gb: 20 }, failure: { vcpu: 2, memory_gb: 4, disk_gb: 40 }, procurement: { vcpu: 1, memory_gb: 2, disk_gb: 20 } };

  if (mode === 'balanced') {
    return {
      warmReserve: base.warm,
      failureReserve: base.failure,
      procurementReserve: { vcpu: 0, memory_gb: 0, disk_gb: 0 },
    };
  }

  return {
    warmReserve: base.warm,
    failureReserve: base.failure,
    procurementReserve: base.procurement,
  };
}

export default function AdminFleetPage() {
  const { data: account, isLoading: accountLoading } = useAccount();
  const enabled = account?.is_admin === true;
  const { data: hosts = [], isLoading: hostsLoading } = useFleetHosts(enabled);
  const { data: cells = [], isLoading: cellsLoading } = useFleetCells(enabled);
  const { data: configAudit, isLoading: configAuditLoading } = useFleetConfigAudit(enabled);
  const { data: hostAudit, isLoading: hostAuditLoading } = useFleetHostAudit(enabled);
  const { data: controlPlaneServices = [], isLoading: controlPlaneServicesLoading } = useFleetControlPlaneServices(enabled);
  const { data: cellCapacitySnapshots = [], isLoading: cellCapacitySnapshotsLoading } = useFleetCellCapacitySnapshots(enabled, 12);
  const { data: procurementRecommendations = [], isLoading: procurementRecommendationsLoading } = useFleetProcurementRecommendations(enabled);
  const { data: procurements = [], isLoading: procurementsLoading } = useFleetProcurements(enabled);
  const approveProcurement = useApproveProcurement();
  const cleanupHostOrphans = useCleanupFleetHostOrphans();
  const syncProcurement = useSyncProcurement();
  const updateCellAdmission = useUpdateFleetCellAdmissionState();
  const updateCellReservePolicy = useUpdateFleetCellReservePolicy();
  const updateMaintenance = useUpdateFleetHostMaintenanceState();
  const updateOperatorSettings = useUpdateFleetHostOperatorSettings();
  const updateSchedulerState = useUpdateFleetHostSchedulerState();

  if (accountLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Fleet Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page is restricted to admin accounts.</p>
      </div>
    );
  }

  const totalHosts = hosts.length;
  const activeHosts = hosts.filter((host) => host.status === "active").length;
  const activeSchedulableHosts = hosts.filter((host) => host.status === "active" && host.scheduler.schedulable !== false).length;
  const constrainedHosts = hosts.filter((host) => host.maintenance_state !== "in_service" || host.scheduler.schedulable === false).length;
  const openProcurements = procurements.filter((procurement) => procurement.resolved_at === null).length;
  const pendingValidationHosts = hosts.filter((host) => !host.bootstrap_validation.status || host.status === 'bootstrapping').length;
  const blockingDriftHosts = hosts.filter((host) => host.drift_status === 'blocking_drift').length;
  const quarantinedHosts = hosts.filter((host) => host.scheduler.schedulable === false).length;
  const totalVcpu = hosts.reduce((sum, host) => sum + (host.total_vcpu ?? 0), 0);
  const usedVcpu = hosts.reduce((sum, host) => sum + host.used_vcpu, 0);
  const totalRam = hosts.reduce((sum, host) => sum + (host.total_memory_gb ?? 0), 0);
  const usedRam = hosts.reduce((sum, host) => sum + host.used_memory_gb, 0);
  const orderedConfigChecks = configAudit?.checks.slice().sort((a, b) => {
    const order = { error: 0, warning: 1, ok: 2 } as const;
    return order[a.severity] - order[b.severity] || a.key.localeCompare(b.key);
  }) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Fleet Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dedicated host inventory, procurement state, and current bare-metal capacity.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-9">
        {[
          { label: "Hosts", value: `${activeHosts}/${totalHosts} active`, icon: Server },
          { label: "Schedulable Active", value: `${activeSchedulableHosts}/${totalHosts}`, icon: ShieldCheck },
          { label: "vCPU", value: `${usedVcpu}/${totalVcpu}`, icon: Cpu },
          { label: "RAM", value: `${usedRam}/${totalRam} GB`, icon: MemoryStick },
          { label: "Open Procurements", value: String(openProcurements), icon: HardDrive },
          { label: "Constrained Hosts", value: String(constrainedHosts), icon: Activity },
          { label: "Pending Validation", value: String(pendingValidationHosts), icon: ShieldCheck },
          { label: "Quarantined Hosts", value: String(quarantinedHosts), icon: ShieldCheck },
          { label: "Blocking Drift", value: String(blockingDriftHosts), icon: ShieldCheck },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <card.icon className="size-4" />
              {card.label}
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">{card.value}</div>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Config audit</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {configAuditLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : configAudit ? (
            <div className="divide-y divide-border">
              <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">Status: {configAudit.status}</div>
                  <Badge variant="outline" className={cn(configAuditTone(configAudit.status))}>{configAudit.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className={cn(configAuditTone('ok'))}>ok {configAudit.counts.ok}</Badge>
                  <Badge variant="outline" className={cn(configAuditTone('warning'))}>warnings {configAudit.counts.warning}</Badge>
                  <Badge variant="outline" className={cn(configAuditTone('error'))}>errors {configAudit.counts.error}</Badge>
                </div>
              </div>
              {orderedConfigChecks.map((check) => (
                <div key={check.key} className="p-4 space-y-1 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-medium">{check.key}</div>
                    <Badge variant="outline" className={cn(configAuditTone(check.severity))}>{check.severity}</Badge>
                  </div>
                  <div>{check.message}</div>
                  {check.details && <div className="text-xs text-muted-foreground break-all">{check.details}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">No config audit data.</div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Host validation audit</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {hostAuditLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : hostAudit ? (
            <div className="divide-y divide-border">
                <div className="p-4 grid gap-3 md:grid-cols-6 text-sm">
                  <div><div className="text-muted-foreground text-xs">Total hosts</div><div>{hostAudit.summary.total_hosts}</div></div>
                  <div><div className="text-muted-foreground text-xs">Schedulable active</div><div>{hostAudit.summary.active_schedulable_hosts}</div></div>
                  <div><div className="text-muted-foreground text-xs">Bootstrapping</div><div>{hostAudit.summary.bootstrapping_hosts}</div></div>
                  <div><div className="text-muted-foreground text-xs">Pending validation</div><div>{hostAudit.summary.pending_validation_hosts}</div></div>
                  <div><div className="text-muted-foreground text-xs">Quarantined</div><div>{hostAudit.summary.quarantined_hosts}</div></div>
                  <div><div className="text-muted-foreground text-xs">Warning drift</div><div>{hostAudit.summary.warning_drift_hosts}</div></div>
                  <div><div className="text-muted-foreground text-xs">Blocking drift</div><div>{hostAudit.summary.blocking_drift_hosts}</div></div>
                </div>
              {hostAudit.pending_validation.length > 0 && (
                <div className="p-4 space-y-2 text-sm">
                  <div className="font-medium">Pending validation hosts</div>
                  <div className="flex flex-wrap gap-2">{hostAudit.pending_validation.map((host) => <Badge key={host.id} variant="outline">{host.name} · {host.status}</Badge>)}</div>
                </div>
              )}
              {hostAudit.blocking_drift.length > 0 && (
                <div className="p-4 space-y-2 text-sm">
                  <div className="font-medium">Blocking drift hosts</div>
                  <div className="flex flex-wrap gap-2">{hostAudit.blocking_drift.map((host) => <Badge key={host.id} variant="outline" className={cn(driftTone('blocking_drift'))}>{host.name}{host.quarantined ? ' · quarantined' : ''}</Badge>)}</div>
                </div>
              )}
              {hostAudit.summary.quarantined_hosts > 0 && (
                <div className="p-4 space-y-2 text-sm">
                  <div className="font-medium">Quarantined hosts</div>
                  <div className="flex flex-wrap gap-2">{hostAudit.quarantined.map((host) => <Badge key={`${host.id}-quarantine`} variant="outline" className={cn(driftTone(host.drift_status === 'warning_drift' ? 'warning_drift' : 'blocking_drift'))}>{host.name}{host.unschedulable_reason ? ` · ${host.unschedulable_reason}` : ''}</Badge>)}</div>
                </div>
              )}
              {hostAudit.warning_drift.length > 0 && (
                <div className="p-4 space-y-2 text-sm">
                  <div className="font-medium">Warning drift hosts</div>
                  <div className="flex flex-wrap gap-2">{hostAudit.warning_drift.map((host) => <Badge key={host.id} variant="outline" className={cn(driftTone('warning_drift'))}>{host.name}</Badge>)}</div>
                </div>
              )}
              {hostAudit.pending_validation.length === 0 && hostAudit.blocking_drift.length === 0 && hostAudit.warning_drift.length === 0 && (
                <div className="p-6 text-sm text-muted-foreground">All hosts are validated and in policy.</div>
              )}
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">No host audit data.</div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Control plane services</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {controlPlaneServicesLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {controlPlaneServices.map((service) => (
                <div key={`${service.service}:${service.scope}`} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{service.service}</div>
                      <div className="text-xs text-muted-foreground">scope: {service.scope} · {service.mode} · {service.critical ? 'critical' : 'non-critical'}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{service.stale ? 'stale' : 'fresh'}</Badge>
                      <Badge variant="outline">lease {service.lease_owner ? 'held' : 'idle'}</Badge>
                      {service.last_completed_at && <Badge variant="outline">last complete {new Date(service.last_completed_at).toLocaleTimeString()}</Badge>}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 text-xs text-muted-foreground">
                    <div>Lease owner: {service.lease_owner ?? 'none'}</div>
                    <div>Lease expires: {service.lease_expires_at ? new Date(service.lease_expires_at).toLocaleString() : 'n/a'}</div>
                    <div>Last started: {service.last_started_at ? new Date(service.last_started_at).toLocaleString() : 'n/a'}</div>
                    <div>Age since completion: {service.age_ms_since_completion != null ? `${Math.round(service.age_ms_since_completion / 1000)}s` : 'n/a'}</div>
                  </div>
                  {Object.keys(service.checkpoint).length > 0 && (
                    <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">{JSON.stringify(service.checkpoint, null, 2)}</pre>
                  )}
                  <div className="text-xs text-muted-foreground">{service.description}</div>
                </div>
              ))}
              {controlPlaneServices.length === 0 && <div className="p-6 text-sm text-muted-foreground">No control-plane service state yet.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Cell capacity snapshots</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {cellCapacitySnapshotsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {cellCapacitySnapshots.map((snapshot) => (
                <div key={snapshot.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium">{snapshot.cell_slug}</div>
                    <div className="text-xs text-muted-foreground">{new Date(snapshot.snapshot_window_start).toLocaleString()}</div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-5 text-xs text-muted-foreground">
                    <div>Used: {snapshot.used_vcpu}/{snapshot.total_vcpu} vCPU</div>
                    <div>Schedulable active: {snapshot.active_schedulable_host_count}/{snapshot.host_count} hosts</div>
                    <div>Sellable: {snapshot.sellable_vcpu} vCPU</div>
                    <div>Reserve budget: {snapshot.reserve_budget_vcpu} vCPU</div>
                    <div>Utilization: {(snapshot.utilization_score_basis_points / 100).toFixed(2)}%</div>
                  </div>
                </div>
              ))}
              {cellCapacitySnapshots.length === 0 && <div className="p-6 text-sm text-muted-foreground">No cell capacity snapshots yet.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Cells</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {cellsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {cells.map((cell) => (
                <div key={cell.slug} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{cell.name}</div>
                      <div className="text-xs text-muted-foreground">{cell.slug} · {cell.host_count} host{cell.host_count === 1 ? "" : "s"}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{cell.region}</Badge>
                      <Badge variant="outline">{cell.host_class}</Badge>
                      <Badge variant="outline">{cell.generation}</Badge>
                      <Badge variant="outline" className={cn("capitalize", admissionTone(cell.admission_state))}>{cell.admission_state}</Badge>
                      <Badge variant="outline" className={cn("capitalize", sellabilityTone(cell.sellability_state))}>{cell.sellability_state.replaceAll("_", " ")}</Badge>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">vCPU</div>
                      <div>{cell.used_vcpu}/{cell.total_vcpu} used · {cell.available_vcpu} free</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Memory</div>
                      <div>{cell.used_memory_gb}/{cell.total_memory_gb} GB used · {cell.available_memory_gb} GB free</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Disk</div>
                      <div>{cell.used_disk_gb}/{cell.total_disk_gb} GB used · {cell.available_disk_gb} GB free</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Reservations</div>
                      <div>{cell.reserved_vcpu} vCPU pending · score {cell.utilization_score.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Schedulable active</div>
                      <div>{cell.active_schedulable_host_count}/{cell.host_count} hosts</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Reserve budget</div>
                      <div>{cell.reserve_budget_vcpu} vCPU · {cell.reserve_budget_memory_gb} GB · {cell.reserve_budget_disk_gb} GB</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Sellable after reserve</div>
                      <div>{cell.sellable_vcpu} vCPU · {cell.sellable_memory_gb} GB · {cell.sellable_disk_gb} GB</div>
                    </div>
                  </div>
                  {cell.admission_reason && <div className="text-xs text-muted-foreground">Admission note: {cell.admission_reason}</div>}
                  {cell.id && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={updateCellAdmission.isPending || (cell.admission_state === "open" && cell.sellability_state === "sellable")}
                        onClick={() => updateCellAdmission.mutate({
                          cellId: cell.id!,
                          admissionState: "open",
                          sellabilityState: "sellable",
                          reason: null,
                        }, {
                          onSuccess: () => toast.success(`${cell.name} opened for general placement`),
                          onError: (error: Error) => toast.error(error.message),
                        })}
                      >
                        {updateCellAdmission.isPending ? <Loader2 className="size-3 animate-spin" /> : "Open sales"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={updateCellAdmission.isPending || (cell.admission_state === "restricted" && cell.sellability_state === "reserve_only")}
                        onClick={() => updateCellAdmission.mutate({
                          cellId: cell.id!,
                          admissionState: "restricted",
                          sellabilityState: "reserve_only",
                          reason: "Held for reserve / failover capacity",
                        }, {
                          onSuccess: () => toast.success(`${cell.name} set to reserve-only`),
                          onError: (error: Error) => toast.error(error.message),
                        })}
                      >
                        {updateCellAdmission.isPending ? <Loader2 className="size-3 animate-spin" /> : "Reserve only"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={updateCellAdmission.isPending || (cell.admission_state === "closed" && cell.sellability_state === "unsellable")}
                        onClick={() => updateCellAdmission.mutate({
                          cellId: cell.id!,
                          admissionState: "closed",
                          sellabilityState: "unsellable",
                          reason: "Cell closed to new placements",
                        }, {
                          onSuccess: () => toast.success(`${cell.name} closed to placements`),
                          onError: (error: Error) => toast.error(error.message),
                        })}
                      >
                        {updateCellAdmission.isPending ? <Loader2 className="size-3 animate-spin" /> : "Close sales"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={updateCellReservePolicy.isPending}
                        onClick={() => {
                          const preset = reservePreset(cell, 'none');
                          updateCellReservePolicy.mutate({ cellId: cell.id!, ...preset }, {
                            onSuccess: () => toast.success(`${cell.name} reserve policy cleared`),
                            onError: (error: Error) => toast.error(error.message),
                          });
                        }}
                      >
                        {updateCellReservePolicy.isPending ? <Loader2 className="size-3 animate-spin" /> : "No reserve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={updateCellReservePolicy.isPending}
                        onClick={() => {
                          const preset = reservePreset(cell, 'balanced');
                          updateCellReservePolicy.mutate({ cellId: cell.id!, ...preset }, {
                            onSuccess: () => toast.success(`${cell.name} set to balanced reserve`),
                            onError: (error: Error) => toast.error(error.message),
                          });
                        }}
                      >
                        {updateCellReservePolicy.isPending ? <Loader2 className="size-3 animate-spin" /> : "Balanced reserve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={updateCellReservePolicy.isPending}
                        onClick={() => {
                          const preset = reservePreset(cell, 'failover');
                          updateCellReservePolicy.mutate({ cellId: cell.id!, ...preset }, {
                            onSuccess: () => toast.success(`${cell.name} set to failover reserve`),
                            onError: (error: Error) => toast.error(error.message),
                          });
                        }}
                      >
                        {updateCellReservePolicy.isPending ? <Loader2 className="size-3 animate-spin" /> : "Failover reserve"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {cells.length === 0 && <div className="p-6 text-sm text-muted-foreground">No cells yet.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Procurement recommendations</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {procurementRecommendationsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {procurementRecommendations.map((rec) => (
                <div key={rec.id} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{rec.cell_name}</div>
                      <div className="text-xs text-muted-foreground">{rec.cell_slug} · {rec.region}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{rec.current_host_class}</Badge>
                      <Badge variant="outline">→ {rec.recommended_host_class}</Badge>
                      <Badge variant="outline">{rec.procurement_purpose.replaceAll("_", " ")}</Badge>
                    </div>
                  </div>
                  <div className="text-sm">{rec.summary}</div>
                  <div className="grid gap-3 md:grid-cols-4 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Shortfall vCPU</div>
                      <div>{rec.reserve_shortfall_vcpu}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Shortfall memory</div>
                      <div>{rec.reserve_shortfall_memory_gb} GB</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Shortfall disk</div>
                      <div>{rec.reserve_shortfall_disk_gb} GB</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Minimum hosts</div>
                      <div>{rec.minimum_hosts}</div>
                    </div>
                  </div>
                  {rec.notes.length > 0 && (
                    <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                      {rec.notes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  )}
                </div>
              ))}
              {procurementRecommendations.length === 0 && <div className="p-6 text-sm text-muted-foreground">No procurement recommendations right now.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Hosts</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {hostsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {hosts.map((host) => (
                <div key={host.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{host.name}</div>
                      <div className="text-xs text-muted-foreground">{host.vendor} · {host.location} · {host.host_class} · {host.generation} · {host.cell_slug}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("capitalize", statusTone(host.status))}>{host.status}</Badge>
                      <Badge variant="outline" className={cn("capitalize", maintenanceTone(host.maintenance_state))}>{formatMaintenanceLabel(host.maintenance_state)}</Badge>
                      <Badge variant="outline" className={cn("capitalize", admissionTone(host.cell_admission_state))}>{host.cell_admission_state}</Badge>
                      <Badge variant="outline" className={cn("capitalize", sellabilityTone(host.cell_sellability_state))}>{host.cell_sellability_state.replaceAll("_", " ")}</Badge>
                      <Badge variant="outline" className={cn("capitalize", validationTone(host.bootstrap_validation.status))}>
                        validation {host.bootstrap_validation.status ?? 'pending'}
                      </Badge>
                      <Badge variant="outline" className={cn("capitalize", driftTone(host.drift_status))}>
                        drift {host.drift_status?.replaceAll('_', ' ') ?? 'unknown'}
                      </Badge>
                      <Badge variant="outline" className={cn("capitalize", incusUiTone(host.incus_ui.exposure))}>
                        incus ui {host.incus_ui.exposure?.replaceAll('_', ' ') ?? 'unset'}
                      </Badge>
                      {host.scheduler.schedulable === false && (
                        <Badge variant="outline" className={cn("capitalize", driftTone('blocking_drift'))}>
                          scheduler quarantined
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Compute</div>
                      <div>{host.used_vcpu}/{host.total_vcpu ?? 0} vCPU ({percent(host.used_vcpu, host.total_vcpu)}%)</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Memory</div>
                      <div>{host.used_memory_gb}/{host.total_memory_gb ?? 0} GB ({percent(host.used_memory_gb, host.total_memory_gb)}%)</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Disk</div>
                      <div>{host.used_disk_gb}/{host.total_disk_gb ?? 0} GB ({percent(host.used_disk_gb, host.total_disk_gb)}%)</div>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Drain blockers</div>
                      <div>{host.drain_report.blockers_total}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Active machines</div>
                      <div>{host.drain_report.active_machines}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Stopped disks</div>
                      <div>{host.drain_report.stopped_machines_retaining_disk}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Reservations</div>
                      <div>{host.drain_report.active_reservations}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Bootstrap validation</div>
                      <div>{host.bootstrap_validation.completed_at ? new Date(host.bootstrap_validation.completed_at).toLocaleString() : 'Pending'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Runner / Incus</div>
                      <div>{host.bootstrap_validation.runnerd_version ?? 'runnerd ?'} · {host.bootstrap_validation.incus_version ?? 'incus ?'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Storage profile</div>
                      <div>{host.bootstrap_validation.storage_driver ?? 'unknown'} / {host.bootstrap_validation.storage_pool ?? 'default'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Incus UI</div>
                      <div>{host.incus_ui.exposure?.replaceAll('_', ' ') ?? 'unset'}{host.incus_ui.url ? ` · ${host.incus_ui.url}` : ''}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Scheduler state</div>
                      <div>{host.scheduler.schedulable === false ? 'quarantined' : host.scheduler.schedulable === true ? 'schedulable' : 'unknown'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Scheduler updated</div>
                      <div>{host.scheduler.updated_at ? new Date(host.scheduler.updated_at).toLocaleString() : 'Unknown'}{host.scheduler.updated_by ? ` · ${host.scheduler.updated_by}` : ''}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Orphan instances</div>
                      <div>{host.reconciliation_report.orphan_instance_ids.length}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Warm reserves</div>
                      <div>{host.reconciliation_report.warm_pool_instance_ids.length}</div>
                    </div>
                  </div>
                  {host.reconciliation_report.orphan_instance_ids.length > 0 && (
                    <div className="text-xs text-muted-foreground break-all">
                      Orphans: {host.reconciliation_report.orphan_instance_ids.join(", ")}
                    </div>
                  )}
                  {host.reconciliation_report.warm_pool_instance_ids.length > 0 && (
                    <div className="text-xs text-muted-foreground break-all">
                      Warm reserves: {host.reconciliation_report.warm_pool_instance_ids.join(", ")}
                    </div>
                  )}
                  {(host.bootstrap_validation.smoke_test_result || host.bootstrap_validation.warm_pool_result || host.bootstrap_validation.notes.length > 0) && (
                    <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                      <div>
                        Smoke test: {host.bootstrap_validation.smoke_test_result ?? 'pending'}
                        {host.bootstrap_validation.smoke_test_machine_id ? ` · machine ${host.bootstrap_validation.smoke_test_machine_id}` : ''}
                      </div>
                      <div>Warm pool check: {host.bootstrap_validation.warm_pool_result ?? 'pending'}</div>
                      <div>Triggered by: {host.bootstrap_validation.triggered_by ?? 'unknown'}</div>
                      {host.bootstrap_validation.notes.map((note) => <div key={note}>{note}</div>)}
                    </div>
                  )}
                  {host.scheduler.unschedulable_reason && (
                    <div className="rounded-lg bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300 border border-red-500/20">
                      Scheduler quarantine reason: {host.scheduler.unschedulable_reason}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground break-all">
                    {host.public_ipv4 ? `IP: ${host.public_ipv4}` : "No IP yet"}
                    {host.runner_base_url ? ` · Runner: ${host.runner_base_url}` : " · Runner not registered yet"}
                     {host.last_heartbeat_at ? ` · Last sync: ${new Date(host.last_heartbeat_at).toLocaleString()}` : " · Last sync pending"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { label: "Request drain", state: "drain_requested" },
                      { label: "Mark draining", state: "draining" },
                      { label: "Mark maintenance", state: "maintenance" },
                      { label: "Return to service", state: "in_service" },
                    ] as const).map((action) => (
                      <Button
                        key={action.state}
                        size="sm"
                        variant={action.state === "in_service" ? "default" : "outline"}
                        className="h-7 text-xs"
                        disabled={updateMaintenance.isPending || host.maintenance_state === action.state}
                        onClick={() => updateMaintenance.mutate({ hostId: host.id, state: action.state }, {
                          onSuccess: () => toast.success(`${host.name} set to ${formatMaintenanceLabel(action.state)}`),
                          onError: (error: Error) => toast.error(error.message),
                        })}
                      >
                        {updateMaintenance.isPending ? <Loader2 className="size-3 animate-spin" /> : action.label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={updateMaintenance.isPending || host.maintenance_state === "drained"}
                      onClick={() => updateMaintenance.mutate({ hostId: host.id, state: "drained" }, {
                        onSuccess: () => toast.success(`${host.name} marked drained`),
                        onError: (error: Error) => toast.error(error.message),
                      })}
                    >
                      {updateMaintenance.isPending ? <Loader2 className="size-3 animate-spin" /> : "Mark drained"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={cleanupHostOrphans.isPending || host.reconciliation_report.orphan_instance_ids.length === 0}
                      onClick={() => cleanupHostOrphans.mutate(host.id, {
                        onSuccess: (data) => toast.success(`${host.name}: cleaned ${data.cleaned_instance_ids.length} orphan instance(s)`),
                        onError: (error: Error) => toast.error(error.message),
                      })}
                    >
                      {cleanupHostOrphans.isPending ? <Loader2 className="size-3 animate-spin" /> : "Cleanup orphans"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={updateSchedulerState.isPending || host.scheduler.schedulable === false}
                      onClick={() => updateSchedulerState.mutate({ hostId: host.id, schedulable: false, reason: 'host manually quarantined by operator' }, {
                        onSuccess: () => toast.success(`${host.name} quarantined from scheduling`),
                        onError: (error: Error) => toast.error(error.message),
                      })}
                    >
                      {updateSchedulerState.isPending ? <Loader2 className="size-3 animate-spin" /> : 'Quarantine host'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={updateSchedulerState.isPending || host.scheduler.schedulable !== false}
                      onClick={() => updateSchedulerState.mutate({ hostId: host.id, schedulable: true }, {
                        onSuccess: () => toast.success(`${host.name} returned to scheduling`),
                        onError: (error: Error) => toast.error(error.message),
                      })}
                    >
                      {updateSchedulerState.isPending ? <Loader2 className="size-3 animate-spin" /> : 'Clear quarantine'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={updateOperatorSettings.isPending || host.incus_ui.exposure === 'disabled'}
                      onClick={() => updateOperatorSettings.mutate({ hostId: host.id, incusUiExposure: 'disabled' }, {
                        onSuccess: () => toast.success(`${host.name} Incus UI disabled`),
                        onError: (error: Error) => toast.error(error.message),
                      })}
                    >
                      {updateOperatorSettings.isPending ? <Loader2 className="size-3 animate-spin" /> : 'Disable Incus UI'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={updateOperatorSettings.isPending || host.incus_ui.exposure === 'operator_only'}
                      onClick={() => updateOperatorSettings.mutate({ hostId: host.id, incusUiExposure: 'operator_only', incusUiUrl: host.public_ipv4 ? `https://${host.public_ipv4}:8443` : '' }, {
                        onSuccess: () => toast.success(`${host.name} Incus UI marked operator-only`),
                        onError: (error: Error) => toast.error(error.message),
                      })}
                    >
                      {updateOperatorSettings.isPending ? <Loader2 className="size-3 animate-spin" /> : 'Operator Incus UI'}
                    </Button>
                  </div>
                </div>
              ))}
              {hosts.length === 0 && <div className="p-6 text-sm text-muted-foreground">No hosts yet.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Procurement history</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {procurementsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {procurements.map((procurement) => (
                <div key={procurement.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{procurement.product_id}</div>
                    <div className="text-xs text-muted-foreground">{procurement.location} · {procurement.host_class} · {procurement.generation} · {procurement.procurement_purpose.replaceAll("_", " ")}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="outline" className={cn("capitalize", statusTone(procurement.status))}>{procurement.status}</Badge>
                    <div className="text-xs text-muted-foreground break-all text-right">
                      {procurement.provider_transaction_id ?? procurement.id}
                    </div>
                    <div className="flex gap-2">
                      {procurement.status === "requested" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={approveProcurement.isPending}
                          onClick={() => approveProcurement.mutate(procurement.id, {
                            onSuccess: () => toast.success("Procurement approved"),
                            onError: (error: Error) => toast.error(error.message),
                          })}
                        >
                          {approveProcurement.isPending ? <Loader2 className="size-3 animate-spin" /> : "Approve"}
                        </Button>
                      )}
                      {procurement.provider_transaction_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={syncProcurement.isPending}
                          onClick={() => syncProcurement.mutate(procurement.id, {
                            onSuccess: () => toast.success("Procurement synced"),
                            onError: (error: Error) => toast.error(error.message),
                          })}
                        >
                          {syncProcurement.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                          Sync
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {procurements.length === 0 && <div className="p-6 text-sm text-muted-foreground">No procurements yet.</div>}
            </div>
          )}
        </div>
      </section>

      <div className="rounded-2xl border bg-card p-5 space-y-2 text-sm">
        <div className="font-medium">Scaling model</div>
        <p className="text-muted-foreground text-sm">
          Machines are pinned to a single host. Capacity scales horizontally by adding more bare-metal nodes and letting the scheduler place new machines onto active hosts.
        </p>
        <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
          <li>Cells are the first fleet partition: region × host class × generation.</li>
          <li>Procurement is slower than VM placement, so spare capacity and warm-pool headroom matter.</li>
          <li>Stopped machines free runtime resources on the node, but their persistent disk footprint remains allocated.</li>
          <li>The initial model avoids live migration and distributed storage to keep the platform operationally simple.</li>
        </ul>
      </div>
    </div>
  );
}
