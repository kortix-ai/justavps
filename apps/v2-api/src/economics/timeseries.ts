// Timeseries bucketing for the dashboard charts.
//   bucketDaily  — sums LedgerRow.microEur into UTC-day buckets
//   bucketHourly — same but UTC-hour
//   fillSamplesToFillSeries — converts NodeUtilizationSample rows + cluster
//                             capacity into per-timestamp fill % series.

export type LedgerRow = { ts: Date; microEur: bigint };
export type LedgerBucket = { tsFrom: Date; microEur: bigint };

function floorDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function floorHour(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

function bucket(rows: LedgerRow[], from: Date, to: Date, stepMs: number, floor: (d: Date) => Date): LedgerBucket[] {
  const buckets = new Map<number, bigint>();
  // Pre-fill buckets covering [from, to) so empty buckets show as 0.
  let cursor = floor(from).getTime();
  const end = floor(to).getTime();
  while (cursor < end) {
    buckets.set(cursor, 0n);
    cursor += stepMs;
  }
  for (const r of rows) {
    if (r.ts.getTime() < from.getTime() || r.ts.getTime() >= to.getTime()) continue;
    const key = floor(r.ts).getTime();
    if (!buckets.has(key)) continue; // out of pre-filled range
    buckets.set(key, (buckets.get(key) ?? 0n) + r.microEur);
  }
  return Array.from(buckets, ([k, microEur]) => ({ tsFrom: new Date(k), microEur }))
    .sort((a, b) => a.tsFrom.getTime() - b.tsFrom.getTime());
}

export function bucketDaily(rows: LedgerRow[], from: Date, to: Date): LedgerBucket[] {
  return bucket(rows, from, to, 24 * 3600 * 1000, floorDay);
}

export function bucketHourly(rows: LedgerRow[], from: Date, to: Date): LedgerBucket[] {
  return bucket(rows, from, to, 3600 * 1000, floorHour);
}

export type SamplePoint = {
  ts: Date;
  hostId: string;
  vcpuUsed: number;
  ramGbUsed: number;
  storageGbUsed: number;
};

export type FillPoint = {
  ts: Date;
  vcpuPct: number;
  ramPct: number;
  storagePct: number;
};

// Sum samples at each timestamp across all hosts in the cluster, then
// divide by cluster-wide capacity. Returns a per-ts series sorted asc.
export function fillSamplesToFillSeries(
  samples: SamplePoint[],
  totalCapacity: { vcpus: number; ramGb: number; storageGb: number },
): FillPoint[] {
  const byTs = new Map<number, { vcpu: number; ram: number; storage: number }>();
  for (const s of samples) {
    const key = s.ts.getTime();
    const cur = byTs.get(key) ?? { vcpu: 0, ram: 0, storage: 0 };
    cur.vcpu += s.vcpuUsed;
    cur.ram += s.ramGbUsed;
    cur.storage += s.storageGbUsed;
    byTs.set(key, cur);
  }
  return Array.from(byTs, ([ms, used]) => ({
    ts: new Date(ms),
    vcpuPct: totalCapacity.vcpus > 0 ? (used.vcpu / totalCapacity.vcpus) * 100 : 0,
    ramPct: totalCapacity.ramGb > 0 ? (used.ram / totalCapacity.ramGb) * 100 : 0,
    storagePct: totalCapacity.storageGb > 0 ? (used.storage / totalCapacity.storageGb) * 100 : 0,
  })).sort((a, b) => a.ts.getTime() - b.ts.getTime());
}
