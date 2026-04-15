/* ═══════════════════════════════════════════════════════════════════
 *  Pricing model — pure metered, per-second.
 *
 *  Just A VPS works the same way as Daytona / E2B / Modal sandboxes:
 *  you pay for CPU-seconds, GB-RAM-hours, and GB-disk-hours you use.
 *  No tiers. No caps. The rates are just way lower.
 * ═══════════════════════════════════════════════════════════════════ */

const HOURS_PER_MONTH = 730; // 24 × 365 / 12 ≈ 730

/* ── vendor list rates (USD per resource·hour) ───────────────────────
 *  Sourced from public pricing pages, April 2026:
 *   - Daytona  https://www.daytona.io/pricing  ($0.0504 vCPU·h, $0.0162 GiB·h)
 *   - E2B      https://e2b.dev/pricing         (matches Daytona exactly)
 *   - Modal    https://modal.com/pricing       (Sandbox tier: 3× function rate)
 *   - Fly.io   https://fly.io/pricing          (performance-cpu, +RAM at $5/GB/30d)
 */
export const VENDOR_RATES = {
  daytona: { name: "Daytona", vPerVcpu: 0.0504, vPerGb: 0.0162 },
  e2b:     { name: "E2B",     vPerVcpu: 0.0504, vPerGb: 0.0162 },
  modal:   { name: "Modal",   vPerVcpu: 0.142,  vPerGb: 0.024 },
  fly:     { name: "Fly",     vPerVcpu: 0.0204, vPerGb: 0.00685 },
} as const;

export type VendorKey = keyof typeof VENDOR_RATES;

/** Just A VPS — same model, ~10× cheaper per resource. */
export const JUSTAVPS_RATES = {
  vPerVcpu:    0.005,    // $0.005 / vCPU·hour  (~$0.00000139 / vCPU·second)
  vPerGb:      0.0015,   // $0.0015 / GB-RAM·hour
  vPerStorage: 0.00003,  // $0.00003 / GB-disk·hour  (~$0.022 / GB·month)
} as const;

/* ── helpers ─────────────────────────────────────────────────────── */
export function vendorHourly(vendor: VendorKey, vcpu: number, ramGB: number): number {
  const r = VENDOR_RATES[vendor];
  return r.vPerVcpu * vcpu + r.vPerGb * ramGB;
}
export function vendorMonthly(
  vendor: VendorKey,
  vcpu: number,
  ramGB: number,
  hoursPerDay = 24,
): number {
  return Math.round(vendorHourly(vendor, vcpu, ramGB) * hoursPerDay * 30.4167);
}

export function justavpsHourly(vcpu: number, ramGB: number, storageGB = 0): number {
  return (
    JUSTAVPS_RATES.vPerVcpu * vcpu +
    JUSTAVPS_RATES.vPerGb * ramGB +
    JUSTAVPS_RATES.vPerStorage * storageGB
  );
}
export function justavpsMonthly(vcpu: number, ramGB: number, storageGB = 0): number {
  return Math.max(1, Math.round(justavpsHourly(vcpu, ramGB, storageGB) * HOURS_PER_MONTH));
}

/** Compact dollar formatter for small per-hour values. */
export function fmtHourly(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

/* ── shape presets (config helpers, NOT tier prices) ─────────────── */
export type Shape = {
  id: string;
  label: string;
  tagline: string;
  vcpu: number;
  memory: number;
  disk: number;
};

export const SHAPES: Shape[] = [
  { id: "starter", label: "Starter", tagline: "Small agents and utility boxes",          vcpu: 2,  memory: 4,  disk: 80  },
  { id: "basic",   label: "Basic",   tagline: "A little more headroom for daily work",   vcpu: 4,  memory: 8,  disk: 160 },
  { id: "pro",     label: "Pro",     tagline: "The default for most always-on workloads", vcpu: 8,  memory: 16, disk: 320 },
  { id: "power",   label: "Power",   tagline: "Heavy parallel agents and bigger services", vcpu: 12, memory: 24, disk: 480 },
  { id: "ultra",   label: "Ultra",   tagline: "Largest shared shape",                     vcpu: 16, memory: 32, disk: 640 },
];

/** Find best-fit shape for a given (vcpu, ram) request. */
export function bestFitShape(vcpu: number, ramGB: number): Shape {
  return SHAPES
    .map((s) => ({
      s,
      score:
        (s.vcpu >= vcpu && s.memory >= ramGB ? 0 : 1000) +
        Math.abs(s.vcpu - vcpu) +
        Math.abs(s.memory - ramGB) * 0.5,
    }))
    .sort((a, b) => a.score - b.score)[0].s;
}

/** Hero-friendly starting price = a Starter shape running 24/7. */
export function getStartingMonthly(): number {
  const s = SHAPES[0];
  return justavpsMonthly(s.vcpu, s.memory, s.disk);
}

/* ── back-compat shims (called from older copy paths) ────────────── */
export function getTiers() {
  return SHAPES.map((s) => ({
    ...s,
    traffic: "20 TB",
    priceEU: justavpsMonthly(s.vcpu, s.memory, s.disk),
    priceUS: justavpsMonthly(s.vcpu, s.memory, s.disk),
  }));
}
export function getStartingPrice(): number {
  return getStartingMonthly();
}

/** Effective hourly = monthly_at_24/7 / 730. Rate-derived. */
export function vpsHourly(monthly: number): number {
  return monthly / HOURS_PER_MONTH;
}

/** @deprecated kept so old imports still resolve — returns rate-based monthly. */
export function usageMonthlyEstimate(monthly: number): number {
  return monthly;
}

/** @deprecated original benchmark figure — now derived from real rates. */
export const US_BENCHMARK = getStartingMonthly();
