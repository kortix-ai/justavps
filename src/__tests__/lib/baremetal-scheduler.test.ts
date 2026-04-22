import { describe, expect, it } from 'vitest';

import { pickBaremetalHostForPlan, pickBaremetalHostForResources, scheduleBaremetalPlacement } from "@/server/platform/baremetal/scheduler";
import type { BaremetalHostCandidate } from "@/server/platform/baremetal/types";

type SchedulerHostFixture = BaremetalHostCandidate & {
  reservations?: {
    reserved: { vcpu: number; memoryGb: number; diskGb: number };
    committed: { vcpu: number; memoryGb: number; diskGb: number };
  };
};

function baseHost(overrides: Partial<SchedulerHostFixture> = {}): SchedulerHostFixture {
  return {
    id: 'host-a',
    region: 'fsn1',
    status: 'active' as const,
    hostClass: 'general-small',
    maintenanceState: 'in_service',
    runnerBaseUrl: 'http://runner-a',
    publicIpv4: '1.1.1.1',
    publicIpv6: null,
    metadata: {},
    capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 4, usedMemoryGb: 8, usedDiskGb: 80 },
    ...overrides,
  };
}

describe('scheduleBaremetalPlacement', () => {
  it('returns a structured explainable decision with projected utilization details', () => {
    const decision = scheduleBaremetalPlacement({
      request: {
        region: 'fsn1',
        resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      },
      hosts: [
        baseHost({ id: 'host-a', capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 8, usedMemoryGb: 16, usedDiskGb: 160 } }),
        baseHost({ id: 'host-b', runnerBaseUrl: 'http://runner-b', publicIpv4: '2.2.2.2', capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 2, usedMemoryGb: 4, usedDiskGb: 80 } }),
      ],
    });

    expect(decision.outcome).toBe('placed');
    expect(decision.selectedHostId).toBe('host-b');
    expect(decision.summary).toContain('Selected host host-b');
    expect(decision.explanation.length).toBeGreaterThan(0);
    expect(decision.candidates[0]).toMatchObject({
      hostId: 'host-b',
      eligible: true,
      projectedUsage: { vcpu: 4, memoryGb: 8, diskGb: 160 },
      schedulingHints: {
        warmPool: 'unknown',
        imageLocality: 'unknown',
        hostClass: 'general-small',
        maintenanceState: 'in_service',
      },
    });
  });

  it('honors maintenance and schedulability hooks while surfacing reasons', () => {
    const decision = scheduleBaremetalPlacement({
      request: {
        region: 'fsn1',
        resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      },
      hosts: [
        baseHost({ id: 'host-draining', maintenanceState: 'draining' }),
        baseHost({
          id: 'host-unschedulable',
          runnerBaseUrl: 'http://runner-b',
          publicIpv4: '2.2.2.2',
          metadata: { scheduler: { schedulable: false, unschedulableReason: 'host quarantined for drift' } },
        }),
      ],
    });

    expect(decision.outcome).toBe('rejected');
    expect(decision.selectedHostId).toBeNull();
    expect(decision.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ hostId: 'host-draining', eligible: false, reasons: expect.arrayContaining(['host maintenance state is draining']) }),
      expect.objectContaining({ hostId: 'host-unschedulable', eligible: false, reasons: expect.arrayContaining(['host quarantined for drift']) }),
    ]));
  });

  it('rejects hosts with blocking bootstrap drift from new placements', () => {
    const decision = scheduleBaremetalPlacement({
      request: {
        region: 'fsn1',
        resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      },
      hosts: [
        baseHost({
          id: 'host-drifted',
          metadata: { bootstrap: { drift_status: 'blocking_drift' } },
        }),
        baseHost({
          id: 'host-clean',
          runnerBaseUrl: 'http://runner-b',
          publicIpv4: '2.2.2.2',
        }),
      ],
    });

    expect(decision.selectedHostId).toBe('host-clean');
    expect(decision.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hostId: 'host-drifted',
        eligible: false,
        reasons: expect.arrayContaining(['host has blocking bootstrap drift and is not eligible for placement']),
        schedulingHints: expect.objectContaining({ driftStatus: 'blocking_drift', schedulable: false }),
      }),
    ]));
  });

  it('surfaces warning bootstrap drift without hard-blocking placement', () => {
    const decision = scheduleBaremetalPlacement({
      request: {
        region: 'fsn1',
        resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      },
      hosts: [
        baseHost({ metadata: { bootstrap: { drift_status: 'warning_drift' } } }),
      ],
    });

    expect(decision.selectedHostId).toBe('host-a');
    expect(decision.candidates[0]).toMatchObject({
      hostId: 'host-a',
      eligible: true,
      schedulingHints: { driftStatus: 'warning_drift', schedulable: true },
    });
    expect(decision.candidates[0]?.reasons).toEqual(expect.arrayContaining(['host has warning bootstrap drift']));
  });

  it('uses warm-pool, image locality, and host-class policy hooks in scoring', () => {
    const decision = scheduleBaremetalPlacement({
      request: {
        region: 'fsn1',
        resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
        imageAlias: 'justavps-golden',
        policy: { preferredHostClasses: ['general-small'] },
      },
      hosts: [
        baseHost({
          id: 'host-warm',
          metadata: {
            scheduler: {
              warm_pool: { available_cpu_buckets: [2], ready: 1, target: 1 },
              image_locality: { aliases: ['justavps-golden'], state: 'local' },
            },
          },
        }),
        baseHost({
          id: 'host-cold',
          hostClass: 'general-large',
          runnerBaseUrl: 'http://runner-b',
          publicIpv4: '2.2.2.2',
          metadata: { scheduler: { image_locality: { aliases: ['other-image'], state: 'remote' } } },
        }),
      ],
    });

    expect(decision.selectedHostId).toBe('host-warm');
    expect(decision.candidates[0]).toMatchObject({
      hostId: 'host-warm',
      eligible: true,
      schedulingHints: {
        warmPool: 'cpu_bucket',
        imageLocality: 'local',
      },
    });
    expect(decision.candidates[0]?.reasons).toEqual(expect.arrayContaining([
      'warm pool CPU bucket available',
      'image already local on host',
      'preferred host class match (general-small)',
    ]));
  });

  it('uses host-class policy hooks when choosing between otherwise similar hosts', () => {
    const decision = scheduleBaremetalPlacement({
      request: {
        region: 'fsn1',
        resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
        policy: { requiredHostClass: 'general-large', preferredHostClasses: ['general-large'] },
      },
      hosts: [
        baseHost(),
        baseHost({
          id: 'host-b',
          runnerBaseUrl: 'http://runner-b',
          publicIpv4: '2.2.2.2',
          hostClass: 'general-large',
        }),
      ],
    });

    expect(decision.selectedHostId).toBe('host-b');
    expect(decision.candidates[0]).toMatchObject({
      hostId: 'host-b',
      schedulingHints: {
        hostClass: 'general-large',
      },
    });
    expect(decision.candidates[0]?.reasons).toEqual(expect.arrayContaining([
      'preferred host class match (general-large)',
    ]));
  });
});

