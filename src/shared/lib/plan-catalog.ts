/**
 * JustAVPS Plan Catalog — single source of truth for all compute plans.
 *
 * This file defines OUR product identifiers, specs, pricing, and the
 * internal mapping to cloud-provider SKUs. Nothing provider-specific
 * leaks past this module.
 *
 * ┌────────────┬──────────────────────────────────────────────────────┐
 * │  Public    │  plan id  ("starter", "basic", …)                   │
 * │  Layer     │  specs, price, traffic — all our own naming         │
 * ├────────────┼──────────────────────────────────────────────────────┤
 * │  Internal  │  _providerSku — only used by the provider adapter   │
 * │  Layer     │  never exposed in API responses or frontend          │
 * └────────────┴──────────────────────────────────────────────────────┘
 *
 * Future: this can be moved to a DB table for dynamic plan management.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

type Market = 'eu' | 'us';

type PlanId = 'starter' | 'basic' | 'pro' | 'power' | 'ultra';

interface PlanVariant {
  vcpu: number;
  memory: number;       // GB
  disk: number;         // GB SSD
  traffic: string;      // human-readable
  providerCostMonthly: number;  // what we pay the provider
  /** Internal cloud-provider SKU — NEVER exposed in API / frontend */
  _providerSku: string;
}

interface Plan {
  id: PlanId;
  label: string;
  tagline: string;
  variants: Record<Market, PlanVariant>;
}

// ─── Markup ─────────────────────────────────────────────────────────────────

/** We sell at 2× provider cost, rounded up to the nearest dollar. */
export const PRICE_MULTIPLIER = 2;

export function applyMarkup(providerCost: number): number {
  return Math.ceil(providerCost * PRICE_MULTIPLIER);
}

// ─── Backup surcharge ───────────────────────────────────────────────────────

/** Daily automatic backups add 20 % on top of the customer-facing price. */
export const BACKUP_SURCHARGE_PERCENT = 20;

export function backupSurcharge(priceMonthly: number): number {
  return Math.ceil(priceMonthly * (BACKUP_SURCHARGE_PERCENT / 100));
}

// ─── Region → Market mapping ────────────────────────────────────────────────

const REGION_MARKET: Record<string, Market> = {
  hel1: 'eu',
  fsn1: 'eu',
  nbg1: 'eu',
  hil:  'us',
  ash:  'us',
};

export function marketForRegion(region: string): Market | null {
  return REGION_MARKET[region] ?? null;
}

// ─── The Catalog ────────────────────────────────────────────────────────────

const PLANS: Plan[] = [
  {
    id: 'starter',
    label: 'Starter',
    tagline: 'Small agents and utility boxes',
    variants: {
      eu: { vcpu: 2,  memory: 4,  disk: 80,  traffic: '20 TB', providerCostMonthly: 5.99,  _providerSku: 'cpx22' },
      us: { vcpu: 2,  memory: 2,  disk: 40,  traffic: '1 TB',  providerCostMonthly: 4.49,  _providerSku: 'cpx11' },
    },
  },
  {
    id: 'basic',
    label: 'Basic',
    tagline: 'A little more headroom for daily work',
    variants: {
      eu: { vcpu: 4,  memory: 8,  disk: 160, traffic: '20 TB', providerCostMonthly: 10.49, _providerSku: 'cpx32' },
      us: { vcpu: 3,  memory: 4,  disk: 80,  traffic: '2 TB',  providerCostMonthly: 8.99,  _providerSku: 'cpx21' },
    },
  },
  {
    id: 'pro',
    label: 'Pro',
    tagline: 'The default for most always-on workloads',
    variants: {
      eu: { vcpu: 8,  memory: 16, disk: 320, traffic: '20 TB', providerCostMonthly: 19.49, _providerSku: 'cpx42' },
      us: { vcpu: 4,  memory: 8,  disk: 160, traffic: '3 TB',  providerCostMonthly: 15.99, _providerSku: 'cpx31' },
    },
  },
  {
    id: 'power',
    label: 'Power',
    tagline: 'Heavy parallel agents and bigger services',
    variants: {
      eu: { vcpu: 12, memory: 24, disk: 480, traffic: '20 TB', providerCostMonthly: 27.99, _providerSku: 'cpx52' },
      us: { vcpu: 8,  memory: 16, disk: 240, traffic: '4 TB',  providerCostMonthly: 29.99, _providerSku: 'cpx41' },
    },
  },
  {
    id: 'ultra',
    label: 'Ultra',
    tagline: 'Largest shared tier in each market',
    variants: {
      eu: { vcpu: 16, memory: 32, disk: 640, traffic: '20 TB', providerCostMonthly: 38.49, _providerSku: 'cpx62' },
      us: { vcpu: 16, memory: 32, disk: 360, traffic: '5 TB',  providerCostMonthly: 59.99, _providerSku: 'cpx51' },
    },
  },
];

// ─── Lookup helpers ─────────────────────────────────────────────────────────

/** All plan IDs in tier order. */
const PLAN_IDS: PlanId[] = PLANS.map((p) => p.id);

