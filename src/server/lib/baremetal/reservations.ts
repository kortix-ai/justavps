import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db';
import {
  baremetalHosts,
  cellAdmissionControls,
  cells,
  hostCapacityReservations,
  type BaremetalHost,
  type CellAdmissionControlRow,
  type CellRow,
  type HostCapacityReservationRow,
} from '@/server/db/schema';
import { buildBaremetalCellState, deriveBaremetalCellIdentity, normalizeBaremetalHostGeneration } from './cells';
import { applyExplicitImageAvailabilityToHosts, loadImageAvailabilityRows } from './image-locality';
import { hostAcceptsPlacement } from './host-maintenance';
import { scheduleBaremetalPlacement } from './scheduler';
import type { BaremetalHostCandidate, BaremetalPlacementDecision, BaremetalPlacementResources } from './types';

export const HOST_CAPACITY_RESERVATION_STATES = ['reserved', 'committed', 'released', 'expired'] as const;
export type HostCapacityReservationState = (typeof HOST_CAPACITY_RESERVATION_STATES)[number];

export type RequestedHostCapacity = BaremetalPlacementResources;

export interface ReservationUsageSummary {
  reserved: RequestedHostCapacity;
  committed: RequestedHostCapacity;
}

export interface LeaseHostCapacityResult {
  host: BaremetalHost;
  reservation: HostCapacityReservationRow;
  projectedUsage: RequestedHostCapacity;
  decision: BaremetalPlacementDecision;
}

type CapacityTrackedHost = Pick<BaremetalHost, 'usedVcpu' | 'usedMemoryGb' | 'usedDiskGb' | 'totalVcpu' | 'totalMemoryGb' | 'totalDiskGb'>;

type ReservationDbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'execute'>;

const ACTIVE_RESERVATION_STATES: HostCapacityReservationState[] = ['reserved', 'committed'];
const DEFAULT_RESERVATION_TTL_MS = 10 * 60 * 1000;

function emptyCapacity(): RequestedHostCapacity {
  return { vcpu: 0, memoryGb: 0, diskGb: 0 };
}

function addCapacity(a: RequestedHostCapacity, b: RequestedHostCapacity): RequestedHostCapacity {
  return {
    vcpu: a.vcpu + b.vcpu,
    memoryGb: a.memoryGb + b.memoryGb,
    diskGb: a.diskGb + b.diskGb,
  };
}

export function summarizeReservationUsage(rows: HostCapacityReservationRow[], now = new Date()): ReservationUsageSummary {
  return rows.reduce<ReservationUsageSummary>((summary, row) => {
    if (row.state === 'reserved' && row.expiresAt && row.expiresAt <= now) {
      return summary;
    }

    const resources = { vcpu: row.vcpu, memoryGb: row.memoryGb, diskGb: row.diskGb };
    if (row.state === 'reserved') {
      summary.reserved = addCapacity(summary.reserved, resources);
    }
    if (row.state === 'committed') {
      summary.committed = addCapacity(summary.committed, resources);
    }
    return summary;
  }, { reserved: emptyCapacity(), committed: emptyCapacity() });
}

export function projectHostUsage(host: Pick<CapacityTrackedHost, 'usedVcpu' | 'usedMemoryGb' | 'usedDiskGb'>, reservations: ReservationUsageSummary) {
  const base = {
    vcpu: Math.max(host.usedVcpu ?? 0, reservations.committed.vcpu),
    memoryGb: Math.max(host.usedMemoryGb ?? 0, reservations.committed.memoryGb),
    diskGb: Math.max(host.usedDiskGb ?? 0, reservations.committed.diskGb),
  };
  return addCapacity(base, reservations.reserved);
}

export function hostHasAvailableCapacity(host: CapacityTrackedHost, reservations: ReservationUsageSummary, requested: RequestedHostCapacity) {
  const usage = projectHostUsage(host, reservations);
  return (host.totalVcpu ?? 0) - usage.vcpu >= requested.vcpu
    && (host.totalMemoryGb ?? 0) - usage.memoryGb >= requested.memoryGb
    && (host.totalDiskGb ?? 0) - usage.diskGb >= requested.diskGb;
}

