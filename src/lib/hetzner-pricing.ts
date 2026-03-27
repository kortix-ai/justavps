/**
 * @deprecated — Use '@/lib/plan-catalog' instead.
 *
 * Thin compatibility shim: re-exports plan-catalog symbols under the
 * old Hetzner-branded names so existing imports keep working while we
 * migrate callers one by one.
 */

import { PLANS, plansForRegion as _plansForRegion } from './plan-catalog';
import type { Market } from './plan-catalog';

export {
  PRICE_MULTIPLIER as HETZNER_PRICE_MULTIPLIER,
  BACKUP_SURCHARGE_PERCENT,
  backupSurcharge,
  applyMarkup as applyHetznerMarkup,
  REGION_MARKET as HETZNER_REGION_MARKET,
  marketForRegion as getMarketForRegion,
  plansForRegion as getPlansForRegion,
  resolvePlanForDisplay as getPlanBySku,
  PLAN_PRICE_SNAPSHOT,
  STARTING_MONTHLY_PRICE,
} from './plan-catalog';

export type HetznerMarket = Market;

// Legacy: expose PLAN_TIERS mapped to the old shape so the few remaining
// callers (providers/hetzner.ts, getPlanTierIndex) can be migrated next.

export interface HetznerPlanMachine {
  sku: string;
  vcpu: number;
  memory: number;
  disk: number;
  traffic: string;
  providerPriceMonthly: number;
}

export interface HetznerPlanTier {
  key: 'starter' | 'basic' | 'pro' | 'power' | 'ultra';
  label: string;
  tagline: string;
  regions: Record<Market, HetznerPlanMachine>;
}

export const HETZNER_PLAN_TIERS: HetznerPlanTier[] = PLANS.map((p) => ({
  key: p.id,
  label: p.label,
  tagline: p.tagline,
  regions: {
    eu: {
      sku: p.variants.eu._providerSku,
      vcpu: p.variants.eu.vcpu,
      memory: p.variants.eu.memory,
      disk: p.variants.eu.disk,
      traffic: p.variants.eu.traffic,
      providerPriceMonthly: p.variants.eu.providerCostMonthly,
    },
    us: {
      sku: p.variants.us._providerSku,
      vcpu: p.variants.us.vcpu,
      memory: p.variants.us.memory,
      disk: p.variants.us.disk,
      traffic: p.variants.us.traffic,
      providerPriceMonthly: p.variants.us.providerCostMonthly,
    },
  },
}));

export function getPlansForMarket(market: Market) {
  const region = market === 'eu' ? 'hel1' : 'hil';
  return _plansForRegion(region);
}
