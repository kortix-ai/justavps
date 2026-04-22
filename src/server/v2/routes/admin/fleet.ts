/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'crypto';
import { db } from '@/server/db';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse, handleRouteError } from "@/server/core/route-helpers";
import { config } from "@/server/core/config";
import {
  backupArtifacts,
  baremetalHostImages,
  baremetalHosts,
  baremetalProcurements,
  hostCapacityReservations,
  images,
  machineEvents,
  machines,
  regions,
  users,
  type RegionRow,
} from '@/server/db/schema';
import { getBaremetalHostClassProfile } from "@/server/platform/baremetal/host-class-profiles";
import { HOST_MAINTENANCE_STATES } from "@/server/platform/baremetal/host-maintenance";
import { HttpBaremetalRunnerClient } from "@/server/platform/baremetal/runner-client";
import { HetznerRobotClient } from "@/server/platform/baremetal/vendors/hetzner-robot";
import { CONTROL_PLANE_SERVICE_PROFILES, isControlPlaneServiceStale, listControlPlaneServiceStates } from "@/server/platform/control-plane/service-state";
import { deriveClusterRef } from "@/shared/lib/fleet-clusters";
import { findRegion, regionLabel, REGIONS } from "@/shared/lib/regions";
import { loadConfigAuditChecks, loadFleetHostAuditSummary, summarizeConfigAudit } from "@/server/v2/services/config-audit";
import { registerAdminFleetBenchmarkRoutes } from "@/server/v2/routes/admin/fleet/benchmarks";
import { registerAdminFleetControlPlaneRoutes } from "@/server/v2/routes/admin/fleet/control-plane";
import { registerAdminFleetProcurementRoutes } from "@/server/v2/routes/admin/fleet/procurements";
import { registerAdminFleetServiceStateRoutes } from "@/server/v2/routes/admin/fleet/service-states";
import { registerAdminFleetHostRoutes } from "@/server/v2/routes/admin/fleet/hosts";
import { registerAdminFleetHostMutationRoutes } from "@/server/v2/routes/admin/fleet/host-mutations";
import { registerAdminFleetAuditRoutes } from "@/server/v2/routes/admin/fleet/audit";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export const adminFleetV2App = new OpenAPIHono<{ Variables: AuthVariables }>();
adminFleetV2App.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) return errorResponse(c, 403, 'Admin access required');
  return null;
}

const HostMaintenanceStateSchema = z.enum(HOST_MAINTENANCE_STATES);
const RegionAdmissionStateSchema = z.enum(['open', 'restricted', 'closed']);
const RegionSellabilityStateSchema = z.enum(['sellable', 'reserve_only', 'unsellable']);

const HostDrainReportSchema = z.object({
  active_machines: z.number(),
  stopped_machines_retaining_disk: z.number(),
  active_reservations: z.number(),
  pending_backup_artifacts: z.number(),
  blockers_total: z.number(),
});

const HostReconciliationReportSchema = z.object({
  checked_at: z.string().nullable(),
  instance_count: z.number(),
  image_count: z.number(),
  stale_machine_ids: z.array(z.string().uuid()),
  stale_image_ids: z.array(z.string().uuid()),
  orphan_instance_ids: z.array(z.string()),
  warm_pool_instance_ids: z.array(z.string()),
  error: z.string().nullable(),
});

const HostBootstrapValidationArtifactSchema = z.object({
  status: z.enum(['passed', 'warning', 'failed']).nullable(),
  bootstrap_version: z.string().nullable(),
  runnerd_version: z.string().nullable(),
  incus_version: z.string().nullable(),
  storage_driver: z.string().nullable(),
  storage_pool: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  smoke_test_machine_id: z.string().nullable(),
  smoke_test_result: z.enum(['passed', 'failed']).nullable(),
  warm_pool_result: z.enum(['passed', 'failed']).nullable(),
  triggered_by: z.string().nullable(),
  notes: z.array(z.string()),
});

const HostOperatorIncusUiSchema = z.object({
  exposure: z.enum(['disabled', 'operator_only', 'cluster_console']).nullable(),
  url: z.string().nullable(),
  note: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const HostSchedulerStateSchema = z.object({
  schedulable: z.boolean().nullable(),
  unschedulable_reason: z.string().nullable(),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
});

const ClusterRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  incus_cluster_name: z.string(),
  incus_member_name: z.string(),
});

const ClusterSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  region_label: z.string(),
  incus_cluster_name: z.string(),
  host_count: z.number(),
  active_host_count: z.number(),
  active_schedulable_host_count: z.number(),
  total_vcpu: z.number(),
  total_memory_gb: z.number(),
  total_disk_gb: z.number(),
  used_vcpu: z.number(),
  used_memory_gb: z.number(),
  used_disk_gb: z.number(),
  available_vcpu: z.number(),
  available_memory_gb: z.number(),
  available_disk_gb: z.number(),
  admission_state: RegionAdmissionStateSchema,
  sellability_state: RegionSellabilityStateSchema,
  member_names: z.array(z.string()),
});

const HostListResponseSchema = z.object({
  hosts: z.array(z.object({
    id: z.string().uuid(),
    vendor: z.string(),
    host_class: z.string(),
    region: z.string(),
    cluster: ClusterRefSchema,
    location: z.string(),
    name: z.string(),
    status: z.string(),
    maintenance_state: HostMaintenanceStateSchema,
    maintenance_requested_at: z.string().nullable(),
    maintenance_started_at: z.string().nullable(),
    maintenance_completed_at: z.string().nullable(),
    provider_server_number: z.string().nullable(),
    provider_transaction_id: z.string().nullable(),
    public_ipv4: z.string().nullable(),
    public_ipv6: z.string().nullable(),
    runner_base_url: z.string().nullable(),
    total_vcpu: z.number().nullable(),
    total_memory_gb: z.number().nullable(),
    total_disk_gb: z.number().nullable(),
    used_vcpu: z.number(),
    used_memory_gb: z.number(),
    used_disk_gb: z.number(),
    last_heartbeat_at: z.string().nullable(),
    drain_report: HostDrainReportSchema,
    reconciliation_report: HostReconciliationReportSchema,
    bootstrap_validation: HostBootstrapValidationArtifactSchema,
    drift_status: z.enum(['in_policy', 'warning_drift', 'blocking_drift']).nullable(),
    scheduler: HostSchedulerStateSchema,
    incus_ui: HostOperatorIncusUiSchema,
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.string(),
    updated_at: z.string(),
  })),
  regions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    continent: z.string(),
    active: z.boolean(),
    admission_state: RegionAdmissionStateSchema,
    sellability_state: RegionSellabilityStateSchema,
    host_count: z.number(),
    active_host_count: z.number(),
    active_schedulable_host_count: z.number(),
    total_vcpu: z.number(),
    total_memory_gb: z.number(),
    total_disk_gb: z.number(),
    used_vcpu: z.number(),
    used_memory_gb: z.number(),
    used_disk_gb: z.number(),
    available_vcpu: z.number(),
    available_memory_gb: z.number(),
    available_disk_gb: z.number(),
    utilization_score: z.number(),
  })),
  clusters: z.array(ClusterSchema),
});

const HostSchema = HostListResponseSchema.shape.hosts.element;
const RegionSchema = HostListResponseSchema.shape.regions.element;

const HetznerProductListResponseSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    name: z.string(),
    location: z.array(z.string()).optional(),
    description: z.array(z.string()).optional(),
    traffic: z.string().optional(),
    prices: z.array(z.object({
      location: z.string(),
      monthly_net: z.string(),
      monthly_gross: z.string(),
      hourly_net: z.string().nullable().optional(),
      hourly_gross: z.string().nullable().optional(),
    })).optional(),
  })),
});

const BootstrapConfigSchema = z.object({
  host: z.object({
    id: z.string().uuid(),
    name: z.string(),
    region: z.string(),
    cluster: ClusterRefSchema,
    location: z.string(),
    public_ipv4: z.string().nullable(),
    public_ipv6: z.string().nullable(),
    runner_token: z.string(),
  }),
});

const ReconcileResponseSchema = z.object({
  checked_at: z.string(),
  hosts: z.array(z.object({
    host_id: z.string().uuid(),
    status: z.enum(['ok', 'error', 'skipped']),
    instance_count: z.number(),
    image_count: z.number(),
    stale_machine_ids: z.array(z.string().uuid()),
    stale_image_ids: z.array(z.string().uuid()),
    orphan_instance_ids: z.array(z.string()),
    error: z.string().optional(),
  })),
});