export function hostProjectedUtilizationScore(host: CapacityTrackedHost, reservations: ReservationUsageSummary, requested: RequestedHostCapacity) {
  const usage = addCapacity(projectHostUsage(host, reservations), requested);
  const cpu = usage.vcpu / Math.max(host.totalVcpu ?? 0, 1);
  const mem = usage.memoryGb / Math.max(host.totalMemoryGb ?? 0, 1);
  const disk = usage.diskGb / Math.max(host.totalDiskGb ?? 0, 1);
  return cpu * 0.45 + mem * 0.4 + disk * 0.15;
}

async function fetchActiveReservationsForHost(executor: ReservationDbExecutor, hostId: string) {
  return executor.select().from(hostCapacityReservations).where(and(
    eq(hostCapacityReservations.hostId, hostId),
    inArray(hostCapacityReservations.state, ACTIVE_RESERVATION_STATES),
  ));
}

async function loadCellStateMaps(executor: ReservationDbExecutor, hosts: Array<Pick<BaremetalHost, 'cellId'>>) {
  const cellIds = [...new Set(hosts.map((host) => host.cellId).filter((cellId): cellId is string => Boolean(cellId)))];
  if (cellIds.length === 0) {
    return {
      cellsById: new Map<string, CellRow>(),
      admissionsByCellId: new Map<string, CellAdmissionControlRow>(),
    };
  }

  const [cellRows, admissionRows] = await Promise.all([
    executor.select().from(cells).where(inArray(cells.id, cellIds)),
    executor.select().from(cellAdmissionControls).where(inArray(cellAdmissionControls.cellId, cellIds)),
  ]);

  return {
    cellsById: new Map(cellRows.map((cell) => [cell.id, cell])),
    admissionsByCellId: new Map(admissionRows.map((admission) => [admission.cellId, admission])),
  };
}

export async function getHostCapacityReservationForMachine(machineId: string, executor: ReservationDbExecutor = db) {
  const rows = await executor.select().from(hostCapacityReservations).where(and(
    eq(hostCapacityReservations.machineId, machineId),
    eq(hostCapacityReservations.reservationType, 'machine_create'),
  ));
  return rows[0] ?? null;
}

