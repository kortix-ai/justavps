import { describe, expect, it } from 'vitest';

import { reconcileBaremetalFleet, summarizeHostUsage } from '@/server/lib/baremetal/reconcile';

describe('baremetal reconciliation', () => {
  it('summarizes usage from live runner instances and flags orphans', () => {
    const usage = summarizeHostUsage({
      host: { id: 'host-1' } as never,
      runnerState: {
        checkedAt: new Date().toISOString(),
        runnerd: 'ok',
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
    });
  });

  it('marks stale machine and image rows deleted and refreshes host accounting', async () => {
    const checkedAt = new Date('2026-04-04T12:00:00.000Z');
    const hosts = [{
      id: 'host-1',
      status: 'active',
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
    const hostUpdates: Array<Record<string, unknown>> = [];
    const machineUpdates: Array<Record<string, unknown>> = [];
    const imageUpdates: Array<Record<string, unknown>> = [];

    const result = await reconcileBaremetalFleet({
      loadHosts: async () => hosts as never[],
      loadMachines: async () => machineRows as never[],
      loadImages: async () => imageRows as never[],
      fetchRunnerState: async () => ({
        checkedAt: checkedAt.toISOString(),
        runnerd: 'ok',
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
    });

    expect(result.hosts).toEqual([expect.objectContaining({
      hostId: 'host-1',
      status: 'ok',
      instanceCount: 0,
      imageCount: 1,
      staleMachineIds: ['machine-stale'],
      staleImageIds: ['image-stale'],
    })]);
    expect(machineUpdates).toEqual([expect.objectContaining({
      machineId: 'machine-stale',
      status: 'deleted',
    })]);
    expect(imageUpdates).toEqual([expect.objectContaining({
      imageId: 'image-stale',
      status: 'deleted',
    })]);
    expect(hostUpdates).toEqual([expect.objectContaining({
      hostId: 'host-1',
      status: 'active',
      usedVcpu: 0,
      usedMemoryGb: 0,
      usedDiskGb: 0,
      lastHeartbeatAt: expect.any(Date),
    })]);
  });
});