/** Get a plan by its public ID. */
function getPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Get the tier index (0-based) for a plan ID or legacy provider SKU. Returns -1 if unknown. */
export function planTierIndex(planIdOrSku: string): number {
  // Try plan ID first
  const byId = PLANS.findIndex((p) => p.id === planIdOrSku);
  if (byId !== -1) return byId;
  // Fallback: search by internal provider SKU (backward compat for DB records)
  return PLANS.findIndex((p) =>
    p.variants.eu._providerSku === planIdOrSku ||
    p.variants.us._providerSku === planIdOrSku,
  );
}

/**
 * Resolve a plan ID or legacy provider SKU to the internal provider SKU
 * for a given region. Used by the provider adapter when talking to the cloud API.
 *
 * Returns null if the input is unrecognised.
 */
export function resolveProviderSku(planIdOrSku: string, region: string): string | null {
  const market = marketForRegion(region);
  if (!market) return null;

  // Direct plan ID → SKU
  const plan = getPlan(planIdOrSku);
  if (plan) return plan.variants[market]._providerSku;

  // Already a provider SKU? Validate it exists in our catalog.
  for (const p of PLANS) {
    if (p.variants.eu._providerSku === planIdOrSku || p.variants.us._providerSku === planIdOrSku) {
      return planIdOrSku;
    }
  }

  return null;
}

/**
 * Reverse-map a provider SKU to our plan ID.
 * Used when reading legacy DB records that stored raw SKUs.
 */
export function planIdFromProviderSku(sku: string): PlanId | null {
  for (const p of PLANS) {
    if (p.variants.eu._providerSku === sku || p.variants.us._providerSku === sku) {
      return p.id;
    }
  }
  return null;
}

/**
 * Get the enriched plan data for a specific region.
 * Returns specs + public pricing for each plan available in that region.
 */
export function plansForRegion(region: string) {
  const market = marketForRegion(region);
  if (!market) return [];

  return PLANS.map((plan) => {
    const v = plan.variants[market];
    const priceMonthly = applyMarkup(v.providerCostMonthly);
    return {
      id: plan.id,
      label: plan.label,
      tagline: plan.tagline,
      vcpu: v.vcpu,
      memory: v.memory,
      disk: v.disk,
      traffic: v.traffic,
      providerCostMonthly: v.providerCostMonthly,
      priceMonthly,
      markupMonthly: Math.round((priceMonthly - v.providerCostMonthly) * 100) / 100,
    };
  });
}

/**
 * Resolve a plan ID or legacy SKU to full plan metadata.
 * Works with both new plan IDs ("pro") and old DB values ("cpx42").
 */
function resolvePlan(planIdOrSku: string) {
  // Try by plan ID first
  const direct = getPlan(planIdOrSku);
  if (direct) return direct;

  // Try by provider SKU (backward compat)
  const id = planIdFromProviderSku(planIdOrSku);
  if (id) return getPlan(id)!;

  return null;
}

/**
 * Resolve a plan ID or legacy SKU to full plan data for a specific market.
 * Returns the same shape as getPlanBySku() for backward compatibility.
 */
export function resolvePlanForDisplay(planIdOrSku: string, market?: Market) {
  const plan = resolvePlan(planIdOrSku);
  if (!plan) return null;

  // If no market specified, try to detect from SKU, default to EU
  if (!market) {
    if (plan.variants.us._providerSku === planIdOrSku) {
      market = 'us';
    } else {
      market = 'eu';
    }
  }

  const v = plan.variants[market];
  const priceMonthly = applyMarkup(v.providerCostMonthly);

  return {
    id: plan.id,
    key: plan.id,
    label: plan.label,
    tagline: plan.tagline,
    market,
    vcpu: v.vcpu,
    memory: v.memory,
    disk: v.disk,
    traffic: v.traffic,
    providerCostMonthly: v.providerCostMonthly,
    priceMonthly,
    markupMonthly: Math.round((priceMonthly - v.providerCostMonthly) * 100) / 100,
  };
}

// ─── Competitor comparison snapshot (used on marketing pages) ────────────────

function estimateCompetitorMonthly(vcpu: number, memory: number): number {
  return Math.round((vcpu * 0.0504 + memory * 0.0162) * 730);
}

export const PLAN_PRICE_SNAPSHOT = PLANS.map((plan) => {
  const eu = plan.variants.eu;
  const us = plan.variants.us;
  const euPublicPrice = applyMarkup(eu.providerCostMonthly);
  const usPublicPrice = applyMarkup(us.providerCostMonthly);
  const euCompetitorMonthly = estimateCompetitorMonthly(eu.vcpu, eu.memory);
  const usCompetitorMonthly = estimateCompetitorMonthly(us.vcpu, us.memory);
  const competitorMonthly = euCompetitorMonthly;
  const savingsX = Math.max(1, Math.round(competitorMonthly / euPublicPrice));

  return {
    id: plan.id,
    key: plan.id,
    label: plan.label,
    tagline: plan.tagline,
    eu,
    us,
    euPublicPrice,
    usPublicPrice,
    euCompetitorMonthly,
    usCompetitorMonthly,
    competitorMonthly,
    savingsX,
    savingsLabel: `${savingsX}x cheaper`,
  };
});

export const STARTING_MONTHLY_PRICE = Math.min(
  ...PLAN_PRICE_SNAPSHOT.map((p) => Math.min(p.euPublicPrice, p.usPublicPrice)),
);
