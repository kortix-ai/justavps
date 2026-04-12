import { beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const selectWhereMock = vi.fn();
const updateWhereMock = vi.fn();
const deleteWhereMock = vi.fn();
const insertReturningMock = vi.fn();
const syncProxyTokenToKVMock = vi.fn();
const deleteProxyTokenFromKVMock = vi.fn();

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
  syncProxyTokenToKV: syncProxyTokenToKVMock,
  deleteProxyTokenFromKV: deleteProxyTokenFromKVMock,
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhereMock })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhereMock })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturningMock })) })),
    delete: vi.fn(() => ({ where: deleteWhereMock })),
  },
}));

describe('proxy token routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    syncProxyTokenToKVMock.mockResolvedValue(undefined);
    deleteProxyTokenFromKVMock.mockResolvedValue(undefined);
  });

  it('returns 502 and rolls back the DB token row when KV sync fails on create', async () => {
    selectWhereMock.mockResolvedValueOnce([{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      accountId: '22222222-2222-2222-2222-222222222222',
      slug: 'machine-slug',
    }]);
    insertReturningMock.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111',
      tokenPrefix: 'pt_abcd',
      label: 'share',
      machineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ports: [8080],
      expiresAt: new Date('2026-04-11T01:00:00.000Z'),
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
    }]);
    syncProxyTokenToKVMock.mockRejectedValueOnce(new Error('cf put failed'));
    deleteWhereMock.mockResolvedValueOnce(undefined);

    const { proxyTokensApp } = await import('@/server/routes/v1/proxy-tokens');
    const res = await proxyTokensApp.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'share', ports: [8080], expires_in_seconds: 3600 }),
    }));

    expect(res.status).toBe(502);
    expect(syncProxyTokenToKVMock).toHaveBeenCalledTimes(1);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({
      error: true,
      status: 502,
      message: expect.stringContaining('cf put failed'),
    });
  });

  it('returns 502 and leaves the DB token active when KV revoke fails', async () => {
    selectWhereMock.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
      tokenSha256: 'deadbeefcafebabefeedface0123456789abcdef0123456789abcdef01234567',
    }]);
    deleteProxyTokenFromKVMock.mockRejectedValueOnce(new Error('cf delete failed'));

    const { proxyTokensApp } = await import('@/server/routes/v1/proxy-tokens');
    const res = await proxyTokensApp.request(new Request('http://localhost/11111111-1111-4111-8111-111111111111', { method: 'DELETE' }));

    expect(res.status).toBe(502);
    expect(updateWhereMock).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: true,
      status: 502,
      message: expect.stringContaining('cf delete failed'),
    });
  });

  it('returns the root proxy URL for port 80 share tokens', async () => {
    selectWhereMock.mockResolvedValueOnce([{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      accountId: '22222222-2222-2222-2222-222222222222',
      slug: 'machine-slug',
    }]);
    insertReturningMock.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111',
      tokenPrefix: 'pt_abcd',
      label: 'share',
      machineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ports: [80],
      expiresAt: new Date('2026-04-11T01:00:00.000Z'),
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
    }]);

    const { proxyTokensApp } = await import('@/server/routes/v1/proxy-tokens');
    const res = await proxyTokensApp.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'share', ports: [80], expires_in_seconds: 3600 }),
    }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      proxy_url: expect.stringMatching(/^https:\/\/machine-slug\.[^?]+\?__proxy_token=pt_/),
    });
  });
});