describe('pickBaremetalHostForPlan', () => {
  it('returns the selected host plus the scheduler decision', () => {
    const selected = pickBaremetalHostForPlan({
      region: 'fsn1',
      serverType: 'starter',
      hosts: [
        baseHost({ id: 'host-a', capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 14, usedMemoryGb: 40, usedDiskGb: 400 } }),
        baseHost({ id: 'host-b', runnerBaseUrl: 'http://runner-b', publicIpv4: '2.2.2.2', capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 4, usedMemoryGb: 8, usedDiskGb: 80 } }),
      ],
    });

    expect(selected?.host.id).toBe('host-b');
    expect(selected?.decision.selectedHostId).toBe('host-b');
    expect(selected?.decision.outcome).toBe('placed');
  });
});

describe('pickBaremetalHostForResources', () => {
  it('accounts for active reservations when placing custom-resource machines', () => {
    const selected = pickBaremetalHostForResources({
      region: 'fsn1',
      resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      hosts: [
        {
          ...baseHost({
            id: 'host-a',
            capacity: { totalVcpu: 8, totalMemoryGb: 16, totalDiskGb: 320, usedVcpu: 4, usedMemoryGb: 8, usedDiskGb: 160 },
          }),
          reservations: {
            reserved: { vcpu: 2, memoryGb: 4, diskGb: 80 },
            committed: { vcpu: 4, memoryGb: 8, diskGb: 160 },
          },
        },
        {
          ...baseHost({
            id: 'host-b',
            runnerBaseUrl: 'http://runner-b',
            publicIpv4: '2.2.2.2',
            capacity: { totalVcpu: 8, totalMemoryGb: 16, totalDiskGb: 320, usedVcpu: 2, usedMemoryGb: 4, usedDiskGb: 80 },
          }),
          reservations: {
            reserved: { vcpu: 0, memoryGb: 0, diskGb: 0 },
            committed: { vcpu: 2, memoryGb: 4, diskGb: 80 },
          },
        },
      ],
    });

    expect(selected?.id).toBe('host-b');
  });
});
