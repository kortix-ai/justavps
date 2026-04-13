import { beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const selectWhereMock = vi.fn();
const insertReturningMock = vi.fn();
const deleteWhereMock = vi.fn();
const syncApiKeyToKVMock = vi.fn();
const deleteApiKeyFromKVMock = vi.fn();

vi.mock('@/server/lib/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    c.set('accountId', '22222222-2222-2222-2222-222222222222');
    await next();
  },
  requirePermission: vi.fn(),
  requireMachineAccess: vi.fn(),
}));

vi.mock('@/server/lib/proxy-kv', () => ({
  syncApiKeyToKV: syncApiKeyToKVMock,
  deleteApiKeyFromKV: deleteApiKeyFromKVMock,
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhereMock })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturningMock })) })),
    delete: vi.fn(() => ({ where: deleteWhereMock })),
  },
}));

describe('api key routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    deleteApiKeyFromKVMock.mockResolvedValue(undefined);
    syncApiKeyToKVMock.mockResolvedValue(undefined);
  });

  it('returns 502 and rolls back the DB row when KV sync fails on create', async () => {
    insertReturningMock.mockResolvedValueOnce([{
      id: '33333333-3333-4333-8333-333333333333',
      name: 'build-bot',
      keyPrefix: 'sk_live_abc',
      scope: 'account',
      machineIds: null,
      permissions: ['*'],
      expiresAt: null,
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
    }]);
    syncApiKeyToKVMock.mockRejectedValueOnce(new Error('cf put failed'));
    deleteWhereMock.mockResolvedValueOnce(undefined);

    const { apiKeysApp } = await import('@/server/api/v1/legacy/api-keys');
    const res = await apiKeysApp.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'build-bot', scope: 'account', permissions: ['*'] }),
    }));

    expect(res.status).toBe(502);
    expect(syncApiKeyToKVMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({
      error: true,
      status: 502,
      message: expect.stringContaining('cf put failed'),
    });
  });

  it('deletes API keys from KV by their SHA-256 lookup key', async () => {
    selectWhereMock.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
      keyPrefix: 'sk_live_abc',
      keySha256: 'deadbeefcafebabefeedface0123456789abcdef0123456789abcdef01234567',
    }]);
    deleteWhereMock.mockResolvedValueOnce(undefined);

    const { apiKeysApp } = await import('@/server/api/v1/legacy/api-keys');
    const res = await apiKeysApp.request(new Request('http://localhost/11111111-1111-4111-8111-111111111111', { method: 'DELETE' }));

    expect(res.status).toBe(204);
    expect(deleteApiKeyFromKVMock).toHaveBeenCalledWith('deadbeefcafebabefeedface0123456789abcdef0123456789abcdef01234567');
  });

  it('returns 502 and does not delete the DB row when KV revoke fails', async () => {
    selectWhereMock.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
      keyPrefix: 'sk_live_abc',
      keySha256: 'deadbeefcafebabefeedface0123456789abcdef0123456789abcdef01234567',
    }]);
    deleteApiKeyFromKVMock.mockRejectedValueOnce(new Error('cf delete failed'));

    const { apiKeysApp } = await import('@/server/api/v1/legacy/api-keys');
    const res = await apiKeysApp.request(new Request('http://localhost/11111111-1111-4111-8111-111111111111', { method: 'DELETE' }));

    expect(res.status).toBe(502);
    expect(deleteWhereMock).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: true,
      status: 502,
      message: expect.stringContaining('cf delete failed'),
    });
  });
});
