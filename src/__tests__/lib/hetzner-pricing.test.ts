import { describe, expect, it } from 'vitest';

import {
  applyHetznerMarkup,
  backupSurcharge,
  getPlanBySku,
  getPlansForRegion,
  HETZNER_PRICE_MULTIPLIER,
  STARTING_MONTHLY_PRICE,
} from '@/lib/hetzner-pricing';

describe('hetzner pricing map', () => {
  it('uses a fixed 2x markup rounded up to the nearest dollar', () => {
    expect(HETZNER_PRICE_MULTIPLIER).toBe(2);
    expect(applyHetznerMarkup(5.99)).toBe(12);
    expect(applyHetznerMarkup(10.49)).toBe(21);
    expect(applyHetznerMarkup(59.99)).toBe(120);
    expect(applyHetznerMarkup(4.49)).toBe(9);
    expect(applyHetznerMarkup(27.99)).toBe(56);
  });

  it('returns all five mapped tiers for EU and US regions', () => {
    const eu = getPlansForRegion('hel1');
    const us = getPlansForRegion('hil');

    expect(eu.map((plan) => plan.sku)).toEqual(['cpx22', 'cpx32', 'cpx42', 'cpx52', 'cpx62']);
    expect(us.map((plan) => plan.sku)).toEqual(['cpx11', 'cpx21', 'cpx31', 'cpx41', 'cpx51']);
    expect(STARTING_MONTHLY_PRICE).toBe(9);
  });

  it('resolves plan metadata by sku from the shared map', () => {
    expect(getPlanBySku('cpx22')).toMatchObject({ label: 'Starter', vcpu: 2, memory: 4, disk: 80, priceMonthly: 12 });
    expect(getPlanBySku('cpx31')).toMatchObject({ label: 'Pro', vcpu: 4, memory: 8, disk: 160, priceMonthly: 32 });
    expect(getPlanBySku('cpx51')).toMatchObject({ label: 'Ultra', vcpu: 16, memory: 32, disk: 360, priceMonthly: 120 });
  });

  it('computes backup surcharge as 20% of the customer-facing base price', () => {
    expect(backupSurcharge(21)).toBe(5);
    expect(backupSurcharge(39)).toBe(8);
    expect(backupSurcharge(120)).toBe(24);
  });
});
