import { describe, expect, it } from 'vitest';

import { pruneExpiredCellCapacitySnapshots, recordCellCapacitySnapshots } from "@/server/platform/baremetal/cell-capacity-store";

describe('cell capacity snapshot store', () => {
  it('persists one snapshot row per computed cell window', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    let selectCount = 0;
    const executor = {
      select: () => ({
        from: async () => {
          selectCount += 1;
          if (selectCount === 1) {
            return [{
              id: 'cell-1',
              slug: 'hel1--general-small--gen1',
              name: 'HEL1 general-small gen1',
              region: 'hel1',
              hostClass: 'general-small',
              generation: 'gen1',
              status: 'active',
              reservePolicy: { warmReserve: { vcpu: 1, memoryGb: 2, diskGb: 20 }, failureReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 }, procurementReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 } },
            }];
          }
          return [{ cellId: 'cell-1', admissionState: 'open', sellabilityState: 'sellable', reason: null, source: 'manual', setAt: null }];
        },
      }),
      insert: () => ({
        values: (value: Record<string, unknown>) => ({
          onConflictDoNothing: async () => {
            inserted.push(value);
          },
        }),
      }),
    } as never;

    const recorded = await recordCellCapacitySnapshots({
      observedAt: new Date('2026-04-11T05:00:00.000Z'),
      executor,
      hosts: [{
        id: 'host-1',
        region: 'hel1',
        hostClass: 'general-small',
        generation: 'gen1',
        cellId: 'cell-1',
        status: 'active',
        maintenanceState: 'in_service',
        metadata: {},
        totalVcpu: 12,
        totalMemoryGb: 64,
        totalDiskGb: 900,
        usedVcpu: 4,
        usedMemoryGb: 8,
        usedDiskGb: 80,
      }] as never,
      reservations: [{ hostId: 'host-1', state: 'reserved', vcpu: 1, memoryGb: 2, diskGb: 20 }] as never,
    });

    expect(recorded).toBe(1);
    expect(inserted[0]).toMatchObject({
      cellId: 'cell-1',
      cellSlug: 'hel1--general-small--gen1',
      hostCount: 1,
      activeSchedulableHostCount: 1,
      totalVcpu: 12,
      usedVcpu: 4,
      reservedVcpu: 1,
      reserveBudgetVcpu: 1,
      sellableVcpu: 6,
      snapshotWindowStart: new Date('2026-04-11T05:00:00.000Z'),
    });
  });

  it('prunes expired cell capacity snapshots beyond the retention window', async () => {
    const executor = {
      execute: async () => ({ rows: [{ id: 'snap-1' }, { id: 'snap-2' }] }),
    } as never;

    const deleted = await pruneExpiredCellCapacitySnapshots({
      now: new Date('2026-05-11T05:00:00.000Z'),
      limit: 100,
      executor,
    });

    expect(deleted).toBe(2);
  });
});
