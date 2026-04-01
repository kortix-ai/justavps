import { describe, expect, it } from 'vitest';
import { catalogV2App } from '@/server/routes/v2/catalog';

describe('v2 catalog API', () => {
  it('lists public plan offerings without exposing substrate providers', async () => {
    const res = await catalogV2App.request(new Request('http://localhost/plans?region=fsn1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.region).toBe('fsn1');
    expect(Array.isArray(data.plans)).toBe(true);
    expect(data.plans[0]).toHaveProperty('plan');
    expect(data.plans[0]).not.toHaveProperty('provider');
    expect(data.plans[0]).toHaveProperty('features');
  });

  it('lists public regions', async () => {
    const res = await catalogV2App.request(new Request('http://localhost/regions'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.regions)).toBe(true);
    expect(data.regions.some((region: { id: string }) => region.id === 'fsn1')).toBe(true);
  });
});
