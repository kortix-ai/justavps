import { describe, expect, it } from 'vitest';
import { sha256Hex, validateProxyToken } from '../src/auth';

const UUID = 'fd7510ee-2be6-49f2-a747-c0ccd2660c53';

function mockKv(seed: Record<string, unknown>) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return { get: async (key: string) => store.get(key) ?? null } as unknown as KVNamespace;
}

async function kvFor(token: string, ports: number[] | null = [8000]) {
  return mockKv({
    [`pt:${await sha256Hex(token)}`]: {
      account_id: 'system', machine_id: UUID, machine_slug: UUID, ports,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    [`machine:${UUID}`]: {
      account_id: 'system', machine_id: UUID, origin_hostname: '135.181.129.188', status: 'Running', server_type: 'vm',
    },
  });
}

describe('v2 proxy token auth', () => {
  it('accepts query proxy tokens and loads machine routing', async () => {
    const token = 'pt_testtoken';
    const request = new Request(`https://v2.kortix-dev.cloud/8000--${UUID}/?__proxy_token=${token}`);
    const result = await validateProxyToken(request, UUID, 8000, await kvFor(token));
    expect(result.ok).toBe(true);
    expect(result.machine?.machine_id).toBe(UUID);
    expect(result.source).toBe('query');
  });

  it('rejects disallowed ports', async () => {
    const token = 'pt_testtoken';
    const request = new Request(`https://v2.kortix-dev.cloud/3000--${UUID}/`, { headers: { 'X-Proxy-Token': token } });
    const result = await validateProxyToken(request, UUID, 3000, await kvFor(token, [8000]));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});
