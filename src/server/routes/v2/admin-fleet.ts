/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'crypto';
import { db } from '../../db';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { errorResponse, handleRouteError } from '../../lib/route-helpers';
import { config } from '../../lib/config';
import { backupArtifacts, baremetalHosts, baremetalProcurements, cellAdmissionControls, cells, hostCapacityReservations, machines } from '../../db/schema';
import { buildBaremetalCellCapacitySnapshots, buildBaremetalCellState, deriveBaremetalCellIdentity, normalizeBaremetalHostGeneration } from '../../lib/baremetal/cells';
import { ensureBaremetalCellRecord } from '../../lib/baremetal/cell-store';
import { getBaremetalHostClassProfile } from '../../lib/baremetal/host-class-profiles';
import { HOST_MAINTENANCE_STATES } from '../../lib/baremetal/host-maintenance';
import { HttpBaremetalRunnerClient } from '../../lib/baremetal/runner-client';
import { HetznerRobotClient } from '../../lib/baremetal/vendors/hetzner-robot';

export const adminFleetV2App = new OpenAPIHono<{ Variables: AuthVariables }>();
adminFleetV2App.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) return errorResponse(c, 403, 'Admin access required');
  return null;
}

const HostClassSchema = z.enum(['general-small', 'general-medium', 'memory-heavy', 'gpu']);
const HostMaintenanceStateSchema = z.enum(HOST_MAINTENANCE_STATES);
const CellAdmissionStateSchema = z.enum(['open', 'restricted', 'closed']);
const CellSellabilityStateSchema = z.enum(['sellable', 'reserve_only', 'unsellable']);
const ProcurementPurposeSchema = z.enum(['capacity_growth', 'reserve_replenishment', 'bootstrap', 'specialization']);
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
  error: z.string().nullable(),
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

const ProcurementListResponseSchema = z.object({
  procurements: z.array(z.object({
    id: z.string().uuid(),
    vendor: z.string(),
    host_class: z.string(),
    generation: z.string(),
    target_cell_id: z.string().uuid().nullable(),
    procurement_purpose: ProcurementPurposeSchema,
    product_id: z.string(),
    region: z.string(),
    location: z.string(),
    status: z.string(),
    host_id: z.string().uuid().nullable(),
    provider_transaction_id: z.string().nullable(),
    requires_approval: z.boolean(),
    error: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    approved_at: z.string().nullable(),
    ordered_at: z.string().nullable(),
    resolved_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })),
});

const ProcurementRecommendationSchema = z.object({
  id: z.string(),
  cell_id: z.string().uuid().nullable(),
  cell_slug: z.string(),
  cell_name: z.string(),
  region: z.string(),
  current_host_class: z.string(),
  current_generation: z.string(),
  current_role: z.enum(['starter_edge', 'mainstream', 'specialized']),
  recommended_host_class: z.string(),
  recommended_generation: z.string(),
  recommended_role: z.enum(['starter_edge', 'mainstream', 'specialized']),
  procurement_purpose: ProcurementPurposeSchema,
  minimum_hosts: z.number().int().min(1),
  reserve_shortfall_vcpu: z.number(),
  reserve_shortfall_memory_gb: z.number(),
  reserve_shortfall_disk_gb: z.number(),
  summary: z.string(),
  notes: z.array(z.string()),
});

const ProcurementRecommendationListResponseSchema = z.object({
  recommendations: z.array(ProcurementRecommendationSchema),
});

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

const ProcurementRecommendationListSchema = ProcurementRecommendationListResponseSchema;

