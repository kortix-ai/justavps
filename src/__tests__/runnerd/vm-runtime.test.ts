import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

describe('runnerd vm runtime helpers', () => {
  it('builds cold vm create metadata', async () => {
    const { buildVmCreateMetadata } = await import('../../../runnerd/src/runtime/vm/create');

    expect(buildVmCreateMetadata({
      status: 'Running',
      machineMode: 'vm',
      scenario: 'cold_create',
      totalMs: 18234,
    })).toEqual({
      incus_status: 'Running',
      machine_mode: 'vm',
      benchmark: {
        scenario: 'cold_create',
        total_ms: 18234,
      },
    });
  });

  it('builds warm-pool vm create metadata', async () => {
    const { buildWarmPoolVmCreateMetadata } = await import('../../../runnerd/src/runtime/vm/create');

    expect(buildWarmPoolVmCreateMetadata({ machineMode: 'vm', totalMs: 2162 })).toEqual({
      incus_status: 'Running',
      warm_pool: true,
      machine_mode: 'vm',
      benchmark: {
        scenario: 'warm_pool_start',
        total_ms: 2162,
      },
    });
  });

  it('builds deterministic warm pool prefixes and names', async () => {
    const { buildWarmPoolPrefix, buildWarmPoolVmName } = await import('../../../runnerd/src/runtime/vm/create');

    expect(buildWarmPoolPrefix()).toBe('justavps-warm-cpu');
    expect(buildWarmPoolVmName({ prefix: 'justavps-warm-cpu', cpu: 4, suffix: 'abc123' })).toBe('justavps-warm-cpu4-abc123');
  });

  it('checks vm agent readiness through exec + inspection', async () => {
    const runIncus = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const inspectInstance = vi.fn().mockResolvedValue({ privateIpv4: '10.0.0.5' });
    const { checkVmAgentReady } = await import('../../../runnerd/src/runtime/vm/create');

    await expect(checkVmAgentReady({
      name: 'vm-1',
      runIncus,
      incusTarget: (name) => name ?? '',
      inspectInstance,
    })).resolves.toEqual({ ready: true, ip: '10.0.0.5' });
  });
});
