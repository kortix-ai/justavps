import { describe, expect, it } from 'vitest';

describe('runnerd inspection helpers', () => {
  it('extracts private IPv4 from instance state network', async () => {
    const { extractPrivateIpv4, inspectInstance } = await import('../../../apps/runnerd/src/incus/inspection');

    expect(extractPrivateIpv4({
      eth0: { addresses: [{ family: 'inet', scope: 'global', address: '10.0.0.5' }] },
    })).toBe('10.0.0.5');

    const queryIncus = async <T>() => ({
      status: 'Running',
      network: {
        eth0: { addresses: [{ family: 'inet', scope: 'global', address: '10.0.0.9' }] },
      },
    }) as T;

    await expect(inspectInstance({ instanceName: 'demo', queryIncus })).resolves.toEqual({
      privateIpv4: '10.0.0.9',
      status: 'Running',
    });
  });
});
