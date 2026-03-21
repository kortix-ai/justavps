export const HETZNER_PRICE_MULTIPLIER = 2;

/** Hetzner charges 20% of the server price for daily automatic backups */
export const BACKUP_SURCHARGE_PERCENT = 20;

/**
 * Compute the backup surcharge for a given monthly price.
 * Returns the dollar amount to ADD to the base price (not the total).
 */
export function backupSurcharge(priceMonthly: number): number {
  return Math.ceil(priceMonthly * (BACKUP_SURCHARGE_PERCENT / 100));
}

export type HetznerMarket = 'eu' | 'us';

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
  regions: Record<HetznerMarket, HetznerPlanMachine>;
}

export const HETZNER_REGION_MARKET: Record<string, HetznerMarket> = {
  hel1: 'eu',
  fsn1: 'eu',
  nbg1: 'eu',
  hil: 'us',
  ash: 'us',
};

export const HETZNER_PLAN_TIERS: HetznerPlanTier[] = [
  {
    key: 'starter',
    label: 'Starter',
    tagline: 'Small agents and utility boxes',
    regions: {
      eu: { sku: 'cpx22', vcpu: 2, memory: 4, disk: 80, traffic: '20 TB', providerPriceMonthly: 5.99 },
      us: { sku: 'cpx11', vcpu: 2, memory: 2, disk: 40, traffic: '1 TB', providerPriceMonthly: 4.49 },
    },
  },
  {
    key: 'basic',
    label: 'Basic',
    tagline: 'A little more headroom for daily work',
    regions: {
      eu: { sku: 'cpx32', vcpu: 4, memory: 8, disk: 160, traffic: '20 TB', providerPriceMonthly: 10.49 },
      us: { sku: 'cpx21', vcpu: 3, memory: 4, disk: 80, traffic: '2 TB', providerPriceMonthly: 8.99 },
    },
  },
  {
    key: 'pro',
    label: 'Pro',
    tagline: 'The default for most always-on workloads',
    regions: {
      eu: { sku: 'cpx42', vcpu: 8, memory: 16, disk: 320, traffic: '20 TB', providerPriceMonthly: 19.49 },
      us: { sku: 'cpx31', vcpu: 4, memory: 8, disk: 160, traffic: '3 TB', providerPriceMonthly: 15.99 },
    },
  },
  {
    key: 'power',
    label: 'Power',
    tagline: 'Heavy parallel agents and bigger services',
    regions: {
      eu: { sku: 'cpx52', vcpu: 12, memory: 24, disk: 480, traffic: '20 TB', providerPriceMonthly: 27.99 },
      us: { sku: 'cpx41', vcpu: 8, memory: 16, disk: 240, traffic: '4 TB', providerPriceMonthly: 29.99 },
    },
  },
  {
    key: 'ultra',
    label: 'Ultra',
    tagline: 'Largest shared tier in each market',
    regions: {
      eu: { sku: 'cpx62', vcpu: 16, memory: 32, disk: 640, traffic: '20 TB', providerPriceMonthly: 38.49 },
      us: { sku: 'cpx51', vcpu: 16, memory: 32, disk: 360, traffic: '5 TB', providerPriceMonthly: 59.99 },
    },
  },
];

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function getMarketForRegion(region: string): HetznerMarket | null {
  return HETZNER_REGION_MARKET[region] ?? null;
}

export function applyHetznerMarkup(providerPriceMonthly: number): number {
  return Math.ceil(providerPriceMonthly * HETZNER_PRICE_MULTIPLIER);
}

export function getPlansForMarket(market: HetznerMarket) {
  return HETZNER_PLAN_TIERS.map((tier) => {
    const machine = tier.regions[market];
    const priceMonthly = applyHetznerMarkup(machine.providerPriceMonthly);

    return {
      key: tier.key,
      label: tier.label,
      tagline: tier.tagline,
      ...machine,
      priceMonthly,
      markupMonthly: roundMoney(priceMonthly - machine.providerPriceMonthly),
    };
  });
}

export function getPlansForRegion(region: string) {
  const market = getMarketForRegion(region);
  if (!market) return [];
  return getPlansForMarket(market);
}

export function getPlanBySku(serverType: string) {
  for (const tier of HETZNER_PLAN_TIERS) {
    for (const market of ['eu', 'us'] as const) {
      const machine = tier.regions[market];
      if (machine.sku !== serverType) continue;

      const priceMonthly = applyHetznerMarkup(machine.providerPriceMonthly);
      return {
        key: tier.key,
        label: tier.label,
        tagline: tier.tagline,
        market,
        ...machine,
        priceMonthly,
        markupMonthly: roundMoney(priceMonthly - machine.providerPriceMonthly),
      };
    }
  }

  return null;
}

function estimateCompetitorMonthly(vcpu: number, memory: number): number {
  return Math.round((vcpu * 0.0504 + memory * 0.0162) * 730);
}

export const PLAN_PRICE_SNAPSHOT = HETZNER_PLAN_TIERS.map((tier) => {
  const eu = tier.regions.eu;
  const us = tier.regions.us;
  const euPublicPrice = applyHetznerMarkup(eu.providerPriceMonthly);
  const usPublicPrice = applyHetznerMarkup(us.providerPriceMonthly);
  const euCompetitorMonthly = estimateCompetitorMonthly(eu.vcpu, eu.memory);
  const usCompetitorMonthly = estimateCompetitorMonthly(us.vcpu, us.memory);

  // Use the EU tier for the comparison table — bigger specs, cleaner story
  const competitorMonthly = euCompetitorMonthly;
  const savingsX = Math.max(1, Math.round(competitorMonthly / euPublicPrice));

  return {
    key: tier.key,
    label: tier.label,
    tagline: tier.tagline,
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

export const STARTING_MONTHLY_PRICE = Math.min(...PLAN_PRICE_SNAPSHOT.map((plan) => Math.min(plan.euPublicPrice, plan.usPublicPrice)));
