import { describe, expect, it, vi } from 'vitest';

describe('runnerd instance wait helpers', () => {
  it('waits until an instance appears', async () => {
    const queryIncus = vi.fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({});
    const delay = vi.fn().mockResolvedValue(undefined);

    const { waitForInstance } = await import('../../../runnerd/src/incus/instance-wait');
    await waitForInstance({ instanceName: 'demo', queryIncus, delay, timeoutMs: 5000, intervalMs: 1 });

    expect(queryIncus).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('waits until private IPv4 exists', async () => {
    const inspectInstance = vi.fn()
      .mockResolvedValueOnce({ privateIpv4: null })
      .mockResolvedValueOnce({ privateIpv4: '10.0.0.5', status: 'Running' });
    const delay = vi.fn().mockResolvedValue(undefined);

    const { waitForPrivateIpv4 } = await import('../../../runnerd/src/incus/instance-wait');
    const result = await waitForPrivateIpv4({ instanceName: 'demo', inspectInstance, delay, timeoutMs: 5000, intervalMs: 1 });

    expect(result).toEqual({ privateIpv4: '10.0.0.5', status: 'Running' });
    expect(inspectInstance).toHaveBeenCalledTimes(2);
  });
});
