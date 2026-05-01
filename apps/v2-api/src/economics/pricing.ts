// Per-second pricing model (revenue side) and per-second cost model
// (Hetzner side). All math is in **micro-euros**. Compute functions
// return floats; round only at persistence boundary (ledger writes,
// invoice generation) to avoid double-rounding bias when summing
// many small values.
//
// The unit is µEUR/sec (micro-eur per second). 1 €/hr = 277.8 µEUR/sec.
// 1 €/mo (730 hr) = 0.380 µEUR/sec.
//
// Pricing tiers (today's defaults at 4× cost markup):
//   Hot resources (only billed while sandbox is running):
//     vCPU·s         — 4.4 µEUR (≈ €0.016/vCPU·hr, ≈ €11.6/vCPU·mo)
//     GB-RAM·s       — 1.3 µEUR (≈ €0.0048/GB·hr,  ≈ €3.4/GB·mo)
//   Storage (billed continuously, running OR stopped):
//     GB-stor local  — 0.17 µEUR (≈ €0.0006/GB·hr, ≈ €0.45/GB·mo)
//     GB-stor archive — 0.05 µEUR (≈ €0.00018/GB·hr ≈ €0.13/GB·mo)
//
// Cost basis (what we pay Hetzner):
//   EX44 €42.30/mo / 20 vCPU = €0.0029/vCPU·hr → ~0.81 µEUR/vCPU·s
//   EX44 €42.30/mo / 64 GB-RAM = €0.0009/GB·hr → ~0.25 µEUR/GB·s
//   EX44 €42.30/mo / 500 GB-stor = €0.000116/GB·hr → ~0.032 µEUR/GB·s
//
// 4× markup gives 75% gross margin and prices ~30-50% below AWS Fargate.

import type { Sku } from './skuCatalog.js';

export type Pricing = {
  vcpu_hot_micro_eur_per_sec: number;
  ram_gb_hot_micro_eur_per_sec: number;
  storage_gb_local_micro_eur_per_sec: number;
  storage_gb_archive_micro_eur_per_sec: number;
  // Optional always-on / committed-use discount (whole percent).
  // Applied only to hot resources — storage is already cheap.
  reservation_discount_pct?: number;
};

export const DEFAULT_PRICING: Pricing = {
  vcpu_hot_micro_eur_per_sec: 4.4,
  ram_gb_hot_micro_eur_per_sec: 1.3,
  storage_gb_local_micro_eur_per_sec: 0.17,
  storage_gb_archive_micro_eur_per_sec: 0.05,
};

// Aggregated usage for a billing period. Compute by sampling sandbox
// state transitions (running ↔ stopped ↔ archived) and summing
// resource·seconds across each state.
export type SandboxUsage = {
  vcpu_seconds: number;
  ram_gb_seconds: number;
  storage_gb_seconds_local: number;
  storage_gb_seconds_archive: number;
};

// Returns total revenue in micro-eur. Apply the optional reservation
// discount only to hot resources (vCPU + RAM) since the commitment is
// what makes those resources predictable; storage is already quasi-fixed.
// Caller rounds when persisting (ledger row should be integer micro-eur).
export function computeRevenueMicroEur(usage: SandboxUsage, pricing: Pricing): number {
  const discountFactor = pricing.reservation_discount_pct
    ? (100 - pricing.reservation_discount_pct) / 100
    : 1;
  const hotRevenue = usage.vcpu_seconds * pricing.vcpu_hot_micro_eur_per_sec
    + usage.ram_gb_seconds * pricing.ram_gb_hot_micro_eur_per_sec;
  const storageRevenue = usage.storage_gb_seconds_local * pricing.storage_gb_local_micro_eur_per_sec
    + usage.storage_gb_seconds_archive * pricing.storage_gb_archive_micro_eur_per_sec;
  return hotRevenue * discountFactor + storageRevenue;
}

// Cost we pay Hetzner per node, in micro-eur. Linear in online time:
// the box bills us by the day whether or not it has workloads on it.
// Reference month is 30.4375 days (365.25/12).
export function computeNodeCostMicroEur(opts: { sku: Sku; online_seconds: number }): number {
  const monthlyMicroEur = opts.sku.monthlyEur * 1e6;
  const secondsInReferenceMonth = 30.4375 * 24 * 3600;
  return monthlyMicroEur * (opts.online_seconds / secondsInReferenceMonth);
}

// Quick estimator: given a sandbox shape and time-fraction, how much
// revenue do we expect from one sandbox per month? Useful for capacity
// planning and quoting customers.
export type SandboxShape = {
  vcpus: number;
  ram_gb: number;
  storage_gb: number;
};

export function estimateMonthlyRevenue(
  shape: SandboxShape,
  opts: { active_fraction: number; archived_fraction?: number },
  pricing: Pricing,
): { micro_eur: number; breakdown: { vcpu_micro_eur: number; ram_micro_eur: number; storage_micro_eur: number } } {
  // Revenue-month = 730 hours = 2,628,000 seconds. (Industry convention
  // for cloud billing — a 31-day month would inflate, a 28-day month
  // would deflate. 730 is the average.)
  const secondsInMonth = 730 * 3600;
  const archivedFraction = opts.archived_fraction ?? 0;
  const localStorageFraction = 1 - archivedFraction;

  const discountFactor = pricing.reservation_discount_pct
    ? (100 - pricing.reservation_discount_pct) / 100
    : 1;

  const vcpuRev = shape.vcpus * opts.active_fraction * secondsInMonth * pricing.vcpu_hot_micro_eur_per_sec * discountFactor;
  const ramRev = shape.ram_gb * opts.active_fraction * secondsInMonth * pricing.ram_gb_hot_micro_eur_per_sec * discountFactor;
  const storageRev = shape.storage_gb * secondsInMonth * (
    localStorageFraction * pricing.storage_gb_local_micro_eur_per_sec
    + archivedFraction * pricing.storage_gb_archive_micro_eur_per_sec
  );
  return {
    micro_eur: vcpuRev + ramRev + storageRev,
    breakdown: {
      vcpu_micro_eur: vcpuRev,
      ram_micro_eur: ramRev,
      storage_micro_eur: storageRev,
    },
  };
}

// Quick converter: micro-eur → eur (for human display only — never
// compute on this).
export function microEurToEur(microEur: number): number {
  return microEur / 1e6;
}
