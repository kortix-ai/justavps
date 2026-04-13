import { describe, expect, it, vi } from 'vitest';

describe('runnerd proxy device setup helpers', () => {
  it('adds warm claim proxy devices without eth0 override', async () => {
    const runIncus = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const { setupWarmClaimProxyDevices } = await import('../../../runnerd/src/network/proxy-devices');

    await setupWarmClaimProxyDevices({
      instanceName: 'vm-1',
      vmIp: '10.0.0.5',
      sshPort: 22001,
      httpPort: 8001,
      publicIpv4: '1.2.3.4',
      runIncus,
      incusTarget: (name) => name ?? '',
    });

    expect(runIncus).toHaveBeenCalledWith(['config', 'device', 'add', 'vm-1', 'ssh', 'proxy', 'nat=true', 'listen=tcp:1.2.3.4:22001', 'connect=tcp:10.0.0.5:22'], 10000);
    expect(runIncus).toHaveBeenCalledWith(['config', 'device', 'add', 'vm-1', 'http', 'proxy', 'nat=true', 'listen=tcp:1.2.3.4:8001', 'connect=tcp:10.0.0.5:80'], 10000);
  });

  it('adds container proxy devices to port-forward app traffic', async () => {
    const runIncus = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const { setupContainerProxyDevices } = await import('../../../runnerd/src/network/proxy-devices');

    await setupContainerProxyDevices({
      instanceName: 'container-1',
      containerIp: '10.0.0.9',
      sshPort: 22002,
      httpPort: 8002,
      publicIpv4: '1.2.3.4',
      runIncus,
      incusTarget: (name) => name ?? '',
    });

    expect(runIncus).toHaveBeenCalledWith(['config', 'device', 'add', 'container-1', 'http', 'proxy', 'nat=true', 'listen=tcp:1.2.3.4:8002', 'connect=tcp:10.0.0.9:80'], 10000);
  });
});
