import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('runnerd image resolution helpers', () => {
  const runIncus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves OCI docker refs only when remote support exists', async () => {
    const { resolveContainerImageReference } = await import('../../../apps/runnerd/src/incus/images');

    runIncus.mockResolvedValueOnce({ stdout: 'local,https://images.linuxcontainers.org,images,none,YES,NO,NO\n', stderr: '' });
    runIncus.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await expect(resolveContainerImageReference('docker:nginx:latest', { runIncus })).resolves.toBe('docker:nginx:latest');
    expect(runIncus).toHaveBeenNthCalledWith(1, ['remote', 'list', '--format', 'csv']);
    expect(runIncus).toHaveBeenNthCalledWith(2, ['remote', 'add', 'docker', 'https://docker.io', '--protocol=oci'], 30000);
  });

  it('falls back to local container golden alias when available', async () => {
    const { resolveContainerImageReference } = await import('../../../apps/runnerd/src/incus/images');

    runIncus.mockResolvedValueOnce({ stdout: 'justavps-golden-container,abcdef,CONTAINER\n', stderr: '' });

    await expect(resolveContainerImageReference('justavps-golden', { runIncus })).resolves.toBe('justavps-golden-container');
  });

  it('maps vm aliases to VM fingerprints', async () => {
    const { resolveVmImageReference } = await import('../../../apps/runnerd/src/incus/images');

    runIncus.mockResolvedValueOnce({ stdout: 'ubuntu/noble/cloud,deadbeef,VIRTUAL-MACHINE\n', stderr: '' });

    await expect(resolveVmImageReference('images:ubuntu/noble/cloud', { runIncus })).resolves.toBe('images:deadbeef');
  });
});
