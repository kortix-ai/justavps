"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/hooks/use-account";
import { useApproveProcurement, useCleanupFleetHostOrphans, useFleetCells, useFleetHosts, useFleetProcurementRecommendations, useFleetProcurements, useSyncProcurement, useUpdateFleetCellAdmissionState, useUpdateFleetHostMaintenanceState, type FleetHostMaintenanceState } from "@/hooks/use-fleet";
import { cn } from "@/lib/utils";
import { Activity, Cpu, HardDrive, Loader2, MemoryStick, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export default function AdminFleetPage() {
  const { data: account, isLoading: accountLoading } = useAccount();
  const enabled = account?.is_admin === true;
  const { data: hosts = [], isLoading: hostsLoading } = useFleetHosts(enabled);
  const { data: cells = [], isLoading: cellsLoading } = useFleetCells(enabled);
  const { data: procurementRecommendations = [], isLoading: procurementRecommendationsLoading } = useFleetProcurementRecommendations(enabled);
  const { data: procurements = [], isLoading: procurementsLoading } = useFleetProcurements(enabled);
  const approveProcurement = useApproveProcurement();
  const cleanupHostOrphans = useCleanupFleetHostOrphans();
  const syncProcurement = useSyncProcurement();
  const updateCellAdmission = useUpdateFleetCellAdmissionState();
  const updateMaintenance = useUpdateFleetHostMaintenanceState();

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
  const constrainedHosts = hosts.filter((host) => host.maintenance_state !== "in_service").length;
  const openProcurements = procurements.filter((procurement) => procurement.resolved_at === null).length;
  const totalVcpu = hosts.reduce((sum, host) => sum + (host.total_vcpu ?? 0), 0);
  const usedVcpu = hosts.reduce((sum, host) => sum + host.used_vcpu, 0);
  const totalRam = hosts.reduce((sum, host) => sum + (host.total_memory_gb ?? 0), 0);
  const usedRam = hosts.reduce((sum, host) => sum + host.used_memory_gb, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Fleet Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dedicated host inventory, procurement state, and current bare-metal capacity.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Hosts", value: `${activeHosts}/${totalHosts} active`, icon: Server },
          { label: "vCPU", value: `${usedVcpu}/${totalVcpu}`, icon: Cpu },
          { label: "RAM", value: `${usedRam}/${totalRam} GB`, icon: MemoryStick },
          { label: "Open Procurements", value: String(openProcurements), icon: HardDrive },
          { label: "Constrained Hosts", value: String(constrainedHosts), icon: Activity },
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
                          cellId: cell.id,
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
                          cellId: cell.id,
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
                          cellId: cell.id,
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
                      <div className="text-muted-foreground text-xs">Orphan instances</div>
                      <div>{host.reconciliation_report.orphan_instance_ids.length}</div>
                    </div>
                  </div>
                  {host.reconciliation_report.orphan_instance_ids.length > 0 && (
                    <div className="text-xs text-muted-foreground break-all">
                      Orphans: {host.reconciliation_report.orphan_instance_ids.join(", ")}
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
                      disabled={cleanupHostOrphans.isPending || host.reconciliation_report.orphan_instance_ids.filter((id) => !id.startsWith('justavps-warm-')).length === 0}
                      onClick={() => cleanupHostOrphans.mutate(host.id, {
                        onSuccess: (data) => toast.success(`${host.name}: cleaned ${data.cleaned_instance_ids.length} orphan instance(s)`),
                        onError: (error: Error) => toast.error(error.message),
                      })}
                    >
                      {cleanupHostOrphans.isPending ? <Loader2 className="size-3 animate-spin" /> : "Cleanup orphans"}
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