function machineHostId(machine: typeof machines.$inferSelect) {
  if (machine.baremetalHostId) return machine.baremetalHostId;
  const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
  return typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null;
}

function buildDrainReport(row: typeof baremetalHosts.$inferSelect, context?: {
  machines?: Array<typeof machines.$inferSelect>;
  reservations?: Array<typeof hostCapacityReservations.$inferSelect>;
  artifacts?: Array<typeof backupArtifacts.$inferSelect>;
}) {
  const hostMachines = (context?.machines ?? []).filter((machine) => machine.provider === 'baremetal' && machine.deletedAt === null && machineHostId(machine) === row.id);
  const activeMachines = hostMachines.filter((machine) => !['deleted', 'error', 'stopped'].includes(machine.status)).length;
  const stoppedMachines = hostMachines.filter((machine) => machine.status === 'stopped').length;
  const activeReservations = (context?.reservations ?? []).filter((reservation) => reservation.hostId === row.id && ['reserved', 'committed'].includes(reservation.state)).length;
  const pendingBackupArtifacts = (context?.artifacts ?? []).filter((artifact) => artifact.sourceHostId === row.id && ['creating'].includes(artifact.status)).length;
  return {
    active_machines: activeMachines,
    stopped_machines_retaining_disk: stoppedMachines,
    active_reservations: activeReservations,
    pending_backup_artifacts: pendingBackupArtifacts,
    blockers_total: activeMachines + stoppedMachines + activeReservations + pendingBackupArtifacts,
  };
}

function buildReconciliationReport(row: typeof baremetalHosts.$inferSelect) {
  const reconciliation = ((row.metadata ?? {}).reconciliation ?? {}) as Record<string, unknown>;
  return {
    checked_at: typeof reconciliation.checked_at === 'string' ? reconciliation.checked_at : null,
    instance_count: typeof reconciliation.instance_count === 'number' ? reconciliation.instance_count : 0,
    image_count: typeof reconciliation.image_count === 'number' ? reconciliation.image_count : 0,
    stale_machine_ids: Array.isArray(reconciliation.stale_machine_ids) ? reconciliation.stale_machine_ids.filter((id): id is string => typeof id === 'string') : [],
    stale_image_ids: Array.isArray(reconciliation.stale_image_ids) ? reconciliation.stale_image_ids.filter((id): id is string => typeof id === 'string') : [],
    orphan_instance_ids: Array.isArray(reconciliation.orphan_instance_ids) ? reconciliation.orphan_instance_ids.filter((id): id is string => typeof id === 'string') : [],
    warm_pool_instance_ids: Array.isArray(reconciliation.warm_pool_instance_ids) ? reconciliation.warm_pool_instance_ids.filter((id): id is string => typeof id === 'string') : [],
    error: typeof reconciliation.error === 'string' ? reconciliation.error : null,
  };
}

function buildBootstrapValidationArtifact(row: typeof baremetalHosts.$inferSelect) {
  const bootstrap = asRecord((row.metadata ?? {}).bootstrap);
  const validation = asRecord(bootstrap?.validation_artifact);
  return {
    status: validation?.status === 'passed' || validation?.status === 'warning' || validation?.status === 'failed' ? validation.status : null,
    bootstrap_version: typeof validation?.bootstrap_version === 'string' ? validation.bootstrap_version : null,
    runnerd_version: typeof validation?.runnerd_version === 'string' ? validation.runnerd_version : null,
    incus_version: typeof validation?.incus_version === 'string' ? validation.incus_version : null,
    storage_driver: typeof validation?.storage_driver === 'string' ? validation.storage_driver : null,
    storage_pool: typeof validation?.storage_pool === 'string' ? validation.storage_pool : null,
    started_at: typeof validation?.started_at === 'string' ? validation.started_at : null,
    completed_at: typeof validation?.completed_at === 'string' ? validation.completed_at : null,
    smoke_test_machine_id: typeof validation?.smoke_test_machine_id === 'string' ? validation.smoke_test_machine_id : null,
    smoke_test_result: validation?.smoke_test_result === 'passed' || validation?.smoke_test_result === 'failed' ? validation.smoke_test_result : null,
    warm_pool_result: validation?.warm_pool_result === 'passed' || validation?.warm_pool_result === 'failed' ? validation.warm_pool_result : null,
    triggered_by: typeof validation?.triggered_by === 'string' ? validation.triggered_by : null,
    notes: Array.isArray(validation?.notes) ? validation.notes.filter((note): note is string => typeof note === 'string') : [],
  };
}

function buildHostDriftStatus(row: typeof baremetalHosts.$inferSelect) {
  const bootstrap = asRecord((row.metadata ?? {}).bootstrap);
  const value = bootstrap?.drift_status;
  return value === 'in_policy' || value === 'warning_drift' || value === 'blocking_drift' ? value : null;
}

function buildHostIncusUiState(row: typeof baremetalHosts.$inferSelect) {
  const operator = asRecord((row.metadata ?? {}).operator);
  const incusUi = asRecord(operator?.incus_ui);
  const exposure = incusUi?.exposure;
  return {
    exposure: exposure === 'disabled' || exposure === 'operator_only' || exposure === 'cluster_console' ? exposure : null,
    url: typeof incusUi?.url === 'string' ? incusUi.url : null,
    note: typeof incusUi?.note === 'string' ? incusUi.note : null,
    updated_at: typeof incusUi?.updated_at === 'string' ? incusUi.updated_at : null,
  };
}

function buildHostSchedulerState(row: typeof baremetalHosts.$inferSelect) {
  const scheduler = asRecord((row.metadata ?? {}).scheduler);
  return {
    schedulable: typeof scheduler?.schedulable === 'boolean' ? scheduler.schedulable : null,
    unschedulable_reason: typeof scheduler?.unschedulableReason === 'string'
      ? scheduler.unschedulableReason
      : typeof scheduler?.unschedulable_reason === 'string'
        ? scheduler.unschedulable_reason
        : null,
    updated_at: typeof scheduler?.updatedAt === 'string'
      ? scheduler.updatedAt
      : typeof scheduler?.updated_at === 'string'
        ? scheduler.updated_at
        : null,
    updated_by: typeof scheduler?.updatedBy === 'string'
      ? scheduler.updatedBy
      : typeof scheduler?.updated_by === 'string'
        ? scheduler.updated_by
        : null,
  };
}

function buildHostClusterState(row: typeof baremetalHosts.$inferSelect) {
  return deriveClusterRef({
    region: row.region,
    hostName: row.name,
    metadata: row.metadata ?? {},
  });
}

