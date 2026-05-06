import type { PrismaClient } from '@prisma/client';

import { DEFAULT_PRICING } from '../economics/pricing.js';
import type { BillingV2Component, BillingV2RateSet } from './types.js';

export const DEFAULT_BILLING_PRICE_VERSION_CODE = 'default-2026-05-04';
export const DEFAULT_BILLING_PRICE_EFFECTIVE_AT = new Date('2026-05-04T00:00:00.000Z');

export function defaultBillingRates(): BillingV2RateSet {
  return {
    vcpu_hot_micro_eur_per_sec: DEFAULT_PRICING.vcpu_hot_micro_eur_per_sec,
    ram_gb_hot_micro_eur_per_sec: DEFAULT_PRICING.ram_gb_hot_micro_eur_per_sec,
    storage_gb_local_micro_eur_per_sec: DEFAULT_PRICING.storage_gb_local_micro_eur_per_sec,
    storage_gb_archive_micro_eur_per_sec: DEFAULT_PRICING.storage_gb_archive_micro_eur_per_sec,
  };
}

export async function ensureDefaultBillingPriceVersion(prisma: PrismaClient) {
  return prisma.billingPriceVersion.upsert({
    where: { code: DEFAULT_BILLING_PRICE_VERSION_CODE },
    create: {
      code: DEFAULT_BILLING_PRICE_VERSION_CODE,
      currency: 'EUR',
      rates: defaultBillingRates(),
      effectiveAt: DEFAULT_BILLING_PRICE_EFFECTIVE_AT,
      metadata: { source: 'DEFAULT_PRICING', billing_api: 'v2' },
    },
    update: {},
  });
}

export function ratesFromPriceVersion(priceVersion: { rates: unknown }): BillingV2RateSet {
  const rates = priceVersion.rates && typeof priceVersion.rates === 'object'
    ? priceVersion.rates as Partial<Record<keyof BillingV2RateSet, unknown>>
    : {};
  const defaults = defaultBillingRates();
  return {
    vcpu_hot_micro_eur_per_sec: numberOrDefault(rates.vcpu_hot_micro_eur_per_sec, defaults.vcpu_hot_micro_eur_per_sec),
    ram_gb_hot_micro_eur_per_sec: numberOrDefault(rates.ram_gb_hot_micro_eur_per_sec, defaults.ram_gb_hot_micro_eur_per_sec),
    storage_gb_local_micro_eur_per_sec: numberOrDefault(rates.storage_gb_local_micro_eur_per_sec, defaults.storage_gb_local_micro_eur_per_sec),
    storage_gb_archive_micro_eur_per_sec: numberOrDefault(rates.storage_gb_archive_micro_eur_per_sec, defaults.storage_gb_archive_micro_eur_per_sec),
  };
}

export function rateForBillingComponent(component: BillingV2Component, rates: BillingV2RateSet): number {
  if (component === 'running_vcpu' || component === 'warm_pool_running_vcpu') return rates.vcpu_hot_micro_eur_per_sec;
  if (component === 'running_ram' || component === 'warm_pool_running_ram') return rates.ram_gb_hot_micro_eur_per_sec;
  return rates.storage_gb_local_micro_eur_per_sec;
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
