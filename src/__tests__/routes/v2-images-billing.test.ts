/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listImagesMock = vi.fn();
const createImageMock = vi.fn();
const deleteImageMock = vi.fn();
const getBillingOverviewMock = vi.fn();
const getBillingComparisonMock = vi.fn();

vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    c.set('accountId', '22222222-2222-2222-2222-222222222222');
    c.set('isAdmin', false);
    return next();
  },
}));

vi.mock('@/server/v2/services/images', () => ({
  listImagesV2: listImagesMock,
  createImageV2: createImageMock,
  deleteImageV2: deleteImageMock,
}));

vi.mock('@/server/v2/services/billing', () => ({
  getBillingOverviewV2: getBillingOverviewMock,
  getBillingComparisonV2: getBillingComparisonMock,
}));

describe('v2 images and billing APIs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('lists images without provider leakage', async () => {
    listImagesMock.mockResolvedValueOnce([
      {
        id: 'img-1',
        name: 'Base Image',
        description: null,
        status: 'ready',
        kind: 'snapshot',
        is_template: false,
        source_machine_id: 'machine-1',
        disk_size_gb: 20,
        architecture: 'x86',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    const { imagesV2App } = await import("@/server/v2/routes/public/images");
    const res = await imagesV2App.request(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.images[0].provider).toBeUndefined();
  });

  it('creates and deletes images through v2 routes', async () => {
    createImageMock.mockResolvedValueOnce({ id: 'img-1', name: 'Base Image' });
    deleteImageMock.mockResolvedValueOnce({ ok: true });
    const { imagesV2App } = await import("@/server/v2/routes/public/images");
    const createRes = await imagesV2App.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine_id: '33333333-3333-4333-8333-333333333333', name: 'Base Image' }),
    }));
    expect(createRes.status).toBe(202);
    expect(createImageMock).toHaveBeenCalled();
    const deleteRes = await imagesV2App.request(new Request('http://localhost/img-1', { method: 'DELETE' }));
    expect(deleteRes.status).toBe(200);
    expect(deleteImageMock).toHaveBeenCalledWith(expect.objectContaining({ imageId: 'img-1' }));
  });

  it('returns billing overview and comparison surfaces', async () => {
    getBillingOverviewMock.mockResolvedValueOnce({
      modes: [{ id: 'flat_monthly', available: true }, { id: 'metered', available: false }],
      current_period: { estimated_cost: 21, machines: 1 },
      usage: { compute_seconds: 0, storage_gb_seconds: 0 },
    });
    getBillingComparisonMock.mockResolvedValueOnce({
      plan: 'basic',
      monthly_price: 21,
      competitors: { e2b_monthly_equivalent: 242, daytona_monthly_equivalent: 193 },
    });
    const { billingV2App } = await import("@/server/v2/routes/public/billing");
    const overviewRes = await billingV2App.request(new Request('http://localhost/overview'));
    expect(overviewRes.status).toBe(200);
    const comparisonRes = await billingV2App.request(new Request('http://localhost/compare?plan=basic&hours_per_day=24'));
    expect(comparisonRes.status).toBe(200);
    const data = await comparisonRes.json();
    expect(data.competitors.e2b_monthly_equivalent).toBeGreaterThan(data.monthly_price);
  });
});
