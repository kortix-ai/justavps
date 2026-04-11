import { describe, expect, it } from 'vitest';

import { hostHasAvailableCapacity, projectHostUsage, summarizeReservationUsage } from '@/server/lib/baremetal/reservations';

describe('host capacity reservations', () => {
  it('counts reserved and committed capacity separately', () => {
    const summary = summarizeReservationUsage([
      {
        state: 'reserved',
        vcpu: 2,
        memoryGb: 4,
        diskGb: 80,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        state: 'committed',
        vcpu: 4,
        memoryGb: 8,
        diskGb: 160,
        expiresAt: null,
      },
      {
        state: 'reserved',
        vcpu: 8,
        memoryGb: 16,
        diskGb: 320,
        expiresAt: new Date(Date.now() - 60_000),
      },
    ] as never[]);

    expect(summary).toEqual({
      reserved: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      committed: { vcpu: 4, memoryGb: 8, diskGb: 160 },
    });
  });

  it('projects host usage from the larger of reconcile usage and committed leases plus pending reservations', () => {
    const usage = projectHostUsage({
      usedVcpu: 3,
      usedMemoryGb: 6,
      usedDiskGb: 120,
    }, {
      reserved: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      committed: { vcpu: 5, memoryGb: 10, diskGb: 100 },
    });

    expect(usage).toEqual({
      vcpu: 7,
      memoryGb: 14,
      diskGb: 200,
    });
  });

  it('rejects placement when pending reservations consume the remaining headroom', () => {
    const fits = hostHasAvailableCapacity({
      totalVcpu: 8,
      totalMemoryGb: 16,
      totalDiskGb: 320,
      usedVcpu: 4,
      usedMemoryGb: 8,
      usedDiskGb: 160,
    } as never, {
      reserved: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      committed: { vcpu: 4, memoryGb: 8, diskGb: 160 },
    }, {
      vcpu: 3,
      memoryGb: 5,
      diskGb: 100,
    });

    expect(fits).toBe(false);
  });
});
