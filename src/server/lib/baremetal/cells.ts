import type { CellAdmissionControlRow, CellRow } from '@/server/db/schema';

import type { BaremetalPlacementResources } from './types';

export const DEFAULT_BAREMETAL_HOST_GENERATION = 'gen1';
export const CELL_ADMISSION_STATES = ['open', 'restricted', 'closed'] as const;
export const CELL_SELLABILITY_STATES = ['sellable', 'reserve_only', 'unsellable'] as const;

type CapacityLike = BaremetalPlacementResources;

export type BaremetalCellAdmissionState = (typeof CELL_ADMISSION_STATES)[number];
export type BaremetalCellSellabilityState = (typeof CELL_SELLABILITY_STATES)[number];

export interface BaremetalCellReservePolicy {
  warmReserve: CapacityLike;
  failureReserve: CapacityLike;
  procurementReserve: CapacityLike;
}

export interface BaremetalCellAdmissionControl {
  state: BaremetalCellAdmissionState;
  sellability: BaremetalCellSellabilityState;
  reason: string | null;
  source: string | null;
  setAt: string | null;
}

export interface BaremetalCellIdentity {
  id: string | null;
  slug: string;
  name: string;
  region: string;
  hostClass: string;
  generation: string;
}

export interface BaremetalCellState extends BaremetalCellIdentity {
  status: string;
  reservePolicy: BaremetalCellReservePolicy;
  admission: BaremetalCellAdmissionControl;
}

export interface BaremetalCellUsageSummary {
  reserved: CapacityLike;
  committed: CapacityLike;
}

export interface BaremetalCellCapacitySnapshot {
  cell: BaremetalCellState;
  hostCount: number;
  activeHostCount: number;
  activeSchedulableHostCount: number;
  constrainedHostCount: number;
  totals: CapacityLike;
  used: CapacityLike;
  reserved: CapacityLike;
  committed: CapacityLike;
  available: CapacityLike;
  reserveBudget: CapacityLike;
  sellable: CapacityLike;
  utilizationScore: number;
}

export interface BaremetalCellCapacityHostLike {
  id: string;
  region: string;
  hostClass?: string | null;
  generation?: string | null;
  cellId?: string | null;
  cell?: (BaremetalCellState | BaremetalCellIdentity) | null;
  status?: string | null;
  maintenanceState?: string | null;
  metadata?: Record<string, unknown> | null;
  capacity: {
    totalVcpu: number;
    totalMemoryGb: number;
    totalDiskGb: number;
    usedVcpu: number;
    usedMemoryGb: number;
    usedDiskGb: number;
  };
  reservations?: BaremetalCellUsageSummary;
}

export function emptyCapacity(): CapacityLike {
  return { vcpu: 0, memoryGb: 0, diskGb: 0 };
}

export function addCapacity(a: CapacityLike, b: CapacityLike): CapacityLike {
  return {
    vcpu: a.vcpu + b.vcpu,
    memoryGb: a.memoryGb + b.memoryGb,
    diskGb: a.diskGb + b.diskGb,
  };
}

