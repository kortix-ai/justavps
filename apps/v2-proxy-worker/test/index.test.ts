import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { sha256Hex } from '../src/auth';
import type { Env } from '../src/types';

const UUID = 'fd7510ee-2be6-49f2-a747-c0ccd2660c53';

function createKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: (key: string, value: unknown) => store.set(key, JSON.stringify(value)),
  };
}

async function envWithToken(token: string): Promise<Env> {
  const kv = createKv();
  kv.set(`pt:${await sha256Hex(token)}`, {
    account_id: 'system', machine_id: UUID, machine_slug: UUID, ports: [8000],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  kv.set(`machine:${UUID}`, {
    account_id: 'system', machine_id: UUID, origin_hostname: 'origin.example.internal', status: 'Running', server_type: 'vm',
  });
  return { KV: kv as unknown as KVNamespace, PLATFORM_URL: 'http://localhost:4300', PROXY_DOMAINS: 'kortix-dev.cloud' };
}

describe('v2 worker', () => {
  it('sets a v2 proxy-token cookie and redirects query-token GETs', async () => {
    const response = await worker.fetch(
      new Request(`https://v2.kortix-dev.cloud/8000--${UUID}/?__proxy_token=pt_share`, { headers: { Accept: 'text/html' } }),
      await envWithToken('pt_share'),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('__justavps_v2_pt=pt_share');
    expect(response.headers.get('Location')).toBe(`https://v2.kortix-dev.cloud/8000--${UUID}/`);
  });

  it('proxies cookie-authenticated requests to the configured origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const response = await worker.fetch(
      new Request(`https://v2.kortix-dev.cloud/8000--${UUID}/app?x=1`, { headers: { Cookie: '__justavps_v2_pt=pt_share' } }),
      await envWithToken('pt_share'),
    );
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith('http://origin.example.internal/_port/8000/app?x=1', expect.objectContaining({ method: 'GET' }));
    fetchSpy.mockRestore();
  });
});
