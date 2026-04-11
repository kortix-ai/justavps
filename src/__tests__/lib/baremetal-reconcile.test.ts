import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/lib/baremetal/cell-store', () => ({
  ensureBaremetalHostCellAssignment: vi.fn(async ({ host }: { host: { cellId?: string | null; region: string; hostClass: string; generation?: string | null } }) => ({
    id: host.cellId ?? 'cell-generated',
    slug: `${host.region}--${host.hostClass}--${host.generation ?? 'gen1'}`,
    name: `${host.region.toUpperCase()} ${host.hostClass} ${host.generation ?? 'gen1'}`,
    region: host.region,
    hostClass: host.hostClass,
    generation: host.generation ?? 'gen1',
  })),
}));

import { reconcileBaremetalFleet, summarizeHostUsage } from '@/server/lib/baremetal/reconcile';

describe('baremetal reconciliation', () => {
  it('summarizes usage from live runner instances and flags orphans', () => {
    const usage = summarizeHostUsage({
      host: { id: 'host-1' } as never,
      runnerState: {
        checkedAt: new Date().toISOString(),
        runnerd: 'ok' as const,
        incus: { status: 'ok', serverVersion: '6.0', instanceCount: 2, imageCount: 1 },
        instances: [
          { instanceId: 'justavps-a', status: 'Running', privateIpv4: '10.0.0.2', vcpu: 2, memoryGb: 4, diskGb: 40 },
          { instanceId: 'orphan', status: 'Running', privateIpv4: '10.0.0.9', vcpu: 1, memoryGb: 2, diskGb: 10 },
        ],
        images: [],
      },
      activeMachines: [
        { slug: 'a', providerServerId: 'justavps-a', serverType: 'starter' },
      ] as never,
    });

    expect(usage).toEqual({
      usedVcpu: 3,
      usedMemoryGb: 6,
      usedDiskGb: 50,
      orphanInstanceIds: ['orphan'],
      warmPoolInstanceIds: [],
    });
  });

  it('marks stale machine and image rows deleted and refreshes host accounting', async () => {
    const checkedAt = new Date('2026-04-04T12:00:00.000Z');
    const hosts = [{
      id: 'host-1',
      status: 'disabled',
      hostClass: 'general-small',
      generation: 'gen1',
      region: 'hel1',
      cellId: 'cell-1',
      maintenanceState: 'maintenance',
      runnerBaseUrl: 'http://runner',
      runnerToken: 'token',
      lastHeartbeatAt: null,
      usedVcpu: 0,
      usedMemoryGb: 0,
      usedDiskGb: 0,
      metadata: {},
      updatedAt: checkedAt,
    }];
    const machineRows = [{
      id: 'machine-stale',
      provider: 'baremetal',
      slug: 'stale',
      status: 'ready',
      deletedAt: null,
      providerServerId: 'justavps-stale',
      serverType: 'starter',
      providerMeta: { baremetal_host_id: 'host-1' },
    }];
    const imageRows = [{
      id: 'image-stale',
      provider: 'baremetal',
      status: 'ready',
      providerImageId: 'missing-alias',
      description: null,
      updatedAt: checkedAt,
    }];
    const reservationRows = [{
      id: 'reservation-stale',
      hostId: 'host-1',
      machineId: 'machine-stale',
      reservationType: 'machine_create',
      state: 'committed',
      vcpu: 2,
      memoryGb: 4,
      diskGb: 40,
      expiresAt: null,
      committedAt: checkedAt,
      releasedAt: null,
      metadata: {},
      createdAt: checkedAt,
      updatedAt: checkedAt,
    }];
    const hostUpdates: Array<Record<string, unknown>> = [];
    const machineUpdates: Array<Record<string, unknown>> = [];
    const imageUpdates: Array<Record<string, unknown>> = [];
    const reservationUpdates: Array<Record<string, unknown>> = [];

    const result = await reconcileBaremetalFleet({
      loadHosts: async () => hosts as never[],
      loadMachines: async () => machineRows as never[],
      loadImages: async () => imageRows as never[],
      loadReservations: async () => reservationRows as never[],
      expireReservations: async () => {},
      fetchRunnerState: async () => ({
        checkedAt: checkedAt.toISOString(),
        runnerd: 'ok' as const,
        incus: { status: 'ok', serverVersion: '6.0', instanceCount: 0, imageCount: 1 },
        instances: [],
        images: [{ imageId: 'fingerprint-1', aliases: ['ubuntu-24.04'], cached: true }],
      }),
      updateHost: async (hostId, patch) => {
        hostUpdates.push({ hostId, ...patch });
      },
      updateMachine: async (machineId, patch) => {
        machineUpdates.push({ machineId, ...patch });
      },
      updateImage: async (imageId, patch) => {
        imageUpdates.push({ imageId, ...patch });
      },
      updateReservation: async (reservationId, patch) => {
        reservationUpdates.push({ reservationId, ...patch });
      },
    });

    expect(result.hosts).toEqual([expect.objectContaining({
      hostId: 'host-1',
      status: 'ok',
      instanceCount: 0,
      imageCount: 1,
      staleMachineIds: ['machine-stale'],
      staleImageIds: ['image-stale'],
    })]);
    expect(machineUpdates).toEqual(expect.arrayContaining([expect.objectContaining({
      machineId: 'machine-stale',
      status: 'deleted',
    })]));
    expect(imageUpdates).toEqual([expect.objectContaining({
      imageId: 'image-stale',
      status: 'deleted',
    })]);
    expect(reservationUpdates).toEqual([expect.objectContaining({
      reservationId: 'reservation-stale',
      state: 'released',
    })]);
    expect(hostUpdates).toEqual([expect.objectContaining({
      hostId: 'host-1',
      status: 'disabled',
      cellId: expect.any(String),
      generation: 'gen1',
      usedVcpu: 0,
      usedMemoryGb: 0,
      usedDiskGb: 0,
      lastHeartbeatAt: expect.any(Date),
    })]);
  });

  it('can reconcile only due hosts without scanning the full fleet', async () => {
    const checkedAt = new Date();
    const dueCheckedAt = new Date(checkedAt.getTime() - 10 * 60 * 1000).toISOString();
    const freshCheckedAt = new Date(checkedAt.getTime() - 30 * 1000).toISOString();
    const hosts = [
      {
        id: 'host-due',
        status: 'active',
        hostClass: 'general-small',
        generation: 'gen1',
        region: 'hel1',
        cellId: 'cell-due',
        maintenanceState: 'in_service',
        runnerBaseUrl: 'http://runner-due',
        runnerToken: 'token',
        lastHeartbeatAt: new Date('2026-04-04T12:00:00.000Z'),
        usedVcpu: 0,
        usedMemoryGb: 0,
        usedDiskGb: 0,
        metadata: {
          reconciliation: {
            checked_at: dueCheckedAt,
          },
        },
        updatedAt: checkedAt,
      },
      {
        id: 'host-fresh',
        status: 'active',
        hostClass: 'general-small',
        generation: 'gen1',
        region: 'hel1',
        cellId: 'cell-fresh',
        maintenanceState: 'in_service',
        runnerBaseUrl: 'http://runner-fresh',
        runnerToken: 'token',
        lastHeartbeatAt: new Date('2026-04-04T12:09:30.000Z'),
        usedVcpu: 0,
        usedMemoryGb: 0,
        usedDiskGb: 0,
        metadata: {
          reconciliation: {
            checked_at: freshCheckedAt,
          },
        },
        updatedAt: checkedAt,
      },
    ];
    const fetchRunnerState = vi.fn(async () => ({
      checkedAt: checkedAt.toISOString(),
      runnerd: 'ok' as const,
      incus: { status: 'ok' as const, serverVersion: '6.0', instanceCount: 0, imageCount: 0 },
      instances: [],
      images: [],
    }));

    const result = await reconcileBaremetalFleet({
      loadHosts: async () => hosts as never[],
      loadMachines: async () => [],
      loadImages: async () => [],
      loadReservations: async () => [],
      expireReservations: async () => {},
      fetchRunnerState,
      updateHost: async () => {},
      updateMachine: async () => {},
      updateImage: async () => {},
      updateReservation: async () => {},
    }, {
      onlyDueHosts: true,
      dueAfterMs: 5 * 60 * 1000,
    });

    expect(fetchRunnerState).toHaveBeenCalledTimes(1);
    expect(fetchRunnerState).toHaveBeenCalledWith(expect.objectContaining({ id: 'host-due' }));
    expect(result.hosts).toHaveLength(1);
    expect(result.hosts[0]?.hostId).toBe('host-due');
  });

  it('backfills explicit machine port allocations for live machines during reconcile', async () => {
    const syncMachinePortAllocations = vi.fn(async () => {});
    await reconcileBaremetalFleet({
      loadHosts: async () => [{
        id: 'host-1',
        status: 'active',
        hostClass: 'general-small',
        generation: 'gen1',
        region: 'hel1',
        cellId: 'cell-1',
        maintenanceState: 'in_service',
        runnerBaseUrl: 'http://runner',
        runnerToken: 'token',
        lastHeartbeatAt: null,
        usedVcpu: 0,
        usedMemoryGb: 0,
        usedDiskGb: 0,
        metadata: {},
        updatedAt: new Date(),
      }] as never[],
      loadMachines: async () => [{
        id: 'machine-1',
        provider: 'baremetal',
        slug: 'live',
        status: 'ready',
        deletedAt: null,
        providerServerId: 'justavps-live',
        serverType: 'starter',
        providerMeta: { baremetal_host_id: 'host-1', ssh_port: 22316, http_port: 8948 },
      }] as never[],
      loadImages: async () => [],
      loadReservations: async () => [],
      expireReservations: async () => {},
      fetchRunnerState: async () => ({
        checkedAt: new Date().toISOString(),
        runnerd: 'ok' as const,
        incus: { status: 'ok', serverVersion: '6.0', instanceCount: 1, imageCount: 0 },
        instances: [{ instanceId: 'justavps-live', status: 'Running', privateIpv4: '10.0.0.2', vcpu: 2, memoryGb: 4, diskGb: 40 }],
        images: [],
      }),
      updateHost: async () => {},
      updateMachine: async () => {},
      updateImage: async () => {},
      updateReservation: async () => {},
      syncMachinePortAllocations,
    });

    expect(syncMachinePortAllocations).toHaveBeenCalledWith(expect.objectContaining({ id: 'machine-1' }));
  });

  it('backfills explicit baremetal host id for machines that still only have providerMeta host affinity', async () => {
    const machineUpdates: Array<Record<string, unknown>> = [];
    await reconcileBaremetalFleet({
      loadHosts: async () => [{
        id: 'host-1',
        status: 'active',
        hostClass: 'general-small',
        generation: 'gen1',
        region: 'hel1',
        cellId: 'cell-1',
        maintenanceState: 'in_service',
        runnerBaseUrl: 'http://runner',
        runnerToken: 'token',
        lastHeartbeatAt: null,
        usedVcpu: 0,
        usedMemoryGb: 0,
        usedDiskGb: 0,
        metadata: {},
        updatedAt: new Date(),
      }] as never[],
      loadMachines: async () => [{
        id: 'machine-stopped',
        provider: 'baremetal',
        slug: 'stopped',
        status: 'stopped',
        deletedAt: null,
        providerServerId: 'justavps-stopped',
        baremetalHostId: null,
        providerMeta: { baremetal_host_id: 'host-1' },
      }] as never[],
      loadImages: async () => [],
      loadReservations: async () => [],
      expireReservations: async () => {},
      fetchRunnerState: async () => ({
        checkedAt: new Date().toISOString(),
        runnerd: 'ok' as const,
        incus: { status: 'ok', serverVersion: '6.0', instanceCount: 0, imageCount: 0 },
        instances: [],
        images: [],
      }),
      updateHost: async () => {},
      updateMachine: async (machineId, patch) => {
        machineUpdates.push({ machineId, ...patch });
      },
      updateImage: async () => {},
      updateReservation: async () => {},
      syncMachinePortAllocations: async () => {},
    });

    expect(machineUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ machineId: 'machine-stopped', baremetalHostId: 'host-1' }),
    ]));
  });
});
