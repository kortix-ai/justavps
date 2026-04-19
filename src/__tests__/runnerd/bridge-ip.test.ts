import { describe, expect, it, vi } from 'vitest';

describe('runnerd static bridge IPv4 allocation', () => {
  it('allocates the highest free IP in the reserved range', async () => {
    const queryIncus = vi.fn()
      .mockResolvedValueOnce({ config: { 'ipv4.address': '10.189.108.1/24' } })
      .mockResolvedValueOnce([
        { address: '10.189.108.250' },
        { address: '10.189.108.249' },
      ]);

    const { allocateStaticBridgeIpv4 } = await import('../../../apps/runnerd/src/network/bridge-ip');
    await expect(allocateStaticBridgeIpv4({ queryIncus })).resolves.toBe('10.189.108.248');
  });

  it('returns null when subnet shape is unsupported', async () => {
    const queryIncus = vi.fn().mockResolvedValueOnce({ config: { 'ipv4.address': '10.189.108.1/16' } });
    const { allocateStaticBridgeIpv4 } = await import('../../../apps/runnerd/src/network/bridge-ip');
    await expect(allocateStaticBridgeIpv4({ queryIncus })).resolves.toBeNull();
  });
});
