import { describe, expect, it } from 'vitest';

import { pickBaremetalHostForPlan } from '@/server/lib/baremetal/scheduler';

describe('pickBaremetalHostForPlan', () => {
  it('picks an active host in the same region with enough free capacity', () => {
    const selected = pickBaremetalHostForPlan({
      region: 'fsn1',
      serverType: 'starter',
      hosts: [
        {
          id: 'host-a',
          region: 'fsn1',
          status: 'active',
          runnerBaseUrl: 'http://runner-a',
          publicIpv4: '1.1.1.1',
          capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 14, usedMemoryGb: 40, usedDiskGb: 400 },
        },
        {
          id: 'host-b',
          region: 'fsn1',
          status: 'active',
          runnerBaseUrl: 'http://runner-b',
          publicIpv4: '2.2.2.2',
          capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 4, usedMemoryGb: 8, usedDiskGb: 80 },
        },
      ],
    });

    expect(selected?.host.id).toBe('host-b');
  });

  it('ignores hosts that are not active or have no runner URL', () => {
    const selected = pickBaremetalHostForPlan({
      region: 'fsn1',
      serverType: 'basic',
      hosts: [
        {
          id: 'host-a',
          region: 'fsn1',
          status: 'bootstrapping',
          runnerBaseUrl: 'http://runner-a',
          publicIpv4: '1.1.1.1',
          capacity: { totalVcpu: 32, totalMemoryGb: 128, totalDiskGb: 1600, usedVcpu: 0, usedMemoryGb: 0, usedDiskGb: 0 },
        },
        {
          id: 'host-b',
          region: 'fsn1',
          status: 'active',
          runnerBaseUrl: null,
          publicIpv4: '2.2.2.2',
          capacity: { totalVcpu: 32, totalMemoryGb: 128, totalDiskGb: 1600, usedVcpu: 0, usedMemoryGb: 0, usedDiskGb: 0 },
        },
      ],
    });

    expect(selected).toBeNull();
  });

  it('returns null when no host has enough free resources', () => {
    const selected = pickBaremetalHostForPlan({
      region: 'fsn1',
      serverType: 'ultra',
      hosts: [
        {
          id: 'host-a',
          region: 'fsn1',
          status: 'active',
          runnerBaseUrl: 'http://runner-a',
          publicIpv4: '1.1.1.1',
          capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 800, usedVcpu: 8, usedMemoryGb: 40, usedDiskGb: 300 },
        },
      ],
    });

    expect(selected).toBeNull();
  });
});
