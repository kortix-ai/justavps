/**
 * V2 Resource-Based Pricing
 *
 * No preset plans. Users choose vCPU, RAM, and disk freely.
 * Pricing is per-resource with monthly rates.
 *
 * Recommendations are UI-only shortcuts — the backend only
 * sees raw resource numbers and computes price from rates.
 */

// ─── Per-resource monthly rates ─────────────────────────────────────────────

export const RESOURCE_RATES = {
  vcpu_monthly: 3.00,       // $/vCPU/month
  ram_gb_monthly: 1.50,     // $/GB RAM/month
  disk_gb_monthly: 0.05,    // $/GB SSD/month
} as const;

export function computeMonthlyPrice(vcpu: number, ramGb: number, diskGb: number): number {
  return Math.ceil(
    vcpu * RESOURCE_RATES.vcpu_monthly +
    ramGb * RESOURCE_RATES.ram_gb_monthly +
    diskGb * RESOURCE_RATES.disk_gb_monthly
  );
}

/**
 * Full price breakdown for a given resource configuration.
 * Returns per-interval rates useful for live UI display.
 *
 * We use a 30-day month → 720 hours → 43,200 minutes → 2,592,000 seconds.
 */
export function computePriceBreakdown(vcpu: number, ramGb: number, diskGb: number) {
  const rawMonthly =
    vcpu * RESOURCE_RATES.vcpu_monthly +
    ramGb * RESOURCE_RATES.ram_gb_monthly +
    diskGb * RESOURCE_RATES.disk_gb_monthly;
  const monthly = Math.ceil(rawMonthly);
  const hoursPerMonth = 30 * 24;
  const minutesPerMonth = hoursPerMonth * 60;
  const secondsPerMonth = minutesPerMonth * 60;
  return {
    monthly,
    hourly: rawMonthly / hoursPerMonth,
    per_minute: rawMonthly / minutesPerMonth,
    per_second: rawMonthly / secondsPerMonth,
    breakdown: {
      vcpu: vcpu * RESOURCE_RATES.vcpu_monthly,
      ram: ramGb * RESOURCE_RATES.ram_gb_monthly,
      disk: diskGb * RESOURCE_RATES.disk_gb_monthly,
    },
  };
}

// ─── UI-only recommendations ────────────────────────────────────────────────
// These are NOT backend entities. They only pre-fill the frontend sliders.

export interface Recommendation {
  label: string;
  tagline: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  popular?: boolean;
}

export const RECOMMENDATIONS: Recommendation[] = [
  { label: 'Starter',  tagline: 'Small agents and utility boxes',       vcpu: 2,  ram_gb: 4,   disk_gb: 80  },
  { label: 'Basic',    tagline: 'Daily dev work with some headroom',    vcpu: 4,  ram_gb: 8,   disk_gb: 160, popular: true },
  { label: 'Pro',      tagline: 'Always-on workloads and heavy agents', vcpu: 8,  ram_gb: 16,  disk_gb: 320 },
];

// ─── Resource limits ────────────────────────────────────────────────────────

export const RESOURCE_LIMITS = {
  vcpu:    { min: 1, max: 32, step: 1 },
  ram_gb:  { min: 1, max: 64, step: 1 },
  disk_gb: { min: 10, max: 500, step: 10 },
} as const;
