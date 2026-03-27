import { describe, expect, it } from 'vitest';

import {
  applyMarkup,
  backupSurcharge,
  resolvePlanForDisplay,
  plansForRegion,
  PRICE_MULTIPLIER,
  STARTING_MONTHLY_PRICE,
  planIdFromProviderSku,
  resolveProviderSku,
  planTierIndex,
} from '@/lib/plan-catalog';

describe('plan catalog pricing', () => {
  it('uses a fixed 2x markup rounded up to the nearest dollar', () => {
    expect(PRICE_MULTIPLIER).toBe(2);
    expect(applyMarkup(5.99)).toBe(12);
    expect(applyMarkup(10.49)).toBe(21);
    expect(applyMarkup(59.99)).toBe(120);
    expect(applyMarkup(4.49)).toBe(9);
    expect(applyMarkup(27.99)).toBe(56);
  });

  it('returns all five plans for EU and US by plan ID', () => {
    const eu = plansForRegion('hel1');
    const us = plansForRegion('hil');

    expect(eu.map((plan) => plan.id)).toEqual(['starter', 'basic', 'pro', 'power', 'ultra']);
    expect(us.map((plan) => plan.id)).toEqual(['starter', 'basic', 'pro', 'power', 'ultra']);
    expect(STARTING_MONTHLY_PRICE).toBe(9);
  });

  it('resolves plan metadata by plan ID', () => {
    expect(resolvePlanForDisplay('starter', 'eu')).toMatchObject({ label: 'Starter', vcpu: 2, memory: 4, disk: 80, priceMonthly: 12 });
    expect(resolvePlanForDisplay('pro', 'us')).toMatchObject({ label: 'Pro', vcpu: 4, memory: 8, disk: 160, priceMonthly: 32 });
    expect(resolvePlanForDisplay('ultra', 'us')).toMatchObject({ label: 'Ultra', vcpu: 16, memory: 32, disk: 360, priceMonthly: 120 });
  });

  it('resolves plan metadata by legacy provider SKU (backward compat)', () => {
    expect(resolvePlanForDisplay('cpx22')).toMatchObject({ label: 'Starter', vcpu: 2, memory: 4, disk: 80, priceMonthly: 12 });
    expect(resolvePlanForDisplay('cpx31')).toMatchObject({ label: 'Pro', vcpu: 4, memory: 8, disk: 160, priceMonthly: 32 });
    expect(resolvePlanForDisplay('cpx51')).toMatchObject({ label: 'Ultra', vcpu: 16, memory: 32, disk: 360, priceMonthly: 120 });
  });

  it('computes backup surcharge as 20% of the customer-facing base price', () => {
    expect(backupSurcharge(21)).toBe(5);
    expect(backupSurcharge(39)).toBe(8);
    expect(backupSurcharge(120)).toBe(24);
  });

  it('maps plan IDs to provider SKUs per region', () => {
    expect(resolveProviderSku('starter', 'hel1')).toBe('cpx22');
    expect(resolveProviderSku('starter', 'hil')).toBe('cpx11');
    expect(resolveProviderSku('pro', 'hel1')).toBe('cpx42');
    expect(resolveProviderSku('ultra', 'hil')).toBe('cpx51');
  });

  it('reverse-maps provider SKUs to plan IDs', () => {
    expect(planIdFromProviderSku('cpx22')).toBe('starter');
    expect(planIdFromProviderSku('cpx42')).toBe('pro');
    expect(planIdFromProviderSku('cpx51')).toBe('ultra');
    expect(planIdFromProviderSku('unknown')).toBeNull();
  });

  it('returns tier index for plan IDs and legacy SKUs', () => {
    expect(planTierIndex('starter')).toBe(0);
    expect(planTierIndex('pro')).toBe(2);
    expect(planTierIndex('ultra')).toBe(4);
    // Legacy SKU backward compat
    expect(planTierIndex('cpx22')).toBe(0);
    expect(planTierIndex('cpx42')).toBe(2);
    expect(planTierIndex('unknown')).toBe(-1);
  });
});
