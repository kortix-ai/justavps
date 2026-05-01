// Cost-tick worker. Hourly: for each host that's been online during the
// closed past hour, write a CostLedgerEntry for that hour. Per-host
// bucketing means we can reconcile fine-grained against Hetzner's invoice.

import type { Sku } from '../economics/skuCatalog.js';
import { computeNodeCostMicroEur } from '../economics/pricing.js';

export type CostBucketWrite = {
  hostId: string;
  sku: string;
  tsFrom: Date;
  tsTo: Date;
  microEur: number;
};

// Floor a Date to the start of its UTC hour.
function floorHour(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

// Returns the list of cost buckets to write for a host. Buckets cover
// every closed UTC hour from `lastBookedAt` (exclusive) to `now` (latest
// closed hour), bounded by `joinedAt` (start) and `terminatedAt` (end if
// set). Idempotent if called repeatedly with the same lastBookedAt — the
// caller persists the latest tsTo as the new lastBookedAt to avoid dupes.
export function computeBucketsForHost(opts: {
  hostId: string;
  sku: Sku;
  joinedAt: Date;
  terminatedAt: Date | null;
  lastBookedAt: Date;
  now: Date;
}): CostBucketWrite[] {
  const startMs = Math.max(opts.joinedAt.getTime(), opts.lastBookedAt.getTime());
  const endMs = Math.min(
    opts.now.getTime(),
    opts.terminatedAt ? opts.terminatedAt.getTime() : Number.POSITIVE_INFINITY,
  );

  const buckets: CostBucketWrite[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const hourStart = floorHour(new Date(cursor));
    const nextHour = new Date(hourStart.getTime() + 3600 * 1000);
    const bucketEnd = Math.min(nextHour.getTime(), endMs);

    // Only emit closed hours (end < now and end ≤ terminatedAt) UNLESS
    // it's the final partial bucket after terminatedAt.
    if (bucketEnd >= cursor) {
      // Don't emit a bucket whose end is in the future (still open).
      if (opts.terminatedAt) {
        // Terminated: emit including the partial last bucket.
      } else {
        // Not terminated: only emit bucketEnd ≤ floor(now to hour) so we
        // never bill "the current hour" while it's still in flight.
        const closedHourEnd = floorHour(opts.now).getTime();
        if (bucketEnd > closedHourEnd) break;
      }

      const tsFrom = new Date(Math.max(cursor, opts.joinedAt.getTime()));
      const tsTo = new Date(bucketEnd);
      const seconds = (tsTo.getTime() - tsFrom.getTime()) / 1000;
      if (seconds > 0) {
        buckets.push({
          hostId: opts.hostId,
          sku: opts.sku.id,
          tsFrom,
          tsTo,
          microEur: computeNodeCostMicroEur({ sku: opts.sku, online_seconds: seconds }),
        });
      }
    }
    cursor = bucketEnd;
  }
  return buckets;
}
