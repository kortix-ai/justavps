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
  });

  it('deletes API keys from KV by their SHA-256 lookup key', async () => {
    selectWhereMock.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
      keyPrefix: 'sk_live_abc',
      keySha256: 'deadbeefcafebabefeedface0123456789abcdef0123456789abcdef01234567',
    }]);
    deleteWhereMock.mockResolvedValueOnce(undefined);

    const { apiKeysApp } = await import('@/server/routes/v1/api-keys');
    const res = await apiKeysApp.request(new Request('http://localhost/11111111-1111-4111-8111-111111111111', { method: 'DELETE' }));

    expect(res.status).toBe(204);
    expect(deleteApiKeyFromKVMock).toHaveBeenCalledWith('deadbeefcafebabefeedface0123456789abcdef0123456789abcdef01234567');
  });
});
