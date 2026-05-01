// Autoscale policy decisions, expressed as pure functions over a sample
// series. The proposer worker calls these every 5 minutes, writes
// scaling_proposals rows for any positive result, and the operator (or
// auto-approve gate below threshold) approves them.
//
// Two signals:
//   • shouldProposeAddNode  — fill ≥ threshold sustained for N minutes
//   • shouldProposeDrainNode — fill ≤ threshold sustained for M minutes
//
// Forecast: linear regression on the binding resource's fill curve gives
// "when do we hit X%?" — operator-facing in the dashboard, also used to
// prioritize proposals (a 90% ETA in 1 hour is more urgent than 90% in
// 5 days).

export type FillSample = {
  ts: Date;
  vcpuPct: number;
  ramPct: number;
  storagePct: number;
};

export type ProposeResult = {
  shouldPropose: boolean;
  binding: 'vcpu' | 'ram' | 'storage' | null;
  reason: string;
};

// Returns true if every sample in the trailing `sustainedMinutes` window
// has at least one resource ≥ thresholdPct AND the same resource was the
// max in every sample. The "binding" is whichever resource crossed the
// threshold consistently.
export function shouldProposeAddNode(
  samples: FillSample[],
  opts: { thresholdPct: number; sustainedMinutes: number },
): ProposeResult {
  if (samples.length === 0) {
    return { shouldPropose: false, binding: null, reason: 'no samples' };
  }
  const sorted = [...samples].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const last = sorted[sorted.length - 1];

  // Need at least sustainedMinutes of history regardless of sample density.
  const totalSpan = last.ts.getTime() - sorted[0].ts.getTime();
  if (totalSpan < opts.sustainedMinutes * 60 * 1000 - 1000) {
    return { shouldPropose: false, binding: null, reason: `not enough history (${Math.round(totalSpan / 60000)}m of ${opts.sustainedMinutes}m required)` };
  }

  const windowStart = last.ts.getTime() - opts.sustainedMinutes * 60 * 1000;
  const inWindow = sorted.filter((s) => s.ts.getTime() >= windowStart);

  // Find the resource that's max in the latest sample — that's the
  // binding. Then verify it's been ≥ threshold across the whole window.
  const candidates: Array<{ key: 'vcpu' | 'ram' | 'storage'; pct: number }> = [
    { key: 'vcpu', pct: last.vcpuPct },
    { key: 'ram', pct: last.ramPct },
    { key: 'storage', pct: last.storagePct },
  ];
  candidates.sort((a, b) => b.pct - a.pct);
  const binding = candidates[0].key;

  for (const s of inWindow) {
    const v = binding === 'vcpu' ? s.vcpuPct : binding === 'ram' ? s.ramPct : s.storagePct;
    if (v < opts.thresholdPct) {
      return { shouldPropose: false, binding, reason: `${binding} dropped to ${v.toFixed(1)}% during window` };
    }
  }

  return {
    shouldPropose: true,
    binding,
    reason: `${binding} fill ≥ ${opts.thresholdPct}% sustained for ${opts.sustainedMinutes}m`,
  };
}

// Symmetric scale-down. Returns true if ALL three resources stayed below
// thresholdPct for the whole window (i.e. we have headroom to consolidate).
export function shouldProposeDrainNode(
  samples: FillSample[],
  opts: { thresholdPct: number; sustainedMinutes: number },
): ProposeResult {
  if (samples.length === 0) {
    return { shouldPropose: false, binding: null, reason: 'no samples' };
  }
  const sorted = [...samples].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const last = sorted[sorted.length - 1];
  const totalSpan = last.ts.getTime() - sorted[0].ts.getTime();
  if (totalSpan < opts.sustainedMinutes * 60 * 1000 - 1000) {
    return { shouldPropose: false, binding: null, reason: 'not enough history' };
  }
  const windowStart = last.ts.getTime() - opts.sustainedMinutes * 60 * 1000;
  const inWindow = sorted.filter((s) => s.ts.getTime() >= windowStart);

  for (const s of inWindow) {
    if (s.vcpuPct >= opts.thresholdPct || s.ramPct >= opts.thresholdPct || s.storagePct >= opts.thresholdPct) {
      return { shouldPropose: false, binding: null, reason: `fill briefly above ${opts.thresholdPct}%` };
    }
  }
  return {
    shouldPropose: true,
    binding: null,
    reason: `all resources below ${opts.thresholdPct}% sustained for ${opts.sustainedMinutes}m`,
  };
}

// Linear regression on the binding-resource fill curve. Returns the
// projected ETA timestamp (ms epoch) at which fill reaches `targetPct`,
// or null if fill is flat/declining or there's not enough data.
export function forecastExhaustion(
  samples: FillSample[],
  opts: { binding: 'vcpu' | 'ram' | 'storage'; targetPct: number },
): { etaMs: number | null; slopePctPerHour: number | null } {
  if (samples.length < 2) return { etaMs: null, slopePctPerHour: null };

  const xs: number[] = [];
  const ys: number[] = [];
  const t0 = samples[0].ts.getTime();
  for (const s of samples) {
    xs.push((s.ts.getTime() - t0) / 3_600_000); // hours from start
    ys.push(opts.binding === 'vcpu' ? s.vcpuPct : opts.binding === 'ram' ? s.ramPct : s.storagePct);
  }

  // OLS slope + intercept.
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return { etaMs: null, slopePctPerHour: null };
  const slope = num / den; // pct per hour
  const intercept = meanY - slope * meanX;

  if (slope <= 0) return { etaMs: null, slopePctPerHour: slope };

  // Solve slope·x + intercept = targetPct → x = (target - intercept) / slope hours from t0.
  const xTarget = (opts.targetPct - intercept) / slope;
  const etaMs = t0 + xTarget * 3_600_000;
  // Cap forecasts at 365 days out — beyond that the linear model is
  // meaningless and Date serialization breaks past ~8.64e15 ms anyway.
  const oneYearMs = 365 * 24 * 3_600_000;
  if (!Number.isFinite(etaMs) || etaMs - Date.now() > oneYearMs) {
    return { etaMs: null, slopePctPerHour: slope };
  }
  return { etaMs, slopePctPerHour: slope };
}
