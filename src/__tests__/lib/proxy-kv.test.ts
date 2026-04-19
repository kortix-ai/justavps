import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = {
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_GLOBAL_API_KEY: process.env.CLOUDFLARE_GLOBAL_API_KEY,
  CLOUDFLARE_EMAIL: process.env.CLOUDFLARE_EMAIL,
  CF_KV_NAMESPACE_ID: process.env.CF_KV_NAMESPACE_ID,
};

describe('proxy KV deletion', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
    process.env.CLOUDFLARE_GLOBAL_API_KEY = 'cf-key';
    process.env.CLOUDFLARE_EMAIL = 'ops@example.com';
    process.env.CF_KV_NAMESPACE_ID = 'ns-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.CLOUDFLARE_ACCOUNT_ID = originalEnv.CLOUDFLARE_ACCOUNT_ID;
    process.env.CLOUDFLARE_GLOBAL_API_KEY = originalEnv.CLOUDFLARE_GLOBAL_API_KEY;
    process.env.CLOUDFLARE_EMAIL = originalEnv.CLOUDFLARE_EMAIL;
    process.env.CF_KV_NAMESPACE_ID = originalEnv.CF_KV_NAMESPACE_ID;
  });

  it('treats a 404 delete as already gone', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const { deleteProxyTokenFromKV } = await import("@/server/v1/services/proxy-kv");

    await expect(deleteProxyTokenFromKV('pt-sha')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when Cloudflare rejects the delete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 403 }));
    const { deleteProxyTokenFromKV } = await import("@/server/v1/services/proxy-kv");

    await expect(deleteProxyTokenFromKV('pt-sha')).rejects.toThrow('KV delete failed: 403 boom');
  });
});
