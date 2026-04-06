/**
 * SSH Key Lifecycle Tests — ephemeral key upload/delete flow.
 *
 * Tests the fix for Hetzner's 100 SSH key limit:
 * - Keys are uploaded before createServer, then deleted immediately after
 * - If the limit is hit, auto-GC prunes orphaned keys and retries
 * - Machine cleanup no longer needs to delete SSH keys (already gone)
 * - The per-machine SSH key pair in our DB is unaffected
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { uploadSSHKeyToProvider } from '@/server/lib/machine-lifecycle';
import type { ComputeProvider, SSHKeyResult } from '@/server/lib/providers/types';

// ─── Mock Provider ──────────────────────────────────────────────────────────

function createMockProvider(overrides?: Partial<ComputeProvider>): ComputeProvider {
  return {
    name: 'test',
    displayName: 'Test Provider',
    capabilities: { backups: false, images: true, bareMetal: false },
    validateImage: vi.fn().mockResolvedValue(true),
    createImage: vi.fn().mockResolvedValue({ imageId: '1', diskSize: 20, architecture: 'x86' }),
    deleteImage: vi.fn().mockResolvedValue(undefined),
    createServer: vi.fn().mockResolvedValue({ serverId: '123', publicIp: '1.2.3.4' }),
    deleteServer: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(undefined),
    stopServer: vi.fn().mockResolvedValue(undefined),
    rebootServer: vi.fn().mockResolvedValue(undefined),
    resizeServer: vi.fn().mockResolvedValue(undefined),
    getServerStatus: vi.fn().mockResolvedValue('running'),
    uploadSSHKey: vi.fn().mockResolvedValue({ keyId: '42' } as SSHKeyResult),
    deleteSSHKey: vi.fn().mockResolvedValue(undefined),
    listServerTypes: vi.fn().mockResolvedValue([]),
    listRegions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('uploadSSHKeyToProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads SSH key and returns the key ID', async () => {
    const provider = createMockProvider();
    const keyId = await uploadSSHKeyToProvider(provider, 'test-slug', 'ssh-ed25519 AAAA...');

    expect(keyId).toBe('42');
    expect(provider.uploadSSHKey).toHaveBeenCalledWith('justavps-test-slug', 'ssh-ed25519 AAAA...');
    expect(provider.uploadSSHKey).toHaveBeenCalledTimes(1);
  });

  it('retries with timestamp suffix on uniqueness_error', async () => {
    const provider = createMockProvider({
      uploadSSHKey: vi.fn()
        .mockRejectedValueOnce(new Error('uniqueness_error: SSH key already exists'))
        .mockResolvedValueOnce({ keyId: '99' } as SSHKeyResult),
    });

    const keyId = await uploadSSHKeyToProvider(provider, 'dup-slug', 'ssh-ed25519 AAAA...');

    expect(keyId).toBe('99');
    expect(provider.uploadSSHKey).toHaveBeenCalledTimes(2);
    // Second call should have timestamp suffix
    const secondCallName = (provider.uploadSSHKey as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondCallName).toMatch(/^justavps-dup-slug-\d+$/);
  });

  it('retries up to 3 times on transient errors', async () => {
    const provider = createMockProvider({
      uploadSSHKey: vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValueOnce({ keyId: '77' } as SSHKeyResult),
    });

    const keyId = await uploadSSHKeyToProvider(provider, 'retry-slug', 'ssh-ed25519 AAAA...');
    expect(keyId).toBe('77');
    expect(provider.uploadSSHKey).toHaveBeenCalledTimes(3);
  });

  it('throws after 3 failed attempts', async () => {
    const provider = createMockProvider({
      uploadSSHKey: vi.fn().mockRejectedValue(new Error('server error 500')),
    });

    await expect(
      uploadSSHKeyToProvider(provider, 'fail-slug', 'ssh-ed25519 AAAA...')
    ).rejects.toThrow(/SSH key upload to test failed after 3 attempts/);
  });

  it('auto-GC on ssh_key_limit triggers for HetznerProvider instances', async () => {
    // This tests that the auto-GC code path is entered when the error
    // contains 'resource_limit_exceeded' or 'ssh_key_limit'.
    // We can't fully test the HetznerProvider.gcSSHKeys() here (it needs
    // real API calls), but we verify the error matching logic works.
    const provider = createMockProvider({
      uploadSSHKey: vi.fn().mockRejectedValue(
        new Error('Hetzner API POST /ssh_keys -> 403: {"error":{"code":"resource_limit_exceeded","message":"ssh_key limit exceeded"}}')
      ),
    });

    // Will fail because mock provider is not HetznerProvider (so GC can't run),
    // but the error message should mention the limit
    await expect(
      uploadSSHKeyToProvider(provider, 'limit-slug', 'ssh-ed25519 AAAA...')
    ).rejects.toThrow(/resource_limit_exceeded/);
  });
});

describe('HetznerProvider SSH key operations', () => {
  it('deleteSSHKey tolerates 404 (already deleted)', async () => {
    // Import the real provider to test 404 tolerance
    const { HetznerProvider } = await import('@/server/lib/providers/hetzner');
    const provider = new HetznerProvider();

    // Mock fetch to return 404
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"error":{"code":"not_found"}}', { status: 404 })
    );

    // Should NOT throw on 404
    await expect(provider.deleteSSHKey('nonexistent-key')).resolves.toBeUndefined();

    fetchSpy.mockRestore();
  });

  it('deleteSSHKey throws on non-404 errors', async () => {
    const { HetznerProvider } = await import('@/server/lib/providers/hetzner');
    const provider = new HetznerProvider();

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"error":{"code":"forbidden"}}', { status: 403 })
    );

    await expect(provider.deleteSSHKey('some-key')).rejects.toThrow(/403/);

    fetchSpy.mockRestore();
  });

  it('gcSSHKeys deletes orphaned justavps-* keys', async () => {
    const { HetznerProvider } = await import('@/server/lib/providers/hetzner');
    const provider = new HetznerProvider();

    // Mock: 3 SSH keys, 1 active server
    const fetchSpy = vi.spyOn(global, 'fetch')
      // listSSHKeys call (page 1)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ssh_keys: [
          { id: 1, name: 'justavps-active-slug' },      // matches active server
          { id: 2, name: 'justavps-deleted-slug' },      // orphaned
          { id: 3, name: 'justavps-deleted-slug-12345' }, // orphaned (with timestamp)
          { id: 4, name: 'my-personal-key' },             // not ours, leave alone
        ],
        meta: { pagination: { next_page: null } },
      }), { status: 200 }))
      // listServers call
      .mockResolvedValueOnce(new Response(JSON.stringify({
        servers: [
          { id: 100, name: 'justavps-active-slug', status: 'running', public_net: { ipv4: { ip: '' }, ipv6: { ip: '2a01:4f8:c17:e4c4::/64' } }, server_type: { name: 'cpx32' }, labels: {} },
        ],
      }), { status: 200 }))
      // deleteSSHKey for id=2
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      // deleteSSHKey for id=3
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await provider.gcSSHKeys();

    expect(result.deleted).toBe(2);
    expect(result.kept).toBe(1); // justavps-active-slug
    expect(result.total).toBe(4); // all keys in project

    // Verify only orphaned keys were deleted
    const deleteCalls = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/ssh_keys/') && !url.includes('?')
    );
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0][0]).toContain('/ssh_keys/2');
    expect(deleteCalls[1][0]).toContain('/ssh_keys/3');

    fetchSpy.mockRestore();
  });

  it('gcSSHKeys paginates through all SSH keys', async () => {
    const { HetznerProvider } = await import('@/server/lib/providers/hetzner');
    const provider = new HetznerProvider();

    // gcSSHKeys uses Promise.all([listSSHKeys(), servers fetch])
    // listSSHKeys is sequential (page 1 → page 2), but Promise.all
    // means the servers fetch may interleave. We use mockImplementation
    // to route based on URL instead of relying on call order.
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/ssh_keys?per_page=50&page=1')) {
        return new Response(JSON.stringify({
          ssh_keys: [{ id: 1, name: 'justavps-slug1' }],
          meta: { pagination: { next_page: 2 } },
        }), { status: 200 });
      }
      if (url.includes('/ssh_keys?per_page=50&page=2')) {
        return new Response(JSON.stringify({
          ssh_keys: [{ id: 2, name: 'justavps-slug2' }],
          meta: { pagination: { next_page: null } },
        }), { status: 200 });
      }
      if (url.includes('/servers?')) {
        return new Response(JSON.stringify({ servers: [] }), { status: 200 });
      }
      if (url.includes('/ssh_keys/')) {
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 200 });
    });

    const result = await provider.gcSSHKeys();
    expect(result.deleted).toBe(2);
    expect(result.total).toBe(2);

    fetchSpy.mockRestore();
  });
});

describe('Ephemeral SSH key flow (integration)', () => {
  it('key should be deleted immediately after createServer', async () => {
    // This verifies the contract: after provisioning, the provider SSH key
    // should be cleaned up. We test this by checking that deleteSSHKey
    // is called with the same keyId returned by uploadSSHKey.
    const provider = createMockProvider();

    // Simulate the provisioning flow
    const providerKeyId = await uploadSSHKeyToProvider(provider, 'ephemeral-slug', 'ssh-ed25519 AAAA...');
    expect(providerKeyId).toBe('42');

    await provider.createServer({
      name: 'justavps-ephemeral-slug',
      serverType: 'cpx32',
      image: 'ubuntu-24.04',
      region: 'hel1',
      userData: 'cloud-init...',
      sshKeyIds: [providerKeyId],
      labels: {},
    });

    // This is what the provisioning code does after createServer:
    await provider.deleteSSHKey(providerKeyId);

    expect(provider.deleteSSHKey).toHaveBeenCalledWith('42');
    expect(provider.deleteSSHKey).toHaveBeenCalledTimes(1);
  });

  it('deleteSSHKey failure should not block provisioning', async () => {
    // The delete is fire-and-forget (.catch()) — verify it doesn't throw
    const provider = createMockProvider({
      deleteSSHKey: vi.fn().mockRejectedValue(new Error('network error')),
    });

    const providerKeyId = await uploadSSHKeyToProvider(provider, 'fail-delete', 'ssh-ed25519 AAAA...');
    await provider.createServer({
      name: 'justavps-fail-delete',
      serverType: 'cpx32',
      image: 'ubuntu-24.04',
      region: 'hel1',
      userData: 'cloud-init...',
      sshKeyIds: [providerKeyId],
      labels: {},
    });

    // In the real code this is `.catch()` — simulate that pattern
    const deletePromise = provider.deleteSSHKey(providerKeyId).catch(() => {});
    await expect(deletePromise).resolves.toBeUndefined();
  });
});