function machineHostId(machine: typeof machines.$inferSelect) {
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
    error: typeof reconciliation.error === 'string' ? reconciliation.error : null,
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
  }) ?? deriveBaremetalCellIdentity(row);
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
      }) ?? deriveBaremetalCellIdentity(row),
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

    if (!reserveBreached && !shouldEvolveHostClass && !constrainedCell) {
      return [];
    }

    const procurementPurpose = reserveBreached
      ? 'reserve_replenishment'
      : shouldEvolveHostClass
        ? 'capacity_growth'
        : currentProfile.role === 'specialized'
          ? 'specialization'
          : 'bootstrap';

    const notes = [...new Set([
      ...currentProfile.notes,
      ...(recommendedHostClass !== cell.host_class ? [`Prefer future growth on ${recommendedHostClass} instead of ${cell.host_class}.`] : []),
      ...(reserveBreached ? ['Current available capacity is below the configured reserve budget for this cell.'] : []),
      ...(constrainedCell ? [`Cell admission is ${cell.admission_state} / ${cell.sellability_state}.`] : []),
    ])];

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
      procurement_purpose: procurementPurpose,
      minimum_hosts: 1,
      reserve_shortfall_vcpu: reserveShortfall.vcpu,
      reserve_shortfall_memory_gb: reserveShortfall.memory_gb,
      reserve_shortfall_disk_gb: reserveShortfall.disk_gb,
      summary: reserveBreached
        ? `${cell.name} is below reserve budget and should add capacity.`
        : shouldEvolveHostClass
          ? `${cell.name} should shift future growth from ${cell.host_class} to ${recommendedHostClass}.`
          : `${cell.name} has constrained sellability and should review capacity posture.`,
      notes,
    }];
  });
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

function isWarmPoolInstance(instanceId: string) {
  return instanceId.startsWith('justavps-warm-');
}

// @ts-expect-error mixed success/error response typing
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
}), async (c) => {
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
});

