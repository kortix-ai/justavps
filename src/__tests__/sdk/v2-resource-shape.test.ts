import { describe, expect, it, vi } from 'vitest';

import { JustAVPSV2Direct } from '@/sdk';

describe('JustAVPSV2 resource shape', () => {
  it('creates machines via /api/v2 with plan-based payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ id: 'm1', slug: 'abc', status: 'provisioning', plan: { id: 'starter' }, billing: { mode: 'flat_monthly' }, connectivity: {}, capabilities: {}, region: 'hel1', name: 'x', created_at: new Date().toISOString(), ready_at: null }),
    } as Response);
    const client = new JustAVPSV2Direct({ apiKey: 'test-key', fetch: fetchMock as typeof fetch });
    await client.machines.create({ plan: 'starter', region: 'hel1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v2/machines');
    expect(JSON.parse(String(init.body))).toMatchObject({ plan: 'starter', region: 'hel1' });
  });
});
