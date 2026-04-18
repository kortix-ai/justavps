import { db } from '@/server/db';
import { baremetalHosts, cellAdmissionControls, cellCapacitySnapshots, cells, hostCapacityReservations, type BaremetalHost, type HostCapacityReservationRow } from '@/server/db/schema';
import { sql } from 'drizzle-orm';

import { buildBaremetalCellCapacitySnapshots, buildBaremetalCellState } from "@/server/platform/baremetal/cells";

type CapacityStoreExecutor = Pick<typeof db, 'select' | 'insert'>;
const CELL_CAPACITY_SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function rowsFromExecute<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function snapshotWindowStart(observedAt: Date, windowSec = 300) {
  const windowMs = Math.max(windowSec, 60) * 1000;
  return new Date(Math.floor(observedAt.getTime() / windowMs) * windowMs);
}

export async function recordCellCapacitySnapshots(input: {
  observedAt?: Date;
  executor?: CapacityStoreExecutor;
  hosts?: BaremetalHost[];
  reservations?: HostCapacityReservationRow[];
}) {
  const executor = input.executor ?? db;
  const observedAt = input.observedAt ?? new Date();
  const [hostRows, reservationRows, cellRows, admissionRows] = await Promise.all([
    input.hosts ? Promise.resolve(input.hosts) : executor.select().from(baremetalHosts),
    input.reservations ? Promise.resolve(input.reservations) : executor.select().from(hostCapacityReservations),
    executor.select().from(cells),
    executor.select().from(cellAdmissionControls),
  ]);

  const snapshots = buildBaremetalCellCapacitySnapshots(hostRows.map((host) => ({
    id: host.id,
    region: host.region,
    hostClass: host.hostClass,
    generation: host.generation,
    cellId: host.cellId,
    status: host.status,
    maintenanceState: host.maintenanceState,
    metadata: host.metadata,
    cell: buildBaremetalCellState({
      region: host.region,
      hostClass: host.hostClass,
      generation: host.generation,
      cellId: host.cellId,
      metadata: host.metadata,
      cell: cellRows.find((cell) => cell.id === host.cellId) ?? undefined,
      admission: admissionRows.find((row) => row.cellId === host.cellId) ?? undefined,
    }) ?? undefined,
    capacity: {
      totalVcpu: host.totalVcpu ?? 0,
      totalMemoryGb: host.totalMemoryGb ?? 0,
      totalDiskGb: host.totalDiskGb ?? 0,
      usedVcpu: host.usedVcpu ?? 0,
      usedMemoryGb: host.usedMemoryGb ?? 0,
      usedDiskGb: host.usedDiskGb ?? 0,
    },
    reservations: {
      reserved: reservationRows
        .filter((row) => row.hostId === host.id && row.state === 'reserved')
        .reduce((acc, row) => ({ vcpu: acc.vcpu + row.vcpu, memoryGb: acc.memoryGb + row.memoryGb, diskGb: acc.diskGb + row.diskGb }), { vcpu: 0, memoryGb: 0, diskGb: 0 }),
      committed: reservationRows
        .filter((row) => row.hostId === host.id && row.state === 'committed')
        .reduce((acc, row) => ({ vcpu: acc.vcpu + row.vcpu, memoryGb: acc.memoryGb + row.memoryGb, diskGb: acc.diskGb + row.diskGb }), { vcpu: 0, memoryGb: 0, diskGb: 0 }),
    },
  })));

  const windowStart = snapshotWindowStart(observedAt);
  for (const snapshot of snapshots) {
    await executor.insert(cellCapacitySnapshots).values({
      cellId: snapshot.cell.id,
      cellSlug: snapshot.cell.slug,
      region: snapshot.cell.region,
      hostClass: snapshot.cell.hostClass,
      generation: snapshot.cell.generation,
      admissionState: snapshot.cell.admission.state,
      sellabilityState: snapshot.cell.admission.sellability,
      hostCount: snapshot.hostCount,
      activeHostCount: snapshot.activeHostCount,
      activeSchedulableHostCount: snapshot.activeSchedulableHostCount,
      constrainedHostCount: snapshot.constrainedHostCount,
      totalVcpu: snapshot.totals.vcpu,
      totalMemoryGb: snapshot.totals.memoryGb,
      totalDiskGb: snapshot.totals.diskGb,
      usedVcpu: snapshot.used.vcpu,
      usedMemoryGb: snapshot.used.memoryGb,
      usedDiskGb: snapshot.used.diskGb,
      reservedVcpu: snapshot.reserved.vcpu,
      reservedMemoryGb: snapshot.reserved.memoryGb,
      reservedDiskGb: snapshot.reserved.diskGb,
      reserveBudgetVcpu: snapshot.reserveBudget.vcpu,
      reserveBudgetMemoryGb: snapshot.reserveBudget.memoryGb,
      reserveBudgetDiskGb: snapshot.reserveBudget.diskGb,
      availableVcpu: snapshot.available.vcpu,
      availableMemoryGb: snapshot.available.memoryGb,
      availableDiskGb: snapshot.available.diskGb,
      sellableVcpu: snapshot.sellable.vcpu,
      sellableMemoryGb: snapshot.sellable.memoryGb,
      sellableDiskGb: snapshot.sellable.diskGb,
      utilizationScore: Math.round(snapshot.utilizationScore * 10_000),
      snapshotWindowStart: windowStart,
      createdAt: observedAt,
    }).onConflictDoNothing({
      target: [cellCapacitySnapshots.cellSlug, cellCapacitySnapshots.snapshotWindowStart],
    });
  }

  return snapshots.length;
}

export async function pruneExpiredCellCapacitySnapshots(input?: {
  now?: Date;
  limit?: number;
  executor?: Pick<typeof db, 'execute'>;
}) {
  const executor = input?.executor ?? db;
  const now = input?.now ?? new Date();
  const limit = input?.limit ?? 500;
  const retentionCutoff = new Date(now.getTime() - CELL_CAPACITY_SNAPSHOT_RETENTION_MS).toISOString();

  const result = await executor.execute(sql<{ id: string }>`
    with expired as (
      select ${cellCapacitySnapshots.id}
      from ${cellCapacitySnapshots}
      where ${cellCapacitySnapshots.snapshotWindowStart} < ${retentionCutoff}::timestamp
      order by ${cellCapacitySnapshots.snapshotWindowStart} asc
      limit ${limit}
    )
    delete from ${cellCapacitySnapshots}
    using expired
    where ${cellCapacitySnapshots.id} = expired.id
    returning ${cellCapacitySnapshots.id}
  `);

  const deletedRows = rowsFromExecute<{ id: string }>(result);

  return deletedRows.length;
}
