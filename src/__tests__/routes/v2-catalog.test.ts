import { describe, expect, it } from 'vitest';
import { catalogV2App } from '@/server/api/v2/public/catalog';

describe('v2 catalog API', () => {
  it('returns resource pricing rates and limits', async () => {
    const res = await catalogV2App.request(new Request('http://localhost/pricing'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rates).toHaveProperty('vcpu_monthly');
    expect(data.rates).toHaveProperty('ram_gb_monthly');
    expect(data.rates).toHaveProperty('disk_gb_monthly');
    expect(data.limits).toHaveProperty('vcpu');
    expect(data.limits.vcpu).toHaveProperty('min');
    expect(data.limits.vcpu).toHaveProperty('max');
  });

  it('returns UI recommendations with computed prices', async () => {
    const res = await catalogV2App.request(new Request('http://localhost/recommendations'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(data.recommendations.length).toBeGreaterThan(0);
    const rec = data.recommendations[0];
    expect(rec).toHaveProperty('label');
    expect(rec).toHaveProperty('vcpu');
    expect(rec).toHaveProperty('ram_gb');
    expect(rec).toHaveProperty('disk_gb');
    expect(rec).toHaveProperty('price_monthly');
    expect(typeof rec.price_monthly).toBe('number');
  });

  it('lists public regions', async () => {
    const res = await catalogV2App.request(new Request('http://localhost/regions'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.regions)).toBe(true);
    expect(data.regions.some((region: { id: string }) => region.id === 'fsn1')).toBe(true);
  });
});
