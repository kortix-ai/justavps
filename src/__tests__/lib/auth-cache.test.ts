import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const selectLimitMock = vi.fn();
const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
const selectFromMock = vi.fn(() => ({ where: selectWhereMock, limit: selectLimitMock }));
const selectMock = vi.fn(() => ({ from: selectFromMock }));

const acquireControlPlaneServiceLeaseMock = vi.fn();
const releaseControlPlaneServiceLeaseMock = vi.fn();
const buildControlPlaneServiceKeyMock = vi.fn((target: { service: string; scope?: string }) => `${target.service}:${target.scope ?? 'global'}`);

const syncApiKeyHashToKVMock = vi.fn();
const deleteApiKeyFromKVMock = vi.fn();
const deleteProxyTokenFromKVMock = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    execute: executeMock,
    select: selectMock,
  },
}));

vi.mock('@/server/platform/control-plane/service-state', () => ({
  acquireControlPlaneServiceLease: acquireControlPlaneServiceLeaseMock,
  releaseControlPlaneServiceLease: releaseControlPlaneServiceLeaseMock,
  buildControlPlaneServiceKey: buildControlPlaneServiceKeyMock,
}));

vi.mock('@/server/v1/services/proxy-kv', () => ({
  syncApiKeyHashToKV: syncApiKeyHashToKVMock,
  deleteApiKeyFromKV: deleteApiKeyFromKVMock,
  deleteProxyTokenFromKV: deleteProxyTokenFromKVMock,
}));

describe('auth cache control-plane service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-auth-cache', row: null });
    executeMock.mockResolvedValue({ rows: [{ id: 'pt-1', token_sha256: 'sha-1' }, { id: 'pt-2', token_sha256: 'sha-2' }] });
    selectLimitMock
      .mockResolvedValueOnce([
        {
          id: 'key-expired',
          keySha256: 'key-sha-expired',
          accountId: 'acct-1',
          name: 'expired-key',
          scope: 'account',
          machineIds: null,
          permissions: ['*'],
          expiresAt: new Date('2026-04-10T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'key-1',
          keySha256: 'key-sha-1',
          accountId: 'acct-1',
          name: 'test-key',
          scope: 'account',
          machineIds: null,
          permissions: ['*'],
          expiresAt: null,
        },
      ]);
    syncApiKeyHashToKVMock.mockResolvedValue(undefined);
    deleteApiKeyFromKVMock.mockResolvedValue(undefined);
    deleteProxyTokenFromKVMock.mockResolvedValue(undefined);
  });

  it('scans expired and active API keys independently so one side does not starve the other', async () => {
    const { runAuthCacheServicePass } = await import("@/server/platform/control-plane/auth-cache");

    await runAuthCacheServicePass({ limit: 1 });

    expect(selectWhereMock).toHaveBeenCalledTimes(2);
    expect(selectLimitMock).toHaveBeenCalledTimes(2);
    expect(deleteApiKeyFromKVMock).toHaveBeenCalledWith('key-sha-expired');
    expect(syncApiKeyHashToKVMock).toHaveBeenCalledWith('key-sha-1', 'acct-1', 'test-key', expect.anything());
  });

  it('deletes pruned proxy-token KV entries and records the deletion count', async () => {
    const { runAuthCacheServicePass } = await import("@/server/platform/control-plane/auth-cache");

    const result = await runAuthCacheServicePass({ leaseMs: 45_000, limit: 100 });

    expect(deleteApiKeyFromKVMock).toHaveBeenCalledTimes(1);
    expect(deleteApiKeyFromKVMock).toHaveBeenCalledWith('key-sha-expired');
    expect(deleteProxyTokenFromKVMock).toHaveBeenCalledTimes(2);
    expect(deleteProxyTokenFromKVMock).toHaveBeenNthCalledWith(1, 'sha-1');
    expect(deleteProxyTokenFromKVMock).toHaveBeenNthCalledWith(2, 'sha-2');
    expect(syncApiKeyHashToKVMock).toHaveBeenCalledWith('key-sha-1', 'acct-1', 'test-key', expect.objectContaining({ scope: 'account' }));
    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'auth_cache',
      scope: 'api_keys',
      leaseOwner: 'lease-auth-cache',
      checkpoint: expect.objectContaining({
        last_expired_api_keys_pruned_count: 1,
        last_expired_api_key_kv_deleted_count: 1,
        last_expired_api_key_kv_delete_failed_count: 0,
        last_proxy_tokens_pruned_count: 2,
        last_proxy_token_kv_deleted_count: 2,
        last_proxy_token_kv_delete_failed_count: 0,
        last_synced_count: 1,
        last_sync_failed_count: 0,
      }),
      metadata: expect.objectContaining({ last_error: null }),
    }));
    expect(result).toMatchObject({
      acquired: true,
      expiredApiKeysPruned: 1,
      expiredApiKeyKvDeleted: 1,
      expiredApiKeyKvDeleteFailed: 0,
      proxyTokensPruned: 2,
      proxyTokenKvDeleted: 2,
      proxyTokenKvDeleteFailed: 0,
      synced: 1,
      syncFailed: 0,
      scope: 'auth_cache:api_keys',
    });
  });

  it('records partial failures without leaving the service lease stuck', async () => {
    deleteApiKeyFromKVMock.mockRejectedValueOnce(new Error('expired api key delete failed'));
    deleteProxyTokenFromKVMock.mockRejectedValueOnce(new Error('kv delete failed'));
    syncApiKeyHashToKVMock.mockRejectedValueOnce(new Error('kv sync failed'));

    const { runAuthCacheServicePass } = await import("@/server/platform/control-plane/auth-cache");

    const result = await runAuthCacheServicePass();

    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ last_error: 'expired api key delete failed; kv delete failed; kv sync failed' }),
      checkpoint: expect.objectContaining({
        last_expired_api_keys_pruned_count: 1,
        last_expired_api_key_kv_deleted_count: 0,
        last_expired_api_key_kv_delete_failed_count: 1,
        last_proxy_tokens_pruned_count: 2,
        last_proxy_token_kv_deleted_count: 1,
        last_proxy_token_kv_delete_failed_count: 1,
        last_synced_count: 0,
        last_sync_failed_count: 1,
      }),
    }));
    expect(result).toMatchObject({
      acquired: true,
      expiredApiKeysPruned: 1,
      expiredApiKeyKvDeleted: 0,
      expiredApiKeyKvDeleteFailed: 1,
      proxyTokenKvDeleted: 1,
      proxyTokenKvDeleteFailed: 1,
      synced: 0,
      syncFailed: 1,
    });
  });
});