export async function leaseHostCapacity(input: {
  machineId: string;
  region: string;
  requestedHostId?: string;
  resources: RequestedHostCapacity;
   imageId?: string | null;
   imageAlias?: string | null;
   expiresAt?: Date;
   executor?: ReservationDbExecutor;
}): Promise<LeaseHostCapacityResult> {
  const executor = input.executor ?? db;
  const existing = await getHostCapacityReservationForMachine(input.machineId, executor);
  if (existing) {
    const [host] = await executor.select().from(baremetalHosts).where(eq(baremetalHosts.id, existing.hostId));
    if (!host) throw new Error(`Reserved host ${existing.hostId} no longer exists`);
    const activeReservations = await fetchActiveReservationsForHost(executor, host.id);
    const { cellsById, admissionsByCellId } = await loadCellStateMaps(executor, [host]);
    const cell = buildBaremetalCellState({
      region: host.region,
      hostClass: host.hostClass,
      generation: host.generation,
      cellId: host.cellId,
      metadata: host.metadata,
      cell: host.cellId ? cellsById.get(host.cellId) ?? null : null,
      admission: host.cellId ? admissionsByCellId.get(host.cellId) ?? null : null,
    }) ?? deriveBaremetalCellIdentity(host);
    return {
      host,
      reservation: existing,
      projectedUsage: projectHostUsage(host, summarizeReservationUsage(activeReservations)),
      decision: {
        outcome: 'placed',
        selectedHostId: host.id,
        summary: `Reused existing host capacity reservation on ${host.id}`,
        explanation: ['Existing reservation was reused for machine create idempotency.'],
        request: {
          region: input.region,
          resources: input.resources,
          requestedHostId: input.requestedHostId,
          imageId: input.imageId,
          imageAlias: input.imageAlias,
        },
        policy: {
          requiredHostClass: null,
          requiredCellId: null,
          preferredHostClasses: [],
          preferredCellIds: [],
          warmPoolPreference: 'prefer',
          requireLocalImage: false,
          cellSpreadPreference: 'spread',
          maxProjectedUtilizationScore: null,
          allowRestrictedCellAdmission: false,
          allowReserveOnlySellability: false,
        },
        cells: [],
        candidates: [{
          hostId: host.id,
          eligible: true,
          score: 0,
          reasons: ['existing reservation'],
          cell,
          projectedUsage: projectHostUsage(host, summarizeReservationUsage(activeReservations)),
          cellProjectedUtilization: null,
          projectedUtilization: {
            vcpuPercent: Number(((Math.max(host.usedVcpu ?? 0, 0) / Math.max(host.totalVcpu ?? 0, 1)) * 100).toFixed(1)),
            memoryPercent: Number(((Math.max(host.usedMemoryGb ?? 0, 0) / Math.max(host.totalMemoryGb ?? 0, 1)) * 100).toFixed(1)),
            diskPercent: Number(((Math.max(host.usedDiskGb ?? 0, 0) / Math.max(host.totalDiskGb ?? 0, 1)) * 100).toFixed(1)),
            score: 0,
          },
          schedulingHints: {
            requestedHost: input.requestedHostId === host.id,
            warmPool: 'unknown',
            imageLocality: 'unknown',
            hostClass: host.hostClass,
            generation: cell?.generation ?? host.generation ?? null,
            cellId: cell?.id ?? host.cellId ?? null,
            cellSlug: cell?.slug ?? null,
            maintenanceState: host.maintenanceState,
            schedulable: hostAcceptsPlacement(host),
          },
        }],
      },
    };
  }

  const rows = await executor.select().from(baremetalHosts);
  const { cellsById, admissionsByCellId } = await loadCellStateMaps(executor, rows);
  const hostsWithReservations = await Promise.all(rows.map(async (host) => ({
    host,
    reservations: summarizeReservationUsage(await fetchActiveReservationsForHost(executor, host.id)),
  })));

  const candidateHosts = applyExplicitImageAvailabilityToHosts(
    hostsWithReservations.map(({ host, reservations }) => ({
      id: host.id,
      region: host.region,
      status: host.status as BaremetalHostCandidate['status'],
       hostClass: host.hostClass,
       generation: normalizeBaremetalHostGeneration(host.generation, host.metadata),
       cellId: host.cellId,
       cell: buildBaremetalCellState({
         region: host.region,
         hostClass: host.hostClass,
         generation: host.generation,
         cellId: host.cellId,
         metadata: host.metadata,
         cell: host.cellId ? cellsById.get(host.cellId) ?? null : null,
         admission: host.cellId ? admissionsByCellId.get(host.cellId) ?? null : null,
       }) ?? deriveBaremetalCellIdentity(host),
       maintenanceState: host.maintenanceState,
       runnerBaseUrl: host.runnerBaseUrl,
      publicIpv4: host.publicIpv4,
      publicIpv6: host.publicIpv6,
      runnerToken: host.runnerToken,
      metadata: host.metadata,
      capacity: {
        totalVcpu: host.totalVcpu ?? 0,
        totalMemoryGb: host.totalMemoryGb ?? 0,
        totalDiskGb: host.totalDiskGb ?? 0,
        usedVcpu: host.usedVcpu ?? 0,
        usedMemoryGb: host.usedMemoryGb ?? 0,
        usedDiskGb: host.usedDiskGb ?? 0,
      },
      reservations,
    })),
    await loadImageAvailabilityRows({
      hostIds: hostsWithReservations.map(({ host }) => host.id),
      imageId: input.imageId,
      imageAlias: input.imageAlias,
      executor,
    }),
  );

  const decision = scheduleBaremetalPlacement({
    request: {
      region: input.region,
      resources: input.resources,
      requestedHostId: input.requestedHostId,
      imageId: input.imageId,
      imageAlias: input.imageAlias,
    },
    hosts: candidateHosts,
  });

  const candidateOrder = decision.candidates
    .filter((candidate) => candidate.eligible)
    .map((candidate) => hostsWithReservations.find(({ host }) => host.id === candidate.hostId))
    .filter((candidate): candidate is { host: BaremetalHost; reservations: ReservationUsageSummary } => Boolean(candidate));

  if (candidateOrder.length === 0) {
    throw new Error(decision.summary);
  }

  const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_RESERVATION_TTL_MS);

  for (const candidate of candidateOrder) {
    await executor.execute(sql`select ${baremetalHosts.id} from ${baremetalHosts} where ${baremetalHosts.id} = ${candidate.host.id} for update`);
    const [lockedHost] = await executor.select().from(baremetalHosts).where(eq(baremetalHosts.id, candidate.host.id));
    if (!lockedHost || !hostAcceptsPlacement(lockedHost)) {
      continue;
    }
    const lockedReservations = summarizeReservationUsage(await fetchActiveReservationsForHost(executor, candidate.host.id));
    if (!hostHasAvailableCapacity(lockedHost, lockedReservations, input.resources)) {
      continue;
    }

    const [reservation] = await executor.insert(hostCapacityReservations).values({
      hostId: lockedHost.id,
      machineId: input.machineId,
      reservationType: 'machine_create',
      state: 'reserved',
      vcpu: input.resources.vcpu,
      memoryGb: input.resources.memoryGb,
      diskGb: input.resources.diskGb,
      expiresAt,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    if (!reservation) {
      throw new Error(`Failed to reserve host capacity for machine ${input.machineId}`);
    }

    return {
      host: lockedHost,
      reservation,
      projectedUsage: addCapacity(projectHostUsage(lockedHost, lockedReservations), input.resources),
      decision: {
        ...decision,
        selectedHostId: lockedHost.id,
        outcome: 'placed',
        summary: `Selected host ${lockedHost.id} for reservation lease`,
      },
    };
  }

  throw new Error(`Scheduler found no leaseable host after locking candidates. ${decision.summary}`);
}

export async function commitHostCapacityReservation(input: {
  reservationId: string;
  metadata?: Record<string, unknown>;
  executor?: ReservationDbExecutor;
}) {
  const executor = input.executor ?? db;
  const now = new Date();
  await executor.update(hostCapacityReservations).set({
    state: 'committed',
    expiresAt: null,
    committedAt: now,
    updatedAt: now,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }).where(eq(hostCapacityReservations.id, input.reservationId));
}

export async function releaseHostCapacityReservation(input: {
  reservationId: string;
  state?: 'released' | 'expired';
  metadata?: Record<string, unknown>;
  executor?: ReservationDbExecutor;
}) {
  const executor = input.executor ?? db;
  const now = new Date();
  await executor.update(hostCapacityReservations).set({
    state: input.state ?? 'released',
    releasedAt: now,
    updatedAt: now,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }).where(eq(hostCapacityReservations.id, input.reservationId));
}

export async function expireStaleHostCapacityReservations(now = new Date(), executor: ReservationDbExecutor = db) {
  const nowSql = now.toISOString();
  await executor.update(hostCapacityReservations).set({
    state: 'expired',
    releasedAt: now,
    updatedAt: now,
  }).where(and(
    eq(hostCapacityReservations.state, 'reserved'),
    sql`${hostCapacityReservations.expiresAt} is not null and ${hostCapacityReservations.expiresAt} <= ${nowSql}::timestamp`,
  ));
}
