// Cost ledger: deterministic record of "what we paid Hetzner per host
// per time window." Hourly granularity, written by the cost-tick worker.
//
// Reconciliation: nightly job pulls Hetzner billing API, sums ledger
// entries for the same period, flags drift > €5 (any drift smaller is
// rounding noise across timezones / billing-day boundaries).

import { computeNodeCostMicroEur } from './pricing.js';
import type { Sku } from './skuCatalog.js';

export type CostBucket = {
  hostId: string;
  sku: string;
  tsFrom: Date;
  tsTo: Date;
  microEur: number;
};

// Compute a single cost ledger entry. Returned in float micro-eur; round
// to integer at the DB write boundary (BigInt column).
export function computeHostCostEntry(opts: {
  hostId: string;
  sku: Sku;
  tsFrom: Date;
  tsTo: Date;
}): CostBucket {
  const seconds = (opts.tsTo.getTime() - opts.tsFrom.getTime()) / 1000;
  if (seconds < 0) {
    throw new Error(`cost entry has negative/backward duration: ${seconds}s`);
  }
  return {
    hostId: opts.hostId,
    sku: opts.sku.id,
    tsFrom: opts.tsFrom,
    tsTo: opts.tsTo,
    microEur: computeNodeCostMicroEur({ sku: opts.sku, online_seconds: seconds }),
  };
}
