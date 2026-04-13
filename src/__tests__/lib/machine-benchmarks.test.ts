import { beforeEach, describe, expect, it, vi } from 'vitest';

const returningMock = vi.fn();
const valuesMock = vi.fn(() => ({ returning: returningMock }));
const insertMock = vi.fn(() => ({ values: valuesMock }));

vi.mock('@/server/db', () => ({
  db: {
    insert: insertMock,
  },
}));

describe('machine benchmark parsing and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    returningMock.mockResolvedValue([{ id: 'bench-1' }]);
  });

  it('parses valid start-time benchmark metadata', async () => {
    const { parseMachineBenchmarkRecord } = await import('@/server/lib/machine-benchmarks');

    const record = parseMachineBenchmarkRecord({
      machineId: 'machine-1',
      accountId: 'account-1',
      baremetalHostId: 'host-1',
      machineMode: 'vm',
      metadata: {
        incus_status: 'Running',
        benchmark: {
          scenario: 'warm_pool_start',
          total_ms: 2712,
          stage_timings: {
            claim_ms: 180,
            proxy_ms: 1200,
          },
        },
      },
    });

    expect(record).toMatchObject({
      machineId: 'machine-1',
      accountId: 'account-1',
      baremetalHostId: 'host-1',
      machineMode: 'vm',
      scenario: 'warm_pool_start',
      totalMs: 2712,
      success: true,
      stageTimings: {
        claim_ms: 180,
        proxy_ms: 1200,
      },
    });
  });

  it('persists valid benchmark records and ignores malformed payloads', async () => {
    const { recordMachineBenchmark } = await import('@/server/lib/machine-benchmarks');

    const inserted = await recordMachineBenchmark({
      machineId: 'machine-1',
      accountId: 'account-1',
      baremetalHostId: 'host-1',
      machineMode: 'vm',
      metadata: {
        benchmark: {
          scenario: 'cold_create',
          total_ms: 18234,
        },
      },
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-1',
      scenario: 'cold_create',
      totalMs: 18234,
      machineMode: 'vm',
    }));
    expect(inserted).toEqual({ id: 'bench-1' });

    const skipped = await recordMachineBenchmark({
      machineId: 'machine-1',
      accountId: 'account-1',
      baremetalHostId: 'host-1',
      machineMode: 'vm',
      metadata: {
        benchmark: {
          scenario: 'not-a-real-scenario',
          total_ms: 99,
        },
      },
    });

    expect(skipped).toBeNull();
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