export function serializeHost(row: typeof baremetalHosts.$inferSelect, context?: {
  machines?: Array<typeof machines.$inferSelect>;
  reservations?: Array<typeof hostCapacityReservations.$inferSelect>;
  artifacts?: Array<typeof backupArtifacts.$inferSelect>;
}) {
  return {
    id: row.id,
    vendor: row.vendor,
    host_class: row.hostClass,
    region: row.region,
    cluster: buildHostClusterState(row),
    location: row.location,
    name: row.name,
    status: row.status,
    maintenance_state: row.maintenanceState,
    maintenance_requested_at: row.maintenanceRequestedAt?.toISOString() ?? null,
    maintenance_started_at: row.maintenanceStartedAt?.toISOString() ?? null,
    maintenance_completed_at: row.maintenanceCompletedAt?.toISOString() ?? null,
    provider_server_number: row.providerServerNumber,
    provider_transaction_id: row.providerTransactionId,
    public_ipv4: row.publicIpv4,
    public_ipv6: row.publicIpv6,
    runner_base_url: row.runnerBaseUrl,
    total_vcpu: row.totalVcpu,
    total_memory_gb: row.totalMemoryGb,
    total_disk_gb: row.totalDiskGb,
    used_vcpu: row.usedVcpu,
    used_memory_gb: row.usedMemoryGb,
    used_disk_gb: row.usedDiskGb,
    last_heartbeat_at: row.lastHeartbeatAt?.toISOString() ?? null,
    drain_report: buildDrainReport(row, context),
    reconciliation_report: buildReconciliationReport(row),
    bootstrap_validation: buildBootstrapValidationArtifact(row),
    drift_status: buildHostDriftStatus(row),
    scheduler: buildHostSchedulerState(row),
    incus_ui: buildHostIncusUiState(row),
    metadata: row.metadata ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function serializeClusters(
  hostRows: Array<typeof baremetalHosts.$inferSelect>,
  regionRows: Array<RegionRow>,
) {
  const regionMap = new Map(regionRows.map((row) => [row.id, row]));
  const hostsByCluster = new Map<string, Array<typeof baremetalHosts.$inferSelect>>();

  for (const host of hostRows) {
    const cluster = buildHostClusterState(host);
    const bucket = hostsByCluster.get(cluster.id) ?? [];
    bucket.push(host);
    hostsByCluster.set(cluster.id, bucket);
  }

  return Array.from(hostsByCluster.entries())
    .map(([clusterId, hosts]) => {
      const clusterRef = buildHostClusterState(hosts[0]!);
      const regionRow = regionMap.get(clusterRef.region);
      const activeHosts = hosts.filter((host) => ["active", "bootstrapping"].includes(host.status));
      const activeSchedulableHosts = activeHosts.filter((host) => {
        const scheduler = asRecord((host.metadata ?? {}).scheduler);
        return host.maintenanceState === "in_service" && scheduler?.schedulable !== false;
      });
      const totals = hosts.reduce(
        (acc, host) => ({
          total_vcpu: acc.total_vcpu + (host.totalVcpu ?? 0),
          total_memory_gb: acc.total_memory_gb + (host.totalMemoryGb ?? 0),
          total_disk_gb: acc.total_disk_gb + (host.totalDiskGb ?? 0),
          used_vcpu: acc.used_vcpu + (host.usedVcpu ?? 0),
          used_memory_gb: acc.used_memory_gb + (host.usedMemoryGb ?? 0),
          used_disk_gb: acc.used_disk_gb + (host.usedDiskGb ?? 0),
        }),
        { total_vcpu: 0, total_memory_gb: 0, total_disk_gb: 0, used_vcpu: 0, used_memory_gb: 0, used_disk_gb: 0 },
      );

      return {
        id: clusterId,
        name: clusterRef.name,
        region: clusterRef.region,
        region_label: regionRow?.label ?? regionLabel(clusterRef.region),
        incus_cluster_name: clusterRef.incus_cluster_name,
        host_count: hosts.length,
        active_host_count: activeHosts.length,
        active_schedulable_host_count: activeSchedulableHosts.length,
        total_vcpu: totals.total_vcpu,
        total_memory_gb: totals.total_memory_gb,
        total_disk_gb: totals.total_disk_gb,
        used_vcpu: totals.used_vcpu,
        used_memory_gb: totals.used_memory_gb,
        used_disk_gb: totals.used_disk_gb,
        available_vcpu: Math.max(totals.total_vcpu - totals.used_vcpu, 0),
        available_memory_gb: Math.max(totals.total_memory_gb - totals.used_memory_gb, 0),
        available_disk_gb: Math.max(totals.total_disk_gb - totals.used_disk_gb, 0),
        admission_state: regionRow?.admissionState ?? "open",
        sellability_state: regionRow?.sellabilityState ?? "sellable",
        member_names: hosts.map((host) => buildHostClusterState(host).incus_member_name),
      };
    })
    .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
}

function serializeRegions(
  hostRows: Array<typeof baremetalHosts.$inferSelect>,
  regionRows: Array<RegionRow>,
) {
  const regionsById = new Map<string, RegionRow>(regionRows.map((row) => [row.id, row]));
  const hostsByRegion = new Map<string, Array<typeof baremetalHosts.$inferSelect>>();
  for (const host of hostRows) {
    const bucket = hostsByRegion.get(host.region);
    if (bucket) bucket.push(host);
    else hostsByRegion.set(host.region, [host]);
  }

  // Include every region from the regions table plus any orphan hosts whose
  // region_id isn't present in the regions table.
  const regionIds = new Set<string>([
    ...regionRows.map((row) => row.id),
    ...hostsByRegion.keys(),
  ]);

  const result = Array.from(regionIds).map((regionId) => {
    const regionRow = regionsById.get(regionId) ?? null;
    const info = findRegion(regionId);
    const hosts = hostsByRegion.get(regionId) ?? [];
    const activeHosts = hosts.filter((host) => ['active', 'bootstrapping'].includes(host.status));
    const activeSchedulableHosts = activeHosts.filter((host) => {
      if (host.maintenanceState !== 'in_service') return false;
      const scheduler = asRecord((host.metadata ?? {}).scheduler);
      return scheduler?.schedulable !== false;
    });

    const totals = hosts.reduce(
      (acc, host) => ({
        total_vcpu: acc.total_vcpu + (host.totalVcpu ?? 0),
        total_memory_gb: acc.total_memory_gb + (host.totalMemoryGb ?? 0),
        total_disk_gb: acc.total_disk_gb + (host.totalDiskGb ?? 0),
        used_vcpu: acc.used_vcpu + (host.usedVcpu ?? 0),
        used_memory_gb: acc.used_memory_gb + (host.usedMemoryGb ?? 0),
        used_disk_gb: acc.used_disk_gb + (host.usedDiskGb ?? 0),
      }),
      { total_vcpu: 0, total_memory_gb: 0, total_disk_gb: 0, used_vcpu: 0, used_memory_gb: 0, used_disk_gb: 0 },
    );

    const available_vcpu = Math.max(totals.total_vcpu - totals.used_vcpu, 0);
    const available_memory_gb = Math.max(totals.total_memory_gb - totals.used_memory_gb, 0);
    const available_disk_gb = Math.max(totals.total_disk_gb - totals.used_disk_gb, 0);

    const utilization_score = totals.total_vcpu > 0
      ? Math.round((totals.used_vcpu / totals.total_vcpu) * 10000)
      : 0;

    return {
      id: regionId,
      label: regionRow?.label ?? info?.label ?? regionLabel(regionId),
      continent: regionRow?.continent ?? info?.continent ?? 'EU',
      active: regionRow?.active ?? info?.active ?? false,
      admission_state: regionRow?.admissionState ?? 'open',
      sellability_state: regionRow?.sellabilityState ?? 'sellable',
      host_count: hosts.length,
      active_host_count: activeHosts.length,
      active_schedulable_host_count: activeSchedulableHosts.length,
      total_vcpu: totals.total_vcpu,
      total_memory_gb: totals.total_memory_gb,
      total_disk_gb: totals.total_disk_gb,
      used_vcpu: totals.used_vcpu,
      used_memory_gb: totals.used_memory_gb,
      used_disk_gb: totals.used_disk_gb,
      available_vcpu,
      available_memory_gb,
      available_disk_gb,
      utilization_score,
    };
  });

  return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadFleetOverviewState() {
  const [hostRows, reservationRows, regionRows] = await Promise.all([
    db.select().from(baremetalHosts),
    db.select().from(hostCapacityReservations),
    db.select().from(regions),
  ]);

  return {
    hostRows,
    reservationRows,
    regionRows,
    regions: serializeRegions(hostRows, regionRows),
    clusters: serializeClusters(hostRows, regionRows),
  };
}

function serializeProcurement(row: typeof baremetalProcurements.$inferSelect) {
  return {
    id: row.id,
    vendor: row.vendor,
    host_class: row.hostClass,
    product_id: row.productId,
    region: row.region,
    location: row.location,
    status: row.status,
    host_id: row.hostId,
    provider_transaction_id: row.providerTransactionId,
    requires_approval: row.requiresApproval,
    error: row.error,
    metadata: row.metadata ?? {},
    approved_at: row.approvedAt?.toISOString() ?? null,
    ordered_at: row.orderedAt?.toISOString() ?? null,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function serializeProcurementRecommendations(
  regionAggregates: ReturnType<typeof serializeRegions>,
  hostRows: Array<typeof baremetalHosts.$inferSelect>,
) {
  // Group hosts by (region, hostClass) to determine evolution recommendations.
  const hostsByRegionClass = new Map<string, Array<typeof baremetalHosts.$inferSelect>>();
  for (const host of hostRows) {
    const key = `${host.region}:${host.hostClass}`;
    const bucket = hostsByRegionClass.get(key);
    if (bucket) bucket.push(host);
    else hostsByRegionClass.set(key, [host]);
  }

  const recommendations: Array<{
    id: string;
    region: string;
    region_label: string;
    current_host_class: string;
    current_role: string;
    recommended_host_class: string;
    recommended_role: string;
    minimum_hosts: number;
    reserve_shortfall_vcpu: number;
    reserve_shortfall_memory_gb: number;
    reserve_shortfall_disk_gb: number;
    summary: string;
    notes: string[];
  }> = [];

  for (const regionAggregate of regionAggregates) {
    for (const [key] of hostsByRegionClass.entries()) {
      const [region, hostClass] = key.split(':');
      if (region !== regionAggregate.id) continue;

      const currentProfile = getBaremetalHostClassProfile(hostClass);
      const recommendedHostClass = currentProfile.preferredGrowthHostClass;
      const recommendedProfile = getBaremetalHostClassProfile(recommendedHostClass);

      const shouldEvolveHostClass = currentProfile.role === 'starter_edge' && recommendedHostClass !== hostClass;
      if (!shouldEvolveHostClass) continue;

      recommendations.push({
        id: `${region}:${hostClass}`,
        region,
        region_label: regionAggregate.label,
        current_host_class: hostClass,
        current_role: currentProfile.role,
        recommended_host_class: recommendedHostClass,
        recommended_role: recommendedProfile.role,
        minimum_hosts: 1,
        reserve_shortfall_vcpu: 0,
        reserve_shortfall_memory_gb: 0,
        reserve_shortfall_disk_gb: 0,
        summary: `${regionAggregate.label} should shift future growth from ${hostClass} to ${recommendedHostClass}.`,
        notes: [],
      });
    }
  }

  return recommendations;
}

function serializeControlPlaneServiceState(row: Awaited<ReturnType<typeof listControlPlaneServiceStates>>[number]) {
  const now = Date.now();
  const profile = CONTROL_PLANE_SERVICE_PROFILES[row.service as keyof typeof CONTROL_PLANE_SERVICE_PROFILES];
  return {
    id: row.id,
    service: row.service,
    scope: row.scope,
    critical: profile.critical,
    mode: profile.mode,
    description: profile.description,
    stale: profile.mode === 'periodic' ? isControlPlaneServiceStale(row, now) : false,
    age_ms_since_completion: row.lastCompletedAt ? now - row.lastCompletedAt.getTime() : null,
    lease_owner: row.leaseOwner,
    lease_expires_at: row.leaseExpiresAt?.toISOString() ?? null,
    last_started_at: row.lastStartedAt?.toISOString() ?? null,
    last_completed_at: row.lastCompletedAt?.toISOString() ?? null,
    checkpoint: (row.checkpoint ?? {}) as Record<string, unknown>,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

async function placeHetznerRobotOrder(procurementId: string, approvedByUserId?: string) {
  const [procurement] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurementId));
  if (!procurement) throw new Error('Procurement request not found');
  if (!config.hasHetznerRobotCredentials()) throw new Error('Hetzner Robot credentials are not configured');
  if (!config.BAREMETAL_BOOTSTRAP_PUBLIC_KEY) throw new Error('Bare-metal bootstrap public key is not configured');

  const robot = new HetznerRobotClient();
  const bootstrapFingerprint = await robot.ensureKey({
    name: 'justavps-bootstrap',
    data: config.BAREMETAL_BOOTSTRAP_PUBLIC_KEY,
  });
  const transaction = await robot.orderServer({
    productId: procurement.productId,
    location: procurement.location,
    distribution: 'Ubuntu 24.04 LTS base',
    authorizedKeys: [bootstrapFingerprint],
    addons: ['primary_ipv4'],
  });

  const hostId = procurement.hostId ?? randomUUID();
  const hostName = `bm-${procurement.hostClass}-${procurement.location}-${hostId.slice(0, 8)}`;
  const runnerToken = randomBytes(24).toString('hex');

  const [host] = await db.insert(baremetalHosts).values({
    id: hostId,
    vendor: procurement.vendor,
    hostClass: procurement.hostClass,
    region: procurement.region,
    location: procurement.location,
    name: hostName,
    status: 'ordering',
    providerTransactionId: transaction.transaction.id,
    providerServerNumber: transaction.transaction.server_number ? String(transaction.transaction.server_number) : null,
    publicIpv4: transaction.transaction.server_ip,
    runnerToken,
    metadata: {
      procurement_id: procurement.id,
      product_id: procurement.productId,
      order_status: transaction.transaction.status,
      bootstrap_key_fingerprint: bootstrapFingerprint,
    },
  }).onConflictDoNothing().returning();

  await db.update(baremetalProcurements).set({
    status: 'ordering',
    approvedByUserId: approvedByUserId ?? procurement.approvedByUserId,
    approvedAt: approvedByUserId ? new Date() : procurement.approvedAt,
    providerTransactionId: transaction.transaction.id,
    orderedAt: new Date(),
    hostId: host?.id ?? hostId,
    metadata: {
      ...(procurement.metadata ?? {}),
      order_status: transaction.transaction.status,
      server_ip: transaction.transaction.server_ip,
      bootstrap_key_fingerprint: bootstrapFingerprint,
    },
    updatedAt: new Date(),
  }).where(eq(baremetalProcurements.id, procurement.id));

  return { transactionId: transaction.transaction.id, hostId: host?.id ?? hostId };
}

adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/products/hetzner',
  tags: ['Admin Bare Metal'],
  summary: 'List Hetzner Robot dedicated products',
  request: {
    query: z.object({
      location: z.string().optional(),
      max_price: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: { description: 'Hetzner dedicated products', content: { 'application/json': { schema: HetznerProductListResponseSchema } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;
  if (!config.hasHetznerRobotCredentials()) return errorResponse(c, 400, 'Hetzner Robot credentials are not configured') as Response;

  try {
    const { location, max_price } = c.req.valid('query');
    const robot = new HetznerRobotClient();
    const products = await robot.listServerProducts({
      ...(location ? { location } : {}),
      ...(typeof max_price === 'number' ? { maxPrice: max_price } : {}),
    });
    return c.json({
      products: products.map((item) => ({
        id: item.product.id,
        name: item.product.name,
        location: item.product.location,
        description: item.product.description,
        traffic: item.product.traffic,
        prices: item.product.prices?.map((p) => ({
          location: p.location,
          monthly_net: p.price.net,
          monthly_gross: p.price.gross,
          hourly_net: p.price.hourly_net ?? null,
          hourly_gross: p.price.hourly_gross ?? null,
        })),
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/regions',
  tags: ['Admin Bare Metal'],
  summary: 'List regions with aggregate host capacity',
  responses: {
    200: { description: 'Regions', content: { 'application/json': { schema: z.object({ regions: z.array(RegionSchema) }) } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const overview = await loadFleetOverviewState();
    return c.json({ regions: overview.regions });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/regions/{id}/admission-state',
  tags: ['Admin Bare Metal'],
  summary: 'Update region admission and sellability state',
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            admission_state: RegionAdmissionStateSchema,
            sellability_state: RegionSellabilityStateSchema,
            reason: z.string().max(500).nullable().optional(),
            source: z.string().max(120).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Region admission updated', content: { 'application/json': { schema: z.object({ region: RegionSchema }) } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await db.select().from(regions).where(eq(regions.id, id));
    if (!existing) return errorResponse(c, 404, 'Region not found') as Response;

    const metadata = {
      ...(existing.metadata ?? {}),
      admission: {
        ...(asRecord((existing.metadata ?? {}).admission) ?? {}),
        reason: body.reason ?? null,
        source: body.source ?? 'admin-ui',
        set_at: new Date().toISOString(),
        changed_by_user_id: c.get('userId') ?? null,
      },
    };

    await db.update(regions).set({
      admissionState: body.admission_state,
      sellabilityState: body.sellability_state,
      metadata,
      updatedAt: new Date(),
    }).where(eq(regions.id, id));

    const overview = await loadFleetOverviewState();
    const region = overview.regions.find((row) => row.id === id);
    if (!region) return errorResponse(c, 404, 'Region not found after update') as Response;
    return c.json({ region });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

registerAdminFleetHostMutationRoutes(adminFleetV2App, requireAdmin, {
  updateValidationArtifact: async (id, body, userId) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      scheduler: {
        ...(asRecord((existing.metadata ?? {}).scheduler) ?? {}),
        schedulable: body.status === 'failed' ? false : true,
        unschedulableReason: body.status === 'failed' ? 'host quarantined after failed bootstrap validation' : null,
        updatedAt: new Date().toISOString(),
        updatedBy: body.triggered_by ?? userId ?? 'system/bootstrap-validation',
      },
      bootstrap: {
        ...(asRecord((existing.metadata ?? {}).bootstrap) ?? {}),
        validation_artifact: {
          status: body.status,
          bootstrap_version: body.bootstrap_version ?? null,
          runnerd_version: body.runnerd_version ?? null,
          incus_version: body.incus_version ?? null,
          storage_driver: body.storage_driver ?? null,
          storage_pool: body.storage_pool ?? null,
          started_at: body.started_at ?? null,
          completed_at: body.completed_at ?? new Date().toISOString(),
          smoke_test_machine_id: body.smoke_test_machine_id ?? null,
          smoke_test_result: body.smoke_test_result ?? null,
          warm_pool_result: body.warm_pool_result ?? null,
          triggered_by: body.triggered_by ?? userId ?? null,
          notes: body.notes ?? [],
        },
        drift_status: body.drift_status ?? buildHostDriftStatus(existing) ?? (body.status === 'failed' ? 'blocking_drift' : 'in_policy'),
      },
    };
    const nextHostStatus = body.status === 'failed' ? 'error' : existing.status === 'bootstrapping' ? 'active' : existing.status;
    const [host] = await db.update(baremetalHosts).set({ status: nextHostStatus, metadata: nextMetadata, updatedAt: new Date() }).where(eq(baremetalHosts.id, id)).returning();
    return serializeHost(host);
  },
  updateOperatorSettings: async (id, body) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');
    const now = new Date().toISOString();
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      operator: {
        ...(asRecord((existing.metadata ?? {}).operator) ?? {}),
        incus_ui: {
          exposure: body.incus_ui_exposure,
          url: body.incus_ui_url || null,
          note: body.incus_ui_note ?? null,
          updated_at: now,
        },
      },
    };
    const [host] = await db.update(baremetalHosts).set({ metadata: nextMetadata, updatedAt: new Date() }).where(eq(baremetalHosts.id, id)).returning();
    return serializeHost(host);
  },
  updateSchedulerState: async (id, body, userId) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      scheduler: {
        ...(asRecord((existing.metadata ?? {}).scheduler) ?? {}),
        schedulable: body.schedulable,
        unschedulableReason: body.schedulable ? null : (body.reason ?? 'host manually quarantined by operator'),
        updatedAt: new Date().toISOString(),
        updatedBy: userId ?? 'system/operator',
      },
    };
    const [host] = await db.update(baremetalHosts).set({ metadata: nextMetadata, updatedAt: new Date() }).where(eq(baremetalHosts.id, id)).returning();
    return serializeHost(host);
  },
  updateMaintenanceState: async (id, body, userId) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');
    const now = new Date();
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      maintenance: {
        ...(asRecord((existing.metadata ?? {}).maintenance) ?? {}),
        state: body.state,
        changed_by_user_id: userId,
        changed_at: now.toISOString(),
      },
    };
    const [host] = await db.update(baremetalHosts).set({
      maintenanceState: body.state,
      maintenanceRequestedAt: ['drain_requested', 'draining', 'drained', 'maintenance'].includes(body.state) ? (existing.maintenanceRequestedAt ?? now) : null,
      maintenanceStartedAt: ['draining', 'drained', 'maintenance'].includes(body.state) ? (existing.maintenanceStartedAt ?? now) : null,
      maintenanceCompletedAt: body.state === 'in_service' ? now : body.state === 'drained' ? (existing.maintenanceCompletedAt ?? now) : null,
      metadata: nextMetadata,
      updatedAt: now,
    }).where(eq(baremetalHosts.id, id)).returning();
    const [machineRows, reservationRows, artifactRows] = await Promise.all([
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
    ]);
    return serializeHost(host, {
      machines: machineRows,
      reservations: reservationRows,
      artifacts: artifactRows,
    });
  },
});

registerAdminFleetHostRoutes(adminFleetV2App, requireAdmin, {
  getBootstrapConfig: async (id) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');
    const [host] = existing.runnerToken
      ? [existing]
      : await db.update(baremetalHosts).set({ runnerToken: randomBytes(24).toString('hex'), updatedAt: new Date() }).where(eq(baremetalHosts.id, id)).returning();
    return {
      id: host.id,
      name: host.name,
      region: host.region,
      cluster: buildHostClusterState(host),
      location: host.location,
      public_ipv4: host.publicIpv4,
      public_ipv6: host.publicIpv6,
      runner_token: host.runnerToken,
    };
  },
  listHosts: async () => {
    const [rows, machineRows, reservationRows, artifactRows, regionRows] = await Promise.all([
      db.select().from(baremetalHosts),
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
      db.select().from(regions),
    ]);
    return {
      hosts: rows.map((row) => serializeHost(row, { machines: machineRows, reservations: reservationRows, artifacts: artifactRows })),
      regions: serializeRegions(rows, regionRows),
      clusters: serializeClusters(rows, regionRows),
    };
  },
  reconcileHosts: async () => {
    const { reconcileBaremetalFleet } = await import("@/server/platform/baremetal/reconcile");
    const result = await reconcileBaremetalFleet();
    return {
      checked_at: result.checkedAt,
      hosts: result.hosts.map((host: { hostId: string; status: string; instanceCount: number; imageCount: number; staleMachineIds: string[]; staleImageIds: string[]; orphanInstanceIds: string[]; error?: string | null }) => ({
        host_id: host.hostId,
        status: host.status,
        instance_count: host.instanceCount,
        image_count: host.imageCount,
        stale_machine_ids: host.staleMachineIds,
        stale_image_ids: host.staleImageIds,
        orphan_instance_ids: host.orphanInstanceIds,
        error: host.error ? host.error : null,
      })),
    };
  },
  cleanupHostOrphans: async (id) => {
    const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!host) throw new Error('Host not found');
    if (!host.runnerBaseUrl || !host.runnerToken) throw new Error('Host runner not registered');
    const reconciliation = buildReconciliationReport(host);
    const orphans = reconciliation.orphan_instance_ids;
    const skipped = reconciliation.warm_pool_instance_ids;
    if (orphans.length > 0) {
      const runner = new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken);
      for (const instanceId of orphans) {
        await runner.deleteInstance(instanceId).catch((error) => {
          throw new Error(`Failed to delete orphan ${instanceId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
    const { reconcileBaremetalHost } = await import("@/server/platform/baremetal/reconcile");
    await reconcileBaremetalHost(host.id);
    const [hostRows, machineRows, reservationRows, artifactRows] = await Promise.all([
      db.select().from(baremetalHosts),
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
    ]);
    const refreshed = hostRows.find((row) => row.id === host.id) ?? host;
    return { cleaned_instance_ids: orphans, skipped_instance_ids: skipped, host: serializeHost(refreshed, { machines: machineRows, reservations: reservationRows, artifacts: artifactRows }) };
  },
  createHost: async (body) => {
    const regionId = typeof body.region === 'string' ? body.region : '';
    const hostClass = typeof body.host_class === 'string' ? body.host_class : '';
    if (!regionId) throw new Error('region is required');
    if (!hostClass) throw new Error('host_class is required');
    const [regionRow] = await db.select().from(regions).where(eq(regions.id, regionId));
    if (!regionRow) throw new Error('Region not found');

    const hostId = randomUUID();
    const [host] = await db.insert(baremetalHosts).values({
      id: hostId,
      vendor: typeof body.vendor === 'string' ? body.vendor : 'manual',
      hostClass,
      region: regionId,
      location: String(body.location),
      name: typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : `host-${regionId}-${hostClass}-${hostId.slice(0, 8)}`,
      status: 'requested',
      publicIpv4: typeof body.public_ipv4 === 'string' ? body.public_ipv4 : null,
      publicIpv6: typeof body.public_ipv6 === 'string' ? body.public_ipv6 : null,
      metadata: {
        created_via: 'admin_api',
        ...(asRecord(body.metadata) ?? {}),
      },
      updatedAt: new Date(),
    }).returning();

    return serializeHost(host);
  },
  registerHost: async (id, body) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');
    const [host] = await db.update(baremetalHosts).set({
      runnerBaseUrl: String(body.runner_base_url),
      publicIpv4: typeof body.public_ipv4 === 'string' ? body.public_ipv4 : existing.publicIpv4,
      publicIpv6: typeof body.public_ipv6 === 'string' ? body.public_ipv6 : existing.publicIpv6,
      totalVcpu: Number(body.total_vcpu),
      totalMemoryGb: Number(body.total_memory_gb),
      totalDiskGb: Number(body.total_disk_gb),
      status: body.status === 'bootstrapping' ? 'bootstrapping' : 'active',
      metadata: { ...(existing.metadata ?? {}), ...((body.metadata as Record<string, unknown> | undefined) ?? {}) },
      updatedAt: new Date(),
    }).where(eq(baremetalHosts.id, id)).returning();
    return serializeHost(host);
  },
  heartbeatHost: async (id, body) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');

    const driftStatus = typeof body.drift_status === 'string' ? body.drift_status : 'in_policy';
    const healthy = Boolean(body.incus_ok) && Boolean(body.zfs_ok) && Boolean(body.runner_ok);
    const schedulable = healthy && driftStatus !== 'blocking_drift' && existing.maintenanceState === 'in_service' && ['active', 'bootstrapping'].includes(existing.status);
    const now = new Date();
    const nextStatus = existing.status === 'bootstrapping' && healthy ? 'active' : existing.status;
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      heartbeat: {
        checked_at: now.toISOString(),
        incus_ok: Boolean(body.incus_ok),
        zfs_ok: Boolean(body.zfs_ok),
        runner_ok: Boolean(body.runner_ok),
        drift_status: driftStatus,
        instance_count: Number(body.instance_count ?? 0),
        image_count: Number(body.image_count ?? 0),
        alerts: Array.isArray(body.alerts) ? body.alerts.filter((value: unknown): value is string => typeof value === 'string') : [],
      },
      scheduler: {
        ...(asRecord((existing.metadata ?? {}).scheduler) ?? {}),
        schedulable,
        unschedulableReason: schedulable ? null : (!healthy ? 'host heartbeat reported unhealthy services' : driftStatus === 'blocking_drift' ? 'host has blocking drift' : `host is ${existing.maintenanceState}`),
        updatedAt: now.toISOString(),
        updatedBy: 'system/heartbeat',
      },
      bootstrap: {
        ...(asRecord((existing.metadata ?? {}).bootstrap) ?? {}),
        drift_status: driftStatus,
      },
    };

    const [host] = await db.update(baremetalHosts).set({
      status: nextStatus,
      lastHeartbeatAt: now,
      metadata: nextMetadata,
      updatedAt: now,
    }).where(eq(baremetalHosts.id, id)).returning();

    return serializeHost(host);
  },
});

adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/hosts/{id}/bootstrap-config',
  tags: ['Admin Bare Metal'],
  summary: 'Get bootstrap configuration for a host',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Bootstrap configuration', content: { 'application/json': { schema: BootstrapConfigSchema } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;
  const { id } = c.req.valid('param');
  const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
  if (!existing) return errorResponse(c, 404, 'Host not found') as Response;
  const [host] = existing.runnerToken
    ? [existing]
    : await db.update(baremetalHosts).set({
        runnerToken: randomBytes(24).toString('hex'),
        updatedAt: new Date(),
      }).where(eq(baremetalHosts.id, id)).returning();
  return c.json({
    host: {
      id: host.id,
      name: host.name,
      region: host.region,
      cluster: buildHostClusterState(host),
      location: host.location,
      public_ipv4: host.publicIpv4,
      public_ipv6: host.publicIpv6,
      runner_token: host.runnerToken as string,
    },
  });
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/hosts',
  tags: ['Admin Bare Metal'],
  summary: 'List bare-metal hosts',
  responses: { 200: { description: 'Hosts', content: { 'application/json': { schema: HostListResponseSchema } } } },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  const [rows, machineRows, reservationRows, artifactRows, regionRows] = await Promise.all([
    db.select().from(baremetalHosts),
    db.select().from(machines),
    db.select().from(hostCapacityReservations),
    db.select().from(backupArtifacts),
    db.select().from(regions),
  ]);
  return c.json({
    hosts: rows.map((row) => serializeHost(row, {
      machines: machineRows,
      reservations: reservationRows,
      artifacts: artifactRows,
    })),
    regions: serializeRegions(rows, regionRows),
    clusters: serializeClusters(rows, regionRows),
  });
}) as any);

const HostDetailMachineSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  vcpu: z.number().nullable(),
  memory_gb: z.number().nullable(),
  disk_gb: z.number().nullable(),
  ip: z.string().nullable(),
  created_at: z.string(),
  last_heartbeat_at: z.string().nullable(),
  owner_user_id: z.string().nullable(),
  owner_email: z.string().nullable(),
});

const HostDetailReservationSchema = z.object({
  id: z.string().uuid(),
  machine_id: z.string().uuid(),
  machine_slug: z.string().nullable(),
  reservation_type: z.string(),
  state: z.string(),
  vcpu: z.number(),
  memory_gb: z.number(),
  disk_gb: z.number(),
  expires_at: z.string().nullable(),
  committed_at: z.string().nullable(),
  released_at: z.string().nullable(),
  created_at: z.string(),
});

const HostDetailMachineEventSchema = z.object({
  id: z.string().uuid(),
  machine_id: z.string().uuid(),
  machine_slug: z.string().nullable(),
  event: z.string(),
  stage: z.string().nullable(),
  message: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

const HostDetailBackupArtifactSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  source_machine_slug: z.string().nullable(),
  status: z.string(),
  artifact_type: z.string(),
  size_bytes: z.number().nullable(),
  created_at: z.string(),
});

const HostDetailImageCachedSchema = z.object({
  id: z.string().uuid(),
  image_id: z.string().uuid().nullable(),
  image_alias: z.string().nullable(),
  image_ref: z.string(),
  image_name: z.string().nullable(),
  availability_state: z.string(),
  source: z.string(),
  last_seen_at: z.string().nullable(),
  last_requested_at: z.string().nullable(),
});

const HostRunnerProbeSchema = z.object({
  reachable: z.boolean(),
  checked_at: z.string(),
  incus: z.object({
    status: z.enum(['ok', 'error']),
    server_version: z.string().nullable(),
    instance_count: z.number(),
    image_count: z.number(),
  }).optional(),
  error: z.string().optional(),
}).nullable();

const HostDetailResponseSchema = z.object({
  host: HostSchema,
  machines: z.array(HostDetailMachineSchema),
  reservations: z.array(HostDetailReservationSchema),
  events: z.array(HostDetailMachineEventSchema),
  backup_artifacts: z.array(HostDetailBackupArtifactSchema),
  runner_probe: HostRunnerProbeSchema,
  images_cached: z.array(HostDetailImageCachedSchema),
});

async function probeHostRunner(host: typeof baremetalHosts.$inferSelect): Promise<{
  reachable: boolean;
  checked_at: string;
  incus?: { status: 'ok' | 'error'; server_version: string | null; instance_count: number; image_count: number };
  error?: string;
} | null> {
  if (!host.runnerBaseUrl || !host.runnerToken) return null;
  const checkedAt = new Date().toISOString();
  try {
    // Wrap the runner getState() call with an AbortSignal timeout so an
    // unreachable runner does not block the admin page.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    // getState() does not currently accept an abort signal, but it delegates
    // to fetch under the hood. We run it in a race so the request never
    // exceeds 5s from the operator's perspective.
    const client = new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken);
    try {
      const state = await Promise.race<{
        checkedAt: string;
        incus: { status: 'ok' | 'error'; serverVersion: string | null; instanceCount: number; imageCount: number };
      } | never>([
        client.getState() as Promise<{
          checkedAt: string;
          incus: { status: 'ok' | 'error'; serverVersion: string | null; instanceCount: number; imageCount: number };
        }>,
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('runner probe timed out after 5s')));
        }),
      ]);
      return {
        reachable: true,
        checked_at: checkedAt,
        incus: {
          status: state.incus.status,
          server_version: state.incus.serverVersion,
          instance_count: state.incus.instanceCount,
          image_count: state.incus.imageCount,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return {
      reachable: false,
      checked_at: checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/hosts/{id}',
  tags: ['Admin Bare Metal'],
  summary: 'Get full detail for a single bare-metal host (machines, reservations, events, runner probe)',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Host detail', content: { 'application/json': { schema: HostDetailResponseSchema } } },
    404: { description: 'Host not found' },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const [hostRow] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!hostRow) return errorResponse(c, 404, 'Host not found') as Response;

    // Load machines currently assigned to this host (non-deleted) joined to
    // owner email in a single query. Fall back to owner_user_id if the user
    // row isn't found.
    const hostMachineRows = await db
      .select({
        id: machines.id,
        slug: machines.slug,
        name: machines.name,
        status: machines.status,
        vcpu: machines.vcpu,
        ramGb: machines.ramGb,
        diskGb: machines.diskGb,
        ip: machines.ip,
        createdAt: machines.createdAt,
        lastHeartbeatAt: machines.lastHeartbeatAt,
        ownerId: machines.ownerId,
        ownerEmail: users.email,
      })
      .from(machines)
      .leftJoin(users, eq(users.id, machines.ownerId))
      .where(and(eq(machines.baremetalHostId, hostRow.id), isNull(machines.deletedAt)));

    // Reservations, backup artifacts, and host-image cache rows all scope by host_id.
    const [reservationRows, backupArtifactRows, hostImageRows, allMachineRows] = await Promise.all([
      db.select().from(hostCapacityReservations).where(eq(hostCapacityReservations.hostId, hostRow.id)),
      db.select().from(backupArtifacts).where(eq(backupArtifacts.sourceHostId, hostRow.id)),
      db.select().from(baremetalHostImages).where(eq(baremetalHostImages.hostId, hostRow.id)),
      db.select().from(machines),
    ]);

    // Recent machine events for machines currently or previously on this host.
    const hostMachineIds = allMachineRows
      .filter((m) => m.baremetalHostId === hostRow.id)
      .map((m) => m.id);
    const machineSlugById = new Map<string, string>(allMachineRows.map((m) => [m.id, m.slug]));
    const eventRows = hostMachineIds.length > 0
      ? await db
          .select()
          .from(machineEvents)
          .where(inArray(machineEvents.machineId, hostMachineIds))
          .orderBy(desc(machineEvents.createdAt))
          .limit(50)
      : [];

    // Resolve image names for cached host images (best effort).
    const imageIds = hostImageRows
      .map((row) => row.imageId)
      .filter((id): id is string => Boolean(id));
    const imageNameById = new Map<string, string>();
    if (imageIds.length > 0) {
      const imageRows = await db.select().from(images).where(inArray(images.id, imageIds));
      for (const img of imageRows) imageNameById.set(img.id, img.name);
    }

    // Probe the runner (non-blocking on failure, 5s timeout).
    const runnerProbe = await probeHostRunner(hostRow);

    const serialized = serializeHost(hostRow, {
      machines: allMachineRows,
      reservations: reservationRows,
      artifacts: backupArtifactRows,
    });

    return c.json({
      host: serialized,
      machines: hostMachineRows.map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        status: m.status,
        vcpu: m.vcpu ?? null,
        memory_gb: m.ramGb ?? null,
        disk_gb: m.diskGb ?? null,
        ip: m.ip ?? null,
        created_at: m.createdAt.toISOString(),
        last_heartbeat_at: m.lastHeartbeatAt?.toISOString() ?? null,
        owner_user_id: m.ownerId ?? null,
        owner_email: m.ownerEmail ?? null,
      })),
      reservations: reservationRows
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({
          id: row.id,
          machine_id: row.machineId,
          machine_slug: machineSlugById.get(row.machineId) ?? null,
          reservation_type: row.reservationType,
          state: row.state,
          vcpu: row.vcpu,
          memory_gb: row.memoryGb,
          disk_gb: row.diskGb,
          expires_at: row.expiresAt?.toISOString() ?? null,
          committed_at: row.committedAt?.toISOString() ?? null,
          released_at: row.releasedAt?.toISOString() ?? null,
          created_at: row.createdAt.toISOString(),
        })),
      events: eventRows.map((row) => ({
        id: row.id,
        machine_id: row.machineId,
        machine_slug: machineSlugById.get(row.machineId) ?? null,
        event: row.event,
        stage: row.stage ?? null,
        message: row.message ?? null,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        created_at: row.createdAt.toISOString(),
      })),
      backup_artifacts: backupArtifactRows
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20)
        .map((row) => ({
          id: row.id,
          display_name: row.displayName ?? null,
          source_machine_slug: row.sourceMachineSlug ?? null,
          status: row.status,
          artifact_type: row.artifactType,
          size_bytes: row.sizeBytes ?? null,
          created_at: row.createdAt.toISOString(),
        })),
      runner_probe: runnerProbe,
      images_cached: hostImageRows.map((row) => ({
        id: row.id,
        image_id: row.imageId ?? null,
        image_alias: row.imageAlias ?? null,
        image_ref: row.imageRef,
        image_name: row.imageId ? imageNameById.get(row.imageId) ?? null : null,
        availability_state: row.availabilityState,
        source: row.source,
        last_seen_at: row.lastSeenAt?.toISOString() ?? null,
        last_requested_at: row.lastRequestedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/reconcile',
  tags: ['Admin Bare Metal'],
  summary: 'Reconcile DB state against live bare-metal hosts',
  responses: { 200: { description: 'Fleet reconciled', content: { 'application/json': { schema: ReconcileResponseSchema } } } },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { reconcileBaremetalFleet } = await import("@/server/platform/baremetal/reconcile");
    const result = await reconcileBaremetalFleet();
    return c.json({
      checked_at: result.checkedAt,
      hosts: result.hosts.map((host: { hostId: string; status: string; instanceCount: number; imageCount: number; staleMachineIds: string[]; staleImageIds: string[]; orphanInstanceIds: string[]; error?: string | null }) => ({
        host_id: host.hostId,
        status: host.status,
        instance_count: host.instanceCount,
        image_count: host.imageCount,
        stale_machine_ids: host.staleMachineIds,
        stale_image_ids: host.staleImageIds,
        orphan_instance_ids: host.orphanInstanceIds,
        error: host.error ? host.error : null,
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/{id}/cleanup-orphans',
  tags: ['Admin Bare Metal'],
  summary: 'Delete non-warm orphan instances from a host',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Host orphans cleaned',
      content: { 'application/json': { schema: z.object({
        cleaned_instance_ids: z.array(z.string()),
        skipped_instance_ids: z.array(z.string()),
        host: HostSchema,
      }) } },
    },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!host) return errorResponse(c, 404, 'Host not found') as Response;
    if (!host.runnerBaseUrl || !host.runnerToken) return errorResponse(c, 400, 'Host runner not registered') as Response;

    const reconciliation = buildReconciliationReport(host);
    const orphans = reconciliation.orphan_instance_ids;
    const skipped = reconciliation.warm_pool_instance_ids;
    const cleaned = orphans;

    if (cleaned.length > 0) {
      const runner = new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken);
      for (const instanceId of cleaned) {
        await runner.deleteInstance(instanceId).catch((error) => {
          throw new Error(`Failed to delete orphan ${instanceId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }

    const { reconcileBaremetalHost } = await import("@/server/platform/baremetal/reconcile");
    await reconcileBaremetalHost(host.id);

    const [hostRows, machineRows, reservationRows, artifactRows] = await Promise.all([
      db.select().from(baremetalHosts),
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
    ]);
    const refreshed = hostRows.find((row) => row.id === host.id) ?? host;

    return c.json({
      cleaned_instance_ids: cleaned,
      skipped_instance_ids: skipped,
      host: serializeHost(refreshed, {
        machines: machineRows,
        reservations: reservationRows,
        artifacts: artifactRows,
      }),
    });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/{id}/validation-artifact',
  tags: ['Admin Bare Metal'],
  summary: 'Record a bootstrap validation artifact for a host',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            status: z.enum(['passed', 'warning', 'failed']),
            bootstrap_version: z.string().optional(),
            runnerd_version: z.string().optional(),
            incus_version: z.string().optional(),
            storage_driver: z.string().optional(),
            storage_pool: z.string().optional(),
            started_at: z.string().datetime().optional(),
            completed_at: z.string().datetime().optional(),
            smoke_test_machine_id: z.string().optional(),
            smoke_test_result: z.enum(['passed', 'failed']).optional(),
            warm_pool_result: z.enum(['passed', 'failed']).optional(),
            drift_status: z.enum(['in_policy', 'warning_drift', 'blocking_drift']).optional(),
            triggered_by: z.string().optional(),
            notes: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Host validation artifact recorded', content: { 'application/json': { schema: z.object({ host: HostSchema }) } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) return errorResponse(c, 404, 'Host not found') as Response;

    const nextMetadata = {
      ...(existing.metadata ?? {}),
      scheduler: {
        ...(asRecord((existing.metadata ?? {}).scheduler) ?? {}),
        schedulable: body.status === 'failed' ? false : true,
        unschedulableReason: body.status === 'failed' ? 'host quarantined after failed bootstrap validation' : null,
        updatedAt: new Date().toISOString(),
        updatedBy: body.triggered_by ?? c.get('userId') ?? 'system/bootstrap-validation',
      },
      bootstrap: {
        ...(asRecord((existing.metadata ?? {}).bootstrap) ?? {}),
        validation_artifact: {
          status: body.status,
          bootstrap_version: body.bootstrap_version ?? null,
          runnerd_version: body.runnerd_version ?? null,
          incus_version: body.incus_version ?? null,
          storage_driver: body.storage_driver ?? null,
          storage_pool: body.storage_pool ?? null,
          started_at: body.started_at ?? null,
          completed_at: body.completed_at ?? new Date().toISOString(),
          smoke_test_machine_id: body.smoke_test_machine_id ?? null,
          smoke_test_result: body.smoke_test_result ?? null,
          warm_pool_result: body.warm_pool_result ?? null,
          triggered_by: body.triggered_by ?? c.get('userId') ?? null,
          notes: body.notes ?? [],
        },
        drift_status: body.drift_status ?? buildHostDriftStatus(existing) ?? (body.status === 'failed' ? 'blocking_drift' : 'in_policy'),
      },
    };

    const nextHostStatus = body.status === 'failed'
      ? 'error'
      : existing.status === 'bootstrapping'
        ? 'active'
        : existing.status;

    const [host] = await db.update(baremetalHosts).set({
      status: nextHostStatus,
      metadata: nextMetadata,
      updatedAt: new Date(),
    }).where(eq(baremetalHosts.id, id)).returning();

    return c.json({ host: serializeHost(host) });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/{id}/operator-settings',
  tags: ['Admin Bare Metal'],
  summary: 'Update operator-only host settings such as Incus UI exposure',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            incus_ui_exposure: z.enum(['disabled', 'operator_only', 'cluster_console']),
            incus_ui_url: z.string().url().optional().or(z.literal('')),
            incus_ui_note: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Host operator settings updated', content: { 'application/json': { schema: z.object({ host: HostSchema }) } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) return errorResponse(c, 404, 'Host not found') as Response;

    const now = new Date().toISOString();
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      operator: {
        ...(asRecord((existing.metadata ?? {}).operator) ?? {}),
        incus_ui: {
          exposure: body.incus_ui_exposure,
          url: body.incus_ui_url || null,
          note: body.incus_ui_note ?? null,
          updated_at: now,
        },
      },
    };

    const [host] = await db.update(baremetalHosts).set({
      metadata: nextMetadata,
      updatedAt: new Date(),
    }).where(eq(baremetalHosts.id, id)).returning();

    return c.json({ host: serializeHost(host) });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/{id}/scheduler-state',
  tags: ['Admin Bare Metal'],
  summary: 'Update scheduler quarantine state for a host',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            schedulable: z.boolean(),
            reason: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Host scheduler state updated', content: { 'application/json': { schema: z.object({ host: HostSchema }) } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) return errorResponse(c, 404, 'Host not found') as Response;

    const nextMetadata = {
      ...(existing.metadata ?? {}),
      scheduler: {
        ...(asRecord((existing.metadata ?? {}).scheduler) ?? {}),
        schedulable: body.schedulable,
        unschedulableReason: body.schedulable ? null : (body.reason ?? 'host manually quarantined by operator'),
        updatedAt: new Date().toISOString(),
        updatedBy: c.get('userId') ?? 'system/operator',
      },
    };

    const [host] = await db.update(baremetalHosts).set({
      metadata: nextMetadata,
      updatedAt: new Date(),
    }).where(eq(baremetalHosts.id, id)).returning();

    return c.json({ host: serializeHost(host) });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

registerAdminFleetServiceStateRoutes(adminFleetV2App, requireAdmin, {
  listServices: async () => {
    const rows = await listControlPlaneServiceStates();
    return rows.map(serializeControlPlaneServiceState);
  },
});

registerAdminFleetAuditRoutes(adminFleetV2App, requireAdmin, {
  loadConfigAudit: async () => {
    const fleetHostAudit = await loadFleetHostAuditSummary();
    const checks = await loadConfigAuditChecks(fleetHostAudit.hostRows);
    return { ...summarizeConfigAudit(checks), checks };
  },
  loadHostAudit: async () => {
    const audit = await loadFleetHostAuditSummary();
    return {
      summary: audit.summary,
      pending_validation: audit.pendingValidation,
      quarantined: audit.quarantined,
      warning_drift: audit.warningDrift,
      blocking_drift: audit.blockingDrift,
    };
  },
});

registerAdminFleetControlPlaneRoutes(adminFleetV2App, requireAdmin);
registerAdminFleetProcurementRoutes(adminFleetV2App, requireAdmin, {
  listProcurements: async () => {
    const rows = await db.select().from(baremetalProcurements);
    return rows.map(serializeProcurement);
  },
  createProcurement: async (body, userId) => {
    const requestedByUserId = userId ?? randomUUID();
    const requiresApproval = body.requires_approval ?? config.BAREMETAL_PURCHASE_APPROVAL_REQUIRED;
    const productId = String(body.product_id ?? '').trim();
    if (!productId) throw new Error('product_id is required');

    // Auto-derive location + region from the product's available datacenters if
    // the caller didn't specify. This keeps the Order UX to a single choice: the
    // Hetzner product. The first available DC wins; region is mapped from the
    // DC prefix via REGIONS.hetznerLocations.
    let location = typeof body.location === 'string' && body.location.trim() ? body.location.trim() : '';
    if (!location && config.hasHetznerRobotCredentials()) {
      try {
        const robot = new HetznerRobotClient();
        const products = await robot.listServerProducts();
        const product = products.find((p) => p.product.id === productId);
        location = product?.product.location?.[0] ?? '';
      } catch {
        // fall through — require explicit location if product lookup fails
      }
    }
    if (!location) throw new Error('Could not determine datacenter from product; ensure Hetzner credentials are configured or pass an explicit location.');

    // Region derives from which REGIONS bucket contains the location.
    const regionFromLocation = REGIONS.find((r) => (r.hetznerLocations as readonly string[]).includes(location))?.id;
    const region = typeof body.region === 'string' && body.region.trim() ? body.region.trim() : regionFromLocation ?? 'eu';

    // host_class = the Hetzner product id (lowercased). This is the hardware
    // identity — no extra abstraction layer.
    const hostClass = typeof body.host_class === 'string' && body.host_class.trim()
      ? body.host_class.trim()
      : productId.toLowerCase();

    const [procurement] = await db.insert(baremetalProcurements).values({
      vendor: String(body.vendor ?? 'hetzner_robot'),
      hostClass,
      productId,
      region,
      location,
      status: requiresApproval ? 'requested' : 'approved',
      requestedByUserId,
      approvedByUserId: requiresApproval ? null : userId,
      approvedAt: requiresApproval ? null : new Date(),
      requiresApproval,
      metadata: {},
    }).returning();
    if (!requiresApproval) await placeHetznerRobotOrder(procurement.id, userId ?? undefined);
    const [fresh] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurement.id));
    return serializeProcurement(fresh);
  },
  listRecommendations: async () => {
    const overview = await loadFleetOverviewState();
    return serializeProcurementRecommendations(overview.regions, overview.hostRows);
  },
  approveProcurement: (id, userId) => placeHetznerRobotOrder(id, userId ?? undefined),
  syncProcurement: async (id) => {
    const [procurement] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, id));
    if (!procurement) throw new Error('Procurement not found');
    if (!procurement.providerTransactionId) throw new Error('Procurement has no provider transaction');
    if (!config.hasHetznerRobotCredentials()) throw new Error('Hetzner Robot credentials are not configured');
    const robot = new HetznerRobotClient();
    const tx = await robot.getOrderTransaction(procurement.providerTransactionId);
    await db.update(baremetalProcurements).set({
      status: tx.transaction.status === 'ready' ? 'bootstrapping' : procurement.status,
      metadata: {
        ...(procurement.metadata ?? {}),
        order_status: tx.transaction.status,
        server_ip: tx.transaction.server_ip,
      },
      resolvedAt: tx.transaction.status === 'ready' ? new Date() : procurement.resolvedAt,
      updatedAt: new Date(),
    }).where(eq(baremetalProcurements.id, procurement.id));
    if (procurement.hostId) {
      await db.update(baremetalHosts).set({
        status: tx.transaction.status === 'ready' ? 'bootstrapping' : 'ordering',
        providerServerNumber: tx.transaction.server_number ? String(tx.transaction.server_number) : null,
        publicIpv4: tx.transaction.server_ip,
        metadata: { order_status: tx.transaction.status, procurement_id: procurement.id },
        updatedAt: new Date(),
      }).where(eq(baremetalHosts.id, procurement.hostId));
    }
    const [fresh] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurement.id));
    return serializeProcurement(fresh);
  },
});

registerAdminFleetBenchmarkRoutes(adminFleetV2App, requireAdmin);

// Ensure REGIONS is referenced to keep it imported even if not yet used in
// every code path. We may use it in the future for bootstrapping the regions
// table or for validation, and keeping the import surface explicit documents
// the dependency.
void REGIONS;