function subtractCapacity(a: CapacityLike, b: CapacityLike): CapacityLike {
  return {
    vcpu: Math.max(a.vcpu - b.vcpu, 0),
    memoryGb: Math.max(a.memoryGb - b.memoryGb, 0),
    diskGb: Math.max(a.diskGb - b.diskGb, 0),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function normalizeCapacityLike(value: unknown): CapacityLike {
  const record = asRecord(value);
  return {
    vcpu: Math.max(asFiniteNumber(record?.vcpu) ?? 0, 0),
    memoryGb: Math.max(asFiniteNumber(record?.memoryGb ?? record?.memory_gb) ?? 0, 0),
    diskGb: Math.max(asFiniteNumber(record?.diskGb ?? record?.disk_gb) ?? 0, 0),
  };
}

function toCellToken(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

export function normalizeBaremetalHostGeneration(generation?: string | null, metadata?: Record<string, unknown> | null) {
  if (typeof generation === 'string' && generation.trim()) return generation.trim().toLowerCase();
  const metadataGeneration = metadata && typeof metadata.generation === 'string'
    ? metadata.generation
    : metadata && typeof metadata.host_generation === 'string'
      ? metadata.host_generation
      : null;
  if (typeof metadataGeneration === 'string' && metadataGeneration.trim()) return metadataGeneration.trim().toLowerCase();
  return DEFAULT_BAREMETAL_HOST_GENERATION;
}

export function buildBaremetalCellSlug(input: { region: string; hostClass: string; generation?: string | null }) {
  const generation = normalizeBaremetalHostGeneration(input.generation);
  return [
    toCellToken(input.region, 'region'),
    toCellToken(input.hostClass, 'host-class'),
    toCellToken(generation, DEFAULT_BAREMETAL_HOST_GENERATION),
  ].join('--');
}

export function buildBaremetalCellName(input: { region: string; hostClass: string; generation?: string | null }) {
  const generation = normalizeBaremetalHostGeneration(input.generation);
  return `${input.region.toUpperCase()} ${input.hostClass} ${generation}`;
}

export function normalizeCellReservePolicy(value: unknown): BaremetalCellReservePolicy {
  const record = asRecord(value);
  return {
    warmReserve: normalizeCapacityLike(record?.warmReserve ?? record?.warm_reserve),
    failureReserve: normalizeCapacityLike(record?.failureReserve ?? record?.failure_reserve),
    procurementReserve: normalizeCapacityLike(record?.procurementReserve ?? record?.procurement_reserve),
  };
}

function normalizeCellAdmissionState(value: unknown): BaremetalCellAdmissionState {
  return value === 'restricted' || value === 'closed' ? value : 'open';
}

function normalizeCellSellabilityState(value: unknown): BaremetalCellSellabilityState {
  return value === 'reserve_only' || value === 'unsellable' ? value : 'sellable';
}

export function normalizeCellAdmissionControl(input?: {
  cell?: Partial<CellRow> | null;
  admission?: Partial<CellAdmissionControlRow> | null;
}): BaremetalCellAdmissionControl {
  const cellMetadata = asRecord(input?.cell?.metadata);
  const metadataAdmission = asRecord(cellMetadata?.admissionControl ?? cellMetadata?.admission_control);
  const admission = input?.admission ?? null;

  return {
    state: normalizeCellAdmissionState(admission?.admissionState ?? metadataAdmission?.state),
    sellability: normalizeCellSellabilityState(admission?.sellabilityState ?? metadataAdmission?.sellability),
    reason: typeof admission?.reason === 'string'
      ? admission.reason
      : typeof metadataAdmission?.reason === 'string'
        ? metadataAdmission.reason
        : null,
    source: typeof admission?.source === 'string'
      ? admission.source
      : typeof metadataAdmission?.source === 'string'
        ? metadataAdmission.source
        : null,
    setAt: admission?.setAt instanceof Date
      ? admission.setAt.toISOString()
      : typeof metadataAdmission?.setAt === 'string'
        ? metadataAdmission.setAt
        : typeof metadataAdmission?.set_at === 'string'
          ? metadataAdmission.set_at
          : null,
  };
}

export function buildBaremetalCellState(input: {
  region: string;
  hostClass?: string | null;
  generation?: string | null;
  cellId?: string | null;
  metadata?: Record<string, unknown> | null;
  cell?: Partial<CellRow> | null;
  admission?: Partial<CellAdmissionControlRow> | null;
}): BaremetalCellState | null {
  if (!input.hostClass) return null;
  const generation = normalizeBaremetalHostGeneration(input.cell?.generation ?? input.generation, input.metadata ?? null);
  const reservePolicy = normalizeCellReservePolicy(input.cell?.reservePolicy ?? asRecord(input.metadata)?.reservePolicy ?? asRecord(input.metadata)?.reserve_policy);
  const status = typeof input.cell?.status === 'string' && input.cell.status.trim() ? input.cell.status : 'active';

  return {
    id: input.cell?.id ?? input.cellId ?? null,
    slug: typeof input.cell?.slug === 'string' && input.cell.slug.trim()
      ? input.cell.slug
      : buildBaremetalCellSlug({ region: input.region, hostClass: input.hostClass, generation }),
    name: typeof input.cell?.name === 'string' && input.cell.name.trim()
      ? input.cell.name
      : buildBaremetalCellName({ region: input.region, hostClass: input.hostClass, generation }),
    region: input.region,
    hostClass: input.hostClass,
    generation,
    status,
    reservePolicy,
    admission: normalizeCellAdmissionControl({ cell: input.cell, admission: input.admission }),
  };
}

export function deriveBaremetalCellIdentity(input: {
  region: string;
  hostClass?: string | null;
  generation?: string | null;
  cellId?: string | null;
  metadata?: Record<string, unknown> | null;
}): BaremetalCellIdentity | null {
  return buildBaremetalCellState(input);
}

function utilizationScore(used: CapacityLike, totals: CapacityLike) {
  const cpu = used.vcpu / Math.max(totals.vcpu, 1);
  const memory = used.memoryGb / Math.max(totals.memoryGb, 1);
  const disk = used.diskGb / Math.max(totals.diskGb, 1);
  return Number((cpu * 0.45 + memory * 0.4 + disk * 0.15).toFixed(4));
}

function effectiveUsedFromSnapshot(snapshot: Pick<BaremetalCellCapacitySnapshot, 'used' | 'reserved' | 'committed'>): CapacityLike {
  return {
    vcpu: Math.max(snapshot.used.vcpu, snapshot.committed.vcpu) + snapshot.reserved.vcpu,
    memoryGb: Math.max(snapshot.used.memoryGb, snapshot.committed.memoryGb) + snapshot.reserved.memoryGb,
    diskGb: Math.max(snapshot.used.diskGb, snapshot.committed.diskGb) + snapshot.reserved.diskGb,
  };
}

function reserveBudgetForPolicy(policy: BaremetalCellReservePolicy) {
  return addCapacity(addCapacity(policy.warmReserve, policy.failureReserve), policy.procurementReserve);
}

export function buildBaremetalCellCapacitySnapshots(hosts: BaremetalCellCapacityHostLike[]): BaremetalCellCapacitySnapshot[] {
  const snapshots = new Map<string, BaremetalCellCapacitySnapshot>();

  for (const host of hosts) {
    const normalizedCell = host.cell ? {
      id: host.cell.id ?? undefined,
      slug: host.cell.slug,
      name: host.cell.name,
      region: host.cell.region,
      hostClass: host.cell.hostClass,
      generation: host.cell.generation,
      status: 'status' in host.cell ? host.cell.status : undefined,
      reservePolicy: 'reservePolicy' in host.cell ? (host.cell.reservePolicy as unknown as Record<string, unknown>) : undefined,
      metadata: 'metadata' in host.cell ? (host.cell.metadata as unknown as Record<string, unknown>) : undefined,
    } : null;
    const normalizedAdmission = host.cell && 'admission' in host.cell ? {
      admissionState: host.cell.admission.state,
      sellabilityState: host.cell.admission.sellability,
      reason: host.cell.admission.reason,
      source: host.cell.admission.source ?? undefined,
      setAt: host.cell.admission.setAt ? new Date(host.cell.admission.setAt) : undefined,
    } : null;
    const cell = buildBaremetalCellState({
      region: host.region,
      hostClass: host.hostClass,
      generation: host.generation,
      cellId: host.cellId,
      metadata: host.metadata,
      cell: normalizedCell,
      admission: normalizedAdmission,
    });
    if (!cell) continue;
    const snapshot = snapshots.get(cell.slug) ?? {
      cell,
      hostCount: 0,
      activeHostCount: 0,
      activeSchedulableHostCount: 0,
      constrainedHostCount: 0,
      totals: emptyCapacity(),
      used: emptyCapacity(),
      reserved: emptyCapacity(),
      committed: emptyCapacity(),
      available: emptyCapacity(),
      reserveBudget: reserveBudgetForPolicy(cell.reservePolicy),
      sellable: emptyCapacity(),
      utilizationScore: 0,
    };

    snapshot.hostCount += 1;
    const scheduler = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
      ? (host.metadata.scheduler as Record<string, unknown> | undefined)
      : undefined;
    const schedulable = typeof scheduler?.schedulable === 'boolean' ? scheduler.schedulable : true;
    if (host.status === 'active') snapshot.activeHostCount += 1;
    if (host.status === 'active' && schedulable) snapshot.activeSchedulableHostCount += 1;
    if ((host.maintenanceState && host.maintenanceState !== 'in_service') || schedulable === false) snapshot.constrainedHostCount += 1;
    snapshot.cell = cell;
    snapshot.reserveBudget = reserveBudgetForPolicy(cell.reservePolicy);
    snapshot.totals = addCapacity(snapshot.totals, {
      vcpu: host.capacity.totalVcpu ?? 0,
      memoryGb: host.capacity.totalMemoryGb ?? 0,
      diskGb: host.capacity.totalDiskGb ?? 0,
    });
    snapshot.used = addCapacity(snapshot.used, {
      vcpu: host.capacity.usedVcpu ?? 0,
      memoryGb: host.capacity.usedMemoryGb ?? 0,
      diskGb: host.capacity.usedDiskGb ?? 0,
    });
    snapshot.reserved = addCapacity(snapshot.reserved, host.reservations?.reserved ?? emptyCapacity());
    snapshot.committed = addCapacity(snapshot.committed, host.reservations?.committed ?? emptyCapacity());
    snapshots.set(cell.slug, snapshot);
  }

  return [...snapshots.values()].map((snapshot) => {
    const effectiveUsed = effectiveUsedFromSnapshot(snapshot);
    const available = subtractCapacity(snapshot.totals, effectiveUsed);
    const sellable = subtractCapacity(available, snapshot.reserveBudget);
    return {
      ...snapshot,
      available,
      sellable,
      utilizationScore: utilizationScore(effectiveUsed, snapshot.totals),
    };
  }).sort((a, b) => a.cell.slug.localeCompare(b.cell.slug));
}

export function projectBaremetalCellUtilization(snapshot: BaremetalCellCapacitySnapshot | null, requested: CapacityLike) {
  if (!snapshot) return null;
  const projectedUsed = addCapacity(effectiveUsedFromSnapshot(snapshot), requested);
  const projectedAvailable = subtractCapacity(snapshot.totals, projectedUsed);
  const projectedSellable = subtractCapacity(projectedAvailable, snapshot.reserveBudget);
  return {
    hostCount: snapshot.hostCount,
    vcpuPercent: Number(((projectedUsed.vcpu / Math.max(snapshot.totals.vcpu, 1)) * 100).toFixed(1)),
    memoryPercent: Number(((projectedUsed.memoryGb / Math.max(snapshot.totals.memoryGb, 1)) * 100).toFixed(1)),
    diskPercent: Number(((projectedUsed.diskGb / Math.max(snapshot.totals.diskGb, 1)) * 100).toFixed(1)),
    score: utilizationScore(projectedUsed, snapshot.totals),
    reserveBudget: snapshot.reserveBudget,
    projectedAvailable,
    projectedSellable,
    reserveSatisfied: projectedAvailable.vcpu >= snapshot.reserveBudget.vcpu
      && projectedAvailable.memoryGb >= snapshot.reserveBudget.memoryGb
      && projectedAvailable.diskGb >= snapshot.reserveBudget.diskGb,
    admissionState: snapshot.cell.admission.state,
    sellabilityState: snapshot.cell.admission.sellability,
  };
}
