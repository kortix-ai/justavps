import { describe, expect, it } from 'vitest';

import { scheduleBaremetalPlacement } from "@/server/platform/baremetal/scheduler";
import { applyExplicitImageAvailabilityToHosts, buildRequestedImageAvailabilityRefs, syncHostImageAvailabilityFromRunnerState } from "@/server/platform/baremetal/image-locality";
import type { BaremetalHostImageRow } from '@/server/db/schema';
import type { BaremetalHostCandidate } from "@/server/platform/baremetal/types";

type SyncImageLocalityExecutor = NonNullable<Parameters<typeof syncHostImageAvailabilityFromRunnerState>[0]['executor']>;

function baseHost(id: string): BaremetalHostCandidate {
  return {
    id,
    region: 'hel1',
    status: 'active',
    hostClass: 'general-small',
    maintenanceState: 'in_service',
    runnerBaseUrl: `http://${id}`,
    publicIpv4: '1.1.1.1',
    publicIpv6: null,
    metadata: {},
    capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 4, usedMemoryGb: 8, usedDiskGb: 80 },
  };
}

describe('image locality helpers', () => {
  it('builds unique image refs from id and alias', () => {
    expect(buildRequestedImageAvailabilityRefs({ imageId: 'img-1', imageAlias: 'justavps-golden' })).toEqual([
      { imageId: 'img-1', imageAlias: null, imageRef: 'img-1' },
      { imageId: null, imageAlias: 'justavps-golden', imageRef: 'justavps-golden' },
    ]);
  });

  it('overlays explicit host image availability into scheduler-visible metadata', () => {
    const hosts = applyExplicitImageAvailabilityToHosts([
      baseHost('host-remote'),
      baseHost('host-local'),
    ], [
      {
        id: 'row-1',
        hostId: 'host-local',
        imageId: null,
        imageAlias: 'justavps-golden',
        imageRef: 'justavps-golden',
        availabilityState: 'local',
        source: 'reconcile',
        lastSeenAt: null,
        lastRequestedAt: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies BaremetalHostImageRow,
      {
        id: 'row-2',
        hostId: 'host-remote',
        imageId: null,
        imageAlias: 'justavps-golden',
        imageRef: 'justavps-golden',
        availabilityState: 'remote',
        source: 'reconcile',
        lastSeenAt: null,
        lastRequestedAt: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies BaremetalHostImageRow,
    ]);

    const decision = scheduleBaremetalPlacement({
      request: {
        region: 'hel1',
        resources: { vcpu: 2, memoryGb: 4, diskGb: 50 },
        imageAlias: 'justavps-golden',
      },
      hosts,
    });

    expect(decision.selectedHostId).toBe('host-local');
    expect(decision.candidates[0]?.schedulingHints.imageLocality).toBe('local');
    expect(decision.candidates[1]?.schedulingHints.imageLocality).toBe('remote');
  });

  it('does not try to store runner-local image hashes as internal image UUIDs during reconcile', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const executor = {
      insert: () => ({
        values: (value: Record<string, unknown>) => ({
          onConflictDoUpdate: async () => {
            inserted.push(value);
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: async () => [],
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => [],
        }),
      }),
    } as unknown as SyncImageLocalityExecutor;

    await syncHostImageAvailabilityFromRunnerState({
      hostId: 'host-1',
      images: [{ imageId: '2df8e897c28d2483aaa8947668b79a5786a077b32999627bd6686e7a3ec03140', aliases: [] }],
      executor,
      at: new Date('2026-04-11T01:00:00.000Z'),
    });

    expect(inserted[0]?.imageId).toBeNull();
    expect(inserted[0]?.metadata).toMatchObject({ provider_image_id: '2df8e897c28d2483aaa8947668b79a5786a077b32999627bd6686e7a3ec03140' });
  });
});
