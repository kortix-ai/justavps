/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'crypto';
import { db } from '@/server/db';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse, handleRouteError } from "@/server/core/route-helpers";
import { config } from "@/server/core/config";
import { backupArtifacts, baremetalHosts, baremetalProcurements, cellAdmissionControls, cellCapacitySnapshots, cells, hostCapacityReservations, machines } from '@/server/db/schema';
import { buildBaremetalCellCapacitySnapshots, buildBaremetalCellState, normalizeBaremetalHostGeneration } from "@/server/platform/baremetal/cells";
import { ensureBaremetalCellRecord } from "@/server/platform/baremetal/cell-store";
import { getBaremetalHostClassProfile } from "@/server/platform/baremetal/host-class-profiles";
import { HOST_MAINTENANCE_STATES } from "@/server/platform/baremetal/host-maintenance";
import { HttpBaremetalRunnerClient } from "@/server/platform/baremetal/runner-client";
import { HetznerRobotClient } from "@/server/platform/baremetal/vendors/hetzner-robot";
import { CONTROL_PLANE_SERVICE_PROFILES, isControlPlaneServiceStale, listControlPlaneServiceStates } from "@/server/platform/control-plane/service-state";
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
const CellAdmissionStateSchema = z.enum(['open', 'restricted', 'closed']);
const CellSellabilityStateSchema = z.enum(['sellable', 'reserve_only', 'unsellable']);
const CellCapacitySchema = z.object({
  vcpu: z.number().int().min(0),
  memory_gb: z.number().int().min(0),
  disk_gb: z.number().int().min(0),
});

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

const HostListResponseSchema = z.object({
  hosts: z.array(z.object({
    id: z.string().uuid(),
    vendor: z.string(),
    host_class: z.string(),
    generation: z.string(),
    region: z.string(),
    location: z.string(),
    cell_id: z.string().uuid().nullable(),
    cell_slug: z.string(),
    cell_name: z.string(),
    cell_admission_state: z.enum(['open', 'restricted', 'closed']),
    cell_sellability_state: z.enum(['sellable', 'reserve_only', 'unsellable']),
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
  cells: z.array(z.object({
    id: z.string().uuid().nullable(),
    slug: z.string(),
    name: z.string(),
    region: z.string(),
    host_class: z.string(),
    generation: z.string(),
    status: z.string(),
    host_count: z.number(),
    active_host_count: z.number(),
    active_schedulable_host_count: z.number(),
    constrained_host_count: z.number(),
    admission_state: z.enum(['open', 'restricted', 'closed']),
    sellability_state: z.enum(['sellable', 'reserve_only', 'unsellable']),
    admission_reason: z.string().nullable(),
    total_vcpu: z.number(),
    total_memory_gb: z.number(),
    total_disk_gb: z.number(),
    used_vcpu: z.number(),
    used_memory_gb: z.number(),
    used_disk_gb: z.number(),
    reserved_vcpu: z.number(),
    reserved_memory_gb: z.number(),
    reserved_disk_gb: z.number(),
    reserve_budget_vcpu: z.number(),
    reserve_budget_memory_gb: z.number(),
    reserve_budget_disk_gb: z.number(),
    available_vcpu: z.number(),
    available_memory_gb: z.number(),
    available_disk_gb: z.number(),
    sellable_vcpu: z.number(),
    sellable_memory_gb: z.number(),
    sellable_disk_gb: z.number(),
    utilization_score: z.number(),
  })),
});

const HostSchema = HostListResponseSchema.shape.hosts.element;
const CellSchema = HostListResponseSchema.shape.cells.element;

const HetznerProductListResponseSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    name: z.string(),
    location: z.array(z.string()).optional(),
    description: z.array(z.string()).optional(),
  })),
});