// @ts-expect-error mixed success/error response typing
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
}), async (c) => {
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
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/cells/{id}/reserve-policy',
  tags: ['Admin Bare Metal'],
  summary: 'Update cell reserve policy',
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
}), async (c) => {
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
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/{id}/maintenance-state',
  tags: ['Admin Bare Metal'],
  summary: 'Update host drain / maintenance state',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            state: HostMaintenanceStateSchema,
            note: z.string().max(500).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Host maintenance state updated', content: { 'application/json': { schema: z.object({ host: HostSchema }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) return errorResponse(c, 404, 'Host not found') as Response;

    const [machineRows, reservationRows, artifactRows, cellRows, admissionRows] = await Promise.all([
      db.select().from(machines),
      db.select().from(hostCapacityReservations),
      db.select().from(backupArtifacts),
      db.select().from(cells),
      db.select().from(cellAdmissionControls),
    ]);
    const drainReport = buildDrainReport(existing, {
      machines: machineRows,
      reservations: reservationRows,
      artifacts: artifactRows,
    });

    if (body.state === 'drained' && drainReport.blockers_total > 0) {
      return errorResponse(c, 409, `Host ${existing.name} still has drain blockers`) as Response;
    }

    const now = new Date();
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      maintenance: {
        ...(typeof (existing.metadata ?? {}).maintenance === 'object' && (existing.metadata ?? {}).maintenance !== null ? (existing.metadata ?? {}).maintenance : {}),
        last_state: body.state,
        last_note: body.note ?? null,
        changed_by_user_id: c.get('userId'),
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

    return c.json({
      host: serializeHost(host, {
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
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/hosts/{id}/bootstrap-config',
  tags: ['Admin Bare Metal'],
  summary: 'Get bootstrap configuration for a host',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Bootstrap configuration', content: { 'application/json': { schema: BootstrapConfigSchema } } },
  },
}), async (c) => {
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
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/hosts',
  tags: ['Admin Bare Metal'],
  summary: 'List bare-metal hosts',
  responses: { 200: { description: 'Hosts', content: { 'application/json': { schema: HostListResponseSchema } } } },
}), async (c) => {
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
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/reconcile',
  tags: ['Admin Bare Metal'],
  summary: 'Reconcile DB state against live bare-metal hosts',
  responses: { 200: { description: 'Fleet reconciled', content: { 'application/json': { schema: ReconcileResponseSchema } } } },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { reconcileBaremetalFleet } = await import('../../lib/baremetal/reconcile');
    const result = await reconcileBaremetalFleet();
    return c.json({
      checked_at: result.checkedAt,
      hosts: result.hosts.map((host) => ({
        host_id: host.hostId,
        status: host.status,
        instance_count: host.instanceCount,
        image_count: host.imageCount,
        stale_machine_ids: host.staleMachineIds,
        stale_image_ids: host.staleImageIds,
        orphan_instance_ids: host.orphanInstanceIds,
        ...(host.error ? { error: host.error } : {}),
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
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
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!host) return errorResponse(c, 404, 'Host not found') as Response;
    if (!host.runnerBaseUrl || !host.runnerToken) return errorResponse(c, 400, 'Host runner not registered') as Response;

    const reconciliation = buildReconciliationReport(host);
    const orphans = reconciliation.orphan_instance_ids;
    const skipped = orphans.filter((instanceId) => isWarmPoolInstance(instanceId));
    const cleaned = orphans.filter((instanceId) => !isWarmPoolInstance(instanceId));

    if (cleaned.length > 0) {
      const runner = new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken);
      for (const instanceId of cleaned) {
        await runner.deleteInstance(instanceId).catch((error) => {
          throw new Error(`Failed to delete orphan ${instanceId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }

    const { reconcileBaremetalHost } = await import('../../lib/baremetal/reconcile');
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
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/hosts/{id}/register',
  tags: ['Admin Bare Metal'],
  summary: 'Register a bootstrapped host runner and capacity',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            runner_base_url: z.string().url(),
            public_ipv4: z.string().optional(),
            public_ipv6: z.string().optional(),
            total_vcpu: z.number().int().positive(),
            total_memory_gb: z.number().int().positive(),
            total_disk_gb: z.number().int().positive(),
            generation: z.string().min(1).optional(),
            status: z.enum(['bootstrapping', 'active']).default('active'),
            metadata: z.record(z.string(), z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Host registered', content: { 'application/json': { schema: z.object({ host: HostListResponseSchema.shape.hosts.element }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, id));
    if (!existing) return errorResponse(c, 404, 'Host not found') as Response;
    const generation = normalizeBaremetalHostGeneration(body.generation ?? existing.generation, body.metadata ?? existing.metadata ?? null);
    const cell = await ensureBaremetalCellRecord({ region: existing.region, hostClass: existing.hostClass, generation });

    const [host] = await db.update(baremetalHosts).set({
      runnerBaseUrl: body.runner_base_url,
      publicIpv4: body.public_ipv4 ?? existing.publicIpv4,
      publicIpv6: body.public_ipv6 ?? existing.publicIpv6,
      totalVcpu: body.total_vcpu,
      totalMemoryGb: body.total_memory_gb,
      totalDiskGb: body.total_disk_gb,
      generation,
      cellId: cell.id,
      status: body.status,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(body.metadata ?? {}),
      },
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
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/procurements',
  tags: ['Admin Bare Metal'],
  summary: 'List bare-metal procurement requests',
  responses: { 200: { description: 'Procurements', content: { 'application/json': { schema: ProcurementListResponseSchema } } } },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;
  const rows = await db.select().from(baremetalProcurements);
  return c.json({ procurements: rows.map(serializeProcurement) });
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/procurements',
  tags: ['Admin Bare Metal'],
  summary: 'Create a bare-metal procurement request',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            vendor: z.literal('hetzner_robot').default('hetzner_robot'),
            host_class: HostClassSchema,
            generation: z.string().min(1).optional(),
            target_cell_id: z.string().uuid().optional(),
            procurement_purpose: ProcurementPurposeSchema.optional(),
            product_id: z.string().min(1),
            region: z.string().min(1),
            location: z.string().min(1),
            requires_approval: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Procurement created', content: { 'application/json': { schema: z.object({ procurement: ProcurementListResponseSchema.shape.procurements.element }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const body = c.req.valid('json');
    const userId = c.get('userId');
    const requiresApproval = body.requires_approval ?? config.BAREMETAL_PURCHASE_APPROVAL_REQUIRED;
    const [targetCell] = body.target_cell_id
      ? await db.select().from(cells).where(eq(cells.id, body.target_cell_id))
      : [null];
    if (body.target_cell_id && !targetCell) {
      return errorResponse(c, 404, 'Target cell not found') as Response;
    }
    if (targetCell && (targetCell.region !== body.region || targetCell.hostClass !== body.host_class)) {
      return errorResponse(c, 400, `Target cell ${targetCell.slug} does not match requested region/host class`) as Response;
    }
    const hostClassProfile = getBaremetalHostClassProfile(body.host_class);
    const generation = normalizeBaremetalHostGeneration(body.generation ?? targetCell?.generation ?? hostClassProfile.defaultGeneration, targetCell?.metadata ?? null);
    if (targetCell && targetCell.generation !== generation) {
      return errorResponse(c, 400, `Target cell ${targetCell.slug} does not match requested generation ${generation}`) as Response;
    }

    const [procurement] = await db.insert(baremetalProcurements).values({
      vendor: body.vendor,
      hostClass: body.host_class,
      generation,
      targetCellId: body.target_cell_id ?? null,
      procurementPurpose: body.procurement_purpose ?? 'capacity_growth',
      productId: body.product_id,
      region: body.region,
      location: body.location,
      status: requiresApproval ? 'requested' : 'approved',
      requestedByUserId: userId,
      approvedByUserId: requiresApproval ? null : userId,
      approvedAt: requiresApproval ? null : new Date(),
      requiresApproval,
      metadata: {},
    }).returning();

    if (!requiresApproval) {
      await placeHetznerRobotOrder(procurement.id, userId);
    }

    const [fresh] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurement.id));
    return c.json({ procurement: serializeProcurement(fresh) }, 201);
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'get',
  path: '/procurement-recommendations',
  tags: ['Admin Bare Metal'],
  summary: 'List reserve-aware procurement recommendations by cell',
  responses: { 200: { description: 'Procurement recommendations', content: { 'application/json': { schema: ProcurementRecommendationListSchema } } } },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const overview = await loadFleetOverviewState();
    return c.json({ recommendations: serializeProcurementRecommendations(overview.cells) });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/procurements/{id}/approve',
  tags: ['Admin Bare Metal'],
  summary: 'Approve and place a bare-metal procurement order',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Procurement approved', content: { 'application/json': { schema: z.object({ ok: z.boolean(), transaction_id: z.string(), host_id: z.string().uuid() }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError as Response;

  try {
    const { id } = c.req.valid('param');
    const result = await placeHetznerRobotOrder(id, c.get('userId'));
    return c.json({ ok: true, transaction_id: result.transactionId, host_id: result.hostId });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL');
  }
});

// @ts-expect-error mixed success/error response typing
adminFleetV2App.openapi(createRoute({
  method: 'post',
  path: '/procurements/{id}/sync',
  tags: ['Admin Bare Metal'],
  summary: 'Sync a procurement transaction from Hetzner Robot',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Procurement synced', content: { 'application/json': { schema: z.object({ ok: z.boolean(), procurement: ProcurementListResponseSchema.shape.procurements.element }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  try {
    const { id } = c.req.valid('param');
    const [procurement] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, id));
    if (!procurement) return errorResponse(c, 404, 'Procurement not found') as Response;
    if (!procurement.providerTransactionId) return errorResponse(c, 400, 'Procurement has no provider transaction') as Response;
    if (!config.hasHetznerRobotCredentials()) return errorResponse(c, 400, 'Hetzner Robot credentials are not configured') as Response;

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
        metadata: {
          order_status: tx.transaction.status,
          procurement_id: procurement.id,
        },
        updatedAt: new Date(),
      }).where(eq(baremetalHosts.id, procurement.hostId));
    }

    const [fresh] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurement.id));
    return c.json({ ok: true, procurement: serializeProcurement(fresh) });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
  }
});
