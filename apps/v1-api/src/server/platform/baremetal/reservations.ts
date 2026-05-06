import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db';
import {
  baremetalHosts,
  hostCapacityReservations,
  type BaremetalHost,
  type HostCapacityReservationRow,
} from '@/server/db/schema';
import { applyExplicitImageAvailabilityToHosts, loadImageAvailabilityRows } from "@/server/platform/baremetal/image-locality";
import { hostAcceptsPlacement } from "@/server/platform/baremetal/host-maintenance";
import { scheduleBaremetalPlacement } from "@/server/platform/baremetal/scheduler";
import type { BaremetalHostCandidate, BaremetalPlacementDecision, BaremetalPlacementResources } from "@/server/platform/baremetal/types";

type HostCapacityReservationState = 'reserved' | 'committed' | 'released' | 'expired';

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

class BaremetalPlacementUnavailableError extends Error {
  readonly statusCode = 409;
  readonly details: Record<string, unknown>;
  constructor(message: string, public readonly decision?: BaremetalPlacementDecision) {
    super(message);
    this.name = 'BaremetalPlacementUnavailableError';
    this.details = decision ? {
      placement_decision: {
        outcome: decision.outcome,
        summary: decision.summary,
        explanation: decision.explanation,
      },
    } : {};
  }
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

async function getHostCapacityReservationForMachine(machineId: string, executor: ReservationDbExecutor = db) {
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
          preferredHostClasses: [],
          warmPoolPreference: 'prefer',
          requireLocalImage: false,
          hostSpreadPreference: 'spread',
          maxProjectedUtilizationScore: null,
        },
        candidates: [{
          hostId: host.id,
          eligible: true,
          score: 0,
          reasons: ['existing reservation'],
          projectedUsage: projectHostUsage(host, summarizeReservationUsage(activeReservations)),
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
            maintenanceState: host.maintenanceState,
            schedulable: hostAcceptsPlacement(host),
            driftStatus: (((host.metadata ?? {}) as Record<string, unknown>).bootstrap as Record<string, unknown> | undefined)?.drift_status === 'in_policy'
              || (((host.metadata ?? {}) as Record<string, unknown>).bootstrap as Record<string, unknown> | undefined)?.drift_status === 'warning_drift'
              || (((host.metadata ?? {}) as Record<string, unknown>).bootstrap as Record<string, unknown> | undefined)?.drift_status === 'blocking_drift'
              ? ((((host.metadata ?? {}) as Record<string, unknown>).bootstrap as Record<string, unknown>).drift_status as 'in_policy' | 'warning_drift' | 'blocking_drift')
              : null,
          },
        }],
      },
    };
  }

  const rows = await executor.select().from(baremetalHosts);
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
    throw new BaremetalPlacementUnavailableError(decision.summary, decision);
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

  throw new BaremetalPlacementUnavailableError(`Scheduler found no leaseable host after locking candidates. ${decision.summary}`, decision);
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