const BootstrapConfigSchema = z.object({
  host: z.object({
    id: z.string().uuid(),
    name: z.string(),
    region: z.string(),
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

type CellSerializationContext = {
  rows?: Array<typeof cells.$inferSelect>;
  admissions?: Array<typeof cellAdmissionControls.$inferSelect>;
};

function buildCellSerializationMaps(context?: CellSerializationContext) {
  return {
    cellsById: new Map((context?.rows ?? []).map((row) => [row.id, row])),
    admissionsByCellId: new Map((context?.admissions ?? []).map((row) => [row.cellId, row])),
  };
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

function serializeHost(row: typeof baremetalHosts.$inferSelect, context?: {
  machines?: Array<typeof machines.$inferSelect>;
  reservations?: Array<typeof hostCapacityReservations.$inferSelect>;
  artifacts?: Array<typeof backupArtifacts.$inferSelect>;
  cellRows?: Array<typeof cells.$inferSelect>;
  cellAdmissions?: Array<typeof cellAdmissionControls.$inferSelect>;
}) {
  const { cellsById, admissionsByCellId } = buildCellSerializationMaps({
    rows: context?.cellRows,
    admissions: context?.cellAdmissions,
  });
  const cell = buildBaremetalCellState({
    region: row.region,
    hostClass: row.hostClass,
    generation: row.generation,
    cellId: row.cellId,
    metadata: row.metadata,
    cell: row.cellId ? cellsById.get(row.cellId) ?? null : null,
    admission: row.cellId ? admissionsByCellId.get(row.cellId) ?? null : null,
  });
  return {
    id: row.id,
    vendor: row.vendor,
    host_class: row.hostClass,
    generation: normalizeBaremetalHostGeneration(row.generation, row.metadata),
    region: row.region,
    location: row.location,
    cell_id: row.cellId,
    cell_slug: cell?.slug ?? 'unassigned',
    cell_name: cell?.name ?? 'Unassigned',
    cell_admission_state: cell?.admission.state ?? 'open',
    cell_sellability_state: cell?.admission.sellability ?? 'sellable',
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

function serializeCells(
  rows: Array<typeof baremetalHosts.$inferSelect>,
  reservations: Array<typeof hostCapacityReservations.$inferSelect>,
  context?: CellSerializationContext,
) {
  const { cellsById, admissionsByCellId } = buildCellSerializationMaps(context);
  return buildBaremetalCellCapacitySnapshots(rows.map((row) => {
    const hostReservations = reservations.filter((reservation) => reservation.hostId === row.id && ['reserved', 'committed'].includes(reservation.state));
    return {
      id: row.id,
      region: row.region,
      hostClass: row.hostClass,
      generation: row.generation,
      cellId: row.cellId,
      cell: buildBaremetalCellState({
        region: row.region,
        hostClass: row.hostClass,
        generation: row.generation,
        cellId: row.cellId,
        metadata: row.metadata,
        cell: row.cellId ? cellsById.get(row.cellId) ?? null : null,
        admission: row.cellId ? admissionsByCellId.get(row.cellId) ?? null : null,
      }),
      status: row.status,
      maintenanceState: row.maintenanceState,
      metadata: row.metadata,
      capacity: {
        totalVcpu: row.totalVcpu ?? 0,
        totalMemoryGb: row.totalMemoryGb ?? 0,
        totalDiskGb: row.totalDiskGb ?? 0,
        usedVcpu: row.usedVcpu ?? 0,
        usedMemoryGb: row.usedMemoryGb ?? 0,
        usedDiskGb: row.usedDiskGb ?? 0,
      },
      reservations: {
        reserved: {
          vcpu: hostReservations.filter((reservation) => reservation.state === 'reserved').reduce((sum, reservation) => sum + reservation.vcpu, 0),
          memoryGb: hostReservations.filter((reservation) => reservation.state === 'reserved').reduce((sum, reservation) => sum + reservation.memoryGb, 0),
          diskGb: hostReservations.filter((reservation) => reservation.state === 'reserved').reduce((sum, reservation) => sum + reservation.diskGb, 0),
        },
        committed: {
          vcpu: hostReservations.filter((reservation) => reservation.state === 'committed').reduce((sum, reservation) => sum + reservation.vcpu, 0),
          memoryGb: hostReservations.filter((reservation) => reservation.state === 'committed').reduce((sum, reservation) => sum + reservation.memoryGb, 0),
          diskGb: hostReservations.filter((reservation) => reservation.state === 'committed').reduce((sum, reservation) => sum + reservation.diskGb, 0),
        },
      },
    };
  })).map((snapshot) => ({
    id: snapshot.cell.id,
    slug: snapshot.cell.slug,
    name: snapshot.cell.name,
    region: snapshot.cell.region,
    host_class: snapshot.cell.hostClass,
    generation: snapshot.cell.generation,
    status: snapshot.cell.status,
    host_count: snapshot.hostCount,
    active_host_count: snapshot.activeHostCount,
    active_schedulable_host_count: snapshot.activeSchedulableHostCount,
    constrained_host_count: snapshot.constrainedHostCount,
    admission_state: snapshot.cell.admission.state,
    sellability_state: snapshot.cell.admission.sellability,
    admission_reason: snapshot.cell.admission.reason,
    total_vcpu: snapshot.totals.vcpu,
    total_memory_gb: snapshot.totals.memoryGb,
    total_disk_gb: snapshot.totals.diskGb,
    used_vcpu: snapshot.used.vcpu,
    used_memory_gb: snapshot.used.memoryGb,
    used_disk_gb: snapshot.used.diskGb,
    reserved_vcpu: snapshot.reserved.vcpu,
    reserved_memory_gb: snapshot.reserved.memoryGb,
    reserved_disk_gb: snapshot.reserved.diskGb,
    reserve_budget_vcpu: snapshot.reserveBudget.vcpu,
    reserve_budget_memory_gb: snapshot.reserveBudget.memoryGb,
    reserve_budget_disk_gb: snapshot.reserveBudget.diskGb,
    available_vcpu: snapshot.available.vcpu,
    available_memory_gb: snapshot.available.memoryGb,
    available_disk_gb: snapshot.available.diskGb,
    sellable_vcpu: snapshot.sellable.vcpu,
    sellable_memory_gb: snapshot.sellable.memoryGb,
    sellable_disk_gb: snapshot.sellable.diskGb,
    utilization_score: snapshot.utilizationScore,
  }));
}

async function loadFleetOverviewState() {
  const [hostRows, reservationRows, cellRows, admissionRows] = await Promise.all([
    db.select().from(baremetalHosts),
    db.select().from(hostCapacityReservations),
    db.select().from(cells),
    db.select().from(cellAdmissionControls),
  ]);

  return {
    hostRows,
    reservationRows,
    cellRows,
    admissionRows,
    cells: serializeCells(hostRows, reservationRows, { rows: cellRows, admissions: admissionRows }),
  };
}

function serializeProcurement(row: typeof baremetalProcurements.$inferSelect) {
  return {
    id: row.id,
    vendor: row.vendor,
    host_class: row.hostClass,
    generation: row.generation,
    target_cell_id: row.targetCellId,
    procurement_purpose: row.procurementPurpose,
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

function serializeProcurementRecommendations(cells: ReturnType<typeof serializeCells>) {
  return cells.flatMap((cell) => {
    const currentProfile = getBaremetalHostClassProfile(cell.host_class);
    const recommendedHostClass = currentProfile.preferredGrowthHostClass;
    const recommendedProfile = getBaremetalHostClassProfile(recommendedHostClass);
    const reserveShortfall = {
      vcpu: Math.max(cell.reserve_budget_vcpu - cell.available_vcpu, 0),
      memory_gb: Math.max(cell.reserve_budget_memory_gb - cell.available_memory_gb, 0),
      disk_gb: Math.max(cell.reserve_budget_disk_gb - cell.available_disk_gb, 0),
    };

    const reserveBreached = reserveShortfall.vcpu > 0 || reserveShortfall.memory_gb > 0 || reserveShortfall.disk_gb > 0;
    const shouldEvolveHostClass = currentProfile.role === 'starter_edge' && recommendedHostClass !== cell.host_class;
    const constrainedCell = cell.admission_state !== 'open' || cell.sellability_state !== 'sellable';
    if (!reserveBreached && !shouldEvolveHostClass && !constrainedCell) return [];

    return [{
      id: `${cell.slug}:${recommendedHostClass}:${recommendedProfile.defaultGeneration}`,
      cell_id: cell.id,
      cell_slug: cell.slug,
      cell_name: cell.name,
      region: cell.region,
      current_host_class: cell.host_class,
      current_generation: cell.generation,
      current_role: currentProfile.role,
      recommended_host_class: recommendedHostClass,
      recommended_generation: recommendedProfile.defaultGeneration,
      recommended_role: recommendedProfile.role,
      procurement_purpose: reserveBreached ? 'reserve_replenishment' : shouldEvolveHostClass ? 'capacity_growth' : 'bootstrap',
      minimum_hosts: 1,
      reserve_shortfall_vcpu: reserveShortfall.vcpu,
      reserve_shortfall_memory_gb: reserveShortfall.memory_gb,
      reserve_shortfall_disk_gb: reserveShortfall.disk_gb,
      summary: reserveBreached ? `${cell.name} is below reserve budget and should add capacity.` : `${cell.name} should shift future growth from ${cell.host_class} to ${recommendedHostClass}.`,
      notes: [],
    }];
  });
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

function serializeCellCapacitySnapshot(row: typeof cellCapacitySnapshots.$inferSelect) {
  return {
    id: row.id,
    cell_id: row.cellId,
    cell_slug: row.cellSlug,
    region: row.region,
    host_class: row.hostClass,
    generation: row.generation,
    admission_state: row.admissionState,
    sellability_state: row.sellabilityState,
    host_count: row.hostCount,
    active_host_count: row.activeHostCount,
    active_schedulable_host_count: row.activeSchedulableHostCount,
    constrained_host_count: row.constrainedHostCount,
    total_vcpu: row.totalVcpu,
    total_memory_gb: row.totalMemoryGb,
    total_disk_gb: row.totalDiskGb,
    used_vcpu: row.usedVcpu,
    used_memory_gb: row.usedMemoryGb,
    used_disk_gb: row.usedDiskGb,
    reserved_vcpu: row.reservedVcpu,
    reserved_memory_gb: row.reservedMemoryGb,
    reserved_disk_gb: row.reservedDiskGb,
    reserve_budget_vcpu: row.reserveBudgetVcpu,
    reserve_budget_memory_gb: row.reserveBudgetMemoryGb,
    reserve_budget_disk_gb: row.reserveBudgetDiskGb,
    available_vcpu: row.availableVcpu,
    available_memory_gb: row.availableMemoryGb,
    available_disk_gb: row.availableDiskGb,
    sellable_vcpu: row.sellableVcpu,
    sellable_memory_gb: row.sellableMemoryGb,
    sellable_disk_gb: row.sellableDiskGb,
    utilization_score_basis_points: row.utilizationScore,
    snapshot_window_start: row.snapshotWindowStart.toISOString(),
    created_at: row.createdAt.toISOString(),
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
    const hostClassProfile = getBaremetalHostClassProfile(procurement.hostClass);
    const generation = normalizeBaremetalHostGeneration(procurement.generation ?? hostClassProfile.defaultGeneration, procurement.metadata ?? null);
  const [targetCell] = procurement.targetCellId
    ? await db.select().from(cells).where(eq(cells.id, procurement.targetCellId))
    : [null];
  if (targetCell && (targetCell.region !== procurement.region || targetCell.hostClass !== procurement.hostClass || targetCell.generation !== generation)) {
    throw new Error(`Target cell ${targetCell.slug} does not match procurement dimensions`);
  }
  const cell = targetCell ?? await ensureBaremetalCellRecord({
    region: procurement.region,
    hostClass: procurement.hostClass,
    generation,
  });

  const [host] = await db.insert(baremetalHosts).values({
    id: hostId,
    vendor: procurement.vendor,
    hostClass: procurement.hostClass,
    generation,
    region: procurement.region,
    location: procurement.location,
    cellId: cell.id,
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
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/cells/{id}/admission-state',
  tags: ['Admin Bare Metal'],
  summary: 'Update cell admission and sellability state',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            admission_state: CellAdmissionStateSchema,
            sellability_state: CellSellabilityStateSchema,
            reason: z.string().max(500).nullable().optional(),
            source: z.string().max(120).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Cell admission updated', content: { 'application/json': { schema: z.object({ cell: CellSchema }) } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existingCell] = await db.select().from(cells).where(eq(cells.id, id));
    if (!existingCell) return errorResponse(c, 404, 'Cell not found') as Response;

    const now = new Date();
    await db.insert(cellAdmissionControls).values({
      cellId: id,
      admissionState: body.admission_state,
      sellabilityState: body.sellability_state,
      reason: body.reason ?? null,
      source: body.source ?? 'admin-ui',
      setAt: now,
      metadata: {
        changed_by_user_id: c.get('userId'),
      },
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: cellAdmissionControls.cellId,
      set: {
        admissionState: body.admission_state,
        sellabilityState: body.sellability_state,
        reason: body.reason ?? null,
        source: body.source ?? 'admin-ui',
        setAt: now,
        metadata: {
          changed_by_user_id: c.get('userId'),
        },
        updatedAt: now,
      },
    });

    const overview = await loadFleetOverviewState();
    const cell = overview.cells.find((row) => row.id === id);
    if (!cell) return errorResponse(c, 404, 'Cell not found after update') as Response;
    return c.json({ cell });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
}) as any);

adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/cells/{id}/reserve-policy',
  tags: ['Admin Bare Metal'],
  summary: 'Update a cell reserve policy',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            warm_reserve: CellCapacitySchema,
            failure_reserve: CellCapacitySchema,
            procurement_reserve: CellCapacitySchema,
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Cell reserve policy updated', content: { 'application/json': { schema: z.object({ cell: CellSchema }) } } },
  },
}), (async (c: any) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existingCell] = await db.select().from(cells).where(eq(cells.id, id));
    if (!existingCell) return errorResponse(c, 404, 'Cell not found') as Response;

    const reservePolicy = {
      warmReserve: {
        vcpu: body.warm_reserve.vcpu,
        memoryGb: body.warm_reserve.memory_gb,
        diskGb: body.warm_reserve.disk_gb,
      },
      failureReserve: {
        vcpu: body.failure_reserve.vcpu,
        memoryGb: body.failure_reserve.memory_gb,
        diskGb: body.failure_reserve.disk_gb,
      },
      procurementReserve: {
        vcpu: body.procurement_reserve.vcpu,
        memoryGb: body.procurement_reserve.memory_gb,
        diskGb: body.procurement_reserve.disk_gb,
      },
    };

    await db.update(cells).set({
      reservePolicy,
      updatedAt: new Date(),
    }).where(eq(cells.id, id));

    const overview = await loadFleetOverviewState();
    const cell = overview.cells.find((row) => row.id === id);
    if (!cell) return errorResponse(c, 404, 'Cell not found after update') as Response;
    return c.json({ cell });
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
    const [cellRows, admissionRows] = await Promise.all([db.select().from(cells), db.select().from(cellAdmissionControls)]);
    return serializeHost(host, { cellRows, cellAdmissions: admissionRows });
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
    const [cellRows, admissionRows] = await Promise.all([db.select().from(cells), db.select().from(cellAdmissionControls)]);
    return serializeHost(host, { cellRows, cellAdmissions: admissionRows });
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
    const [cellRows, admissionRows] = await Promise.all([db.select().from(cells), db.select().from(cellAdmissionControls)]);
    return serializeHost(host, { cellRows, cellAdmissions: admissionRows });
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
    const [machineRows, reservationRows, artifactRows, cellRows, admissionRows] = await Promise.all([
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);
    return serializeHost(host, {
      machines: machineRows,
      reservations: reservationRows,
      artifacts: artifactRows,
      cellRows,
      cellAdmissions: admissionRows,
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
      location: host.location,
      public_ipv4: host.publicIpv4,
      public_ipv6: host.publicIpv6,
      runner_token: host.runnerToken,
    };
  },
  listHosts: async () => {
    const [rows, machineRows, reservationRows, artifactRows, cellRows, admissionRows] = await Promise.all([
      db.select().from(baremetalHosts),
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);
    return {
      hosts: rows.map((row) => serializeHost(row, { machines: machineRows, reservations: reservationRows, artifacts: artifactRows, cellRows, cellAdmissions: admissionRows })),
      cells: serializeCells(rows, reservationRows, { rows: cellRows, admissions: admissionRows }),
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
    const [hostRows, machineRows, reservationRows, artifactRows, cellRows, admissionRows] = await Promise.all([
      db.select().from(baremetalHosts),
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);
    const refreshed = hostRows.find((row) => row.id === host.id) ?? host;
    return { cleaned_instance_ids: orphans, skipped_instance_ids: skipped, host: serializeHost(refreshed, { machines: machineRows, reservations: reservationRows, artifacts: artifactRows, cellRows, cellAdmissions: admissionRows }) };
  },
  registerHost: async (id, body) => {
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) throw new Error('Host not found');
    const generation = normalizeBaremetalHostGeneration(typeof body.generation === 'string' ? body.generation : existing.generation, (body.metadata as Record<string, unknown> | undefined) ?? existing.metadata ?? null);
    const cell = await ensureBaremetalCellRecord({ region: existing.region, hostClass: existing.hostClass, generation });
    const [host] = await db.update(baremetalHosts).set({
      runnerBaseUrl: String(body.runner_base_url),
      publicIpv4: typeof body.public_ipv4 === 'string' ? body.public_ipv4 : existing.publicIpv4,
      publicIpv6: typeof body.public_ipv6 === 'string' ? body.public_ipv6 : existing.publicIpv6,
      totalVcpu: Number(body.total_vcpu),
      totalMemoryGb: Number(body.total_memory_gb),
      totalDiskGb: Number(body.total_disk_gb),
      generation,
      cellId: cell.id,
      status: body.status === 'bootstrapping' ? 'bootstrapping' : 'active',
      metadata: { ...(existing.metadata ?? {}), ...((body.metadata as Record<string, unknown> | undefined) ?? {}) },
      updatedAt: new Date(),
    }).where(eq(baremetalHosts.id, id)).returning();
    const [cellRows, admissionRows] = await Promise.all([db.select().from(cells), db.select().from(cellAdmissionControls)]);
    return serializeHost(host, { cellRows, cellAdmissions: admissionRows });
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

  const [rows, machineRows, reservationRows, artifactRows, cellRows, admissionRows] = await Promise.all([
    db.select().from(baremetalHosts),
    db.select().from(machines),
    db.select().from(hostCapacityReservations),
    db.select().from(backupArtifacts),
    db.select().from(cells),
    db.select().from(cellAdmissionControls),
  ]);
  return c.json({
    hosts: rows.map((row) => serializeHost(row, {
      machines: machineRows,
      reservations: reservationRows,
      artifacts: artifactRows,
      cellRows,
      cellAdmissions: admissionRows,
    })),
    cells: serializeCells(rows, reservationRows, { rows: cellRows, admissions: admissionRows }),
  });
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

    const [hostRows, machineRows, reservationRows, artifactRows, cellRows, admissionRows] = await Promise.all([
      db.select().from(baremetalHosts),
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);
    const refreshed = hostRows.find((row) => row.id === host.id) ?? host;

    return c.json({
      cleaned_instance_ids: cleaned,
      skipped_instance_ids: skipped,
      host: serializeHost(refreshed, {
        machines: machineRows,
        reservations: reservationRows,
        artifacts: artifactRows,
        cellRows,
        cellAdmissions: admissionRows,
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

    const [cellRows, admissionRows] = await Promise.all([
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);

    return c.json({ host: serializeHost(host, { cellRows, cellAdmissions: admissionRows }) });
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

    const [cellRows, admissionRows] = await Promise.all([
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);

    return c.json({ host: serializeHost(host, { cellRows, cellAdmissions: admissionRows }) });
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

    const [cellRows, admissionRows] = await Promise.all([
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);

    return c.json({ host: serializeHost(host, { cellRows, cellAdmissions: admissionRows }) });
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
  listCellCapacitySnapshots: async (limit) => {
    const rows = await db.select().from(cellCapacitySnapshots);
    return rows
      .sort((a, b) => b.snapshotWindowStart.getTime() - a.snapshotWindowStart.getTime())
      .slice(0, limit ?? 50)
      .map(serializeCellCapacitySnapshot);
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
    const [targetCell] = body.target_cell_id
      ? await db.select().from(cells).where(eq(cells.id, body.target_cell_id))
      : [null];
    if (body.target_cell_id && !targetCell) {
      throw new Error('Target cell not found');
    }
    const hostClassProfile = getBaremetalHostClassProfile(body.host_class);
    const generation = normalizeBaremetalHostGeneration(body.generation ?? targetCell?.generation ?? hostClassProfile.defaultGeneration, targetCell?.metadata ?? null);
    const [procurement] = await db.insert(baremetalProcurements).values({
      vendor: String(body.vendor ?? 'hetzner_robot'),
      hostClass: String(body.host_class),
      generation,
      targetCellId: body.target_cell_id ?? null,
      procurementPurpose: String(body.procurement_purpose ?? 'capacity_growth'),
      productId: String(body.product_id),
      region: String(body.region),
      location: String(body.location),
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
    return serializeProcurementRecommendations(overview.cells);
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
