// Hetzner Robot SKU → resource & cost decomposition.
//
// We do per-resource unit pricing rather than €/sandbox-slot because
// sandbox shapes vary (1vCPU/2GB, 2vCPU/8GB, 4vCPU/16GB, …). The honest
// number per workload is whichever resource is binding × that resource's
// €/unit; the cluster as a whole is healthy when fill % across the three
// resources is roughly balanced.
//
// Numbers are HEL1 list prices (cheapest of FSN1/HEL1). usableStorageGb
// assumes RAID-1 mirror across the two NVMes (single-drive capacity), which
// is what -1-installimage.sh sets up. Any SKU with HDDs in addition to
// NVMe ignores HDD here — operators using SX-class for non-sandbox jobs
// should override.
//
// Source: GET /order/server/product on robot-ws.your-server.de, normalized
// 2026-04-27. Re-fetch when Hetzner adjusts prices: `gh api`-equivalent
// admin/vendors/hetzner/products endpoint already exists; rerun and
// reconcile here when prices drift.

export type Sku = {
  id: string;
  vcpus: number;          // SMT threads (Linux-schedulable units)
  ramGb: number;
  usableStorageGb: number;
  monthlyEur: number;
  // Best-€-per-resource flags. Helps the catalog endpoint surface "which
  // SKU to pick if I'm vCPU-bound vs RAM-bound vs storage-bound."
  notes?: string;
};

export const SKU_CATALOG: Record<string, Sku> = {
  // Default tier — best €/vCPU at the budget end. Currently undercuts AX41
  // by giving 14 cores / 20 threads on Gen-4 NVMe at €5 more/month.
  'EX44': {
    id: 'EX44',
    vcpus: 20,             // i5-13500: 6P (HT) + 8E = 12+8 = 20 threads
    ramGb: 64,
    usableStorageGb: 500,  // 2×512GB Gen4 RAID-1
    monthlyEur: 42.30,
    notes: 'Default tier. Best €/vCPU and best blended €/(vCPU+GB).',
  },
  // Original baseline — best €/GB RAM at the budget end. Keep as fallback
  // for RAM-bound workloads where threads aren't the bottleneck.
  'AX41-NVMe': {
    id: 'AX41-NVMe',
    vcpus: 12,             // Ryzen 5 3600: 6 cores × SMT
    ramGb: 64,
    usableStorageGb: 500,
    monthlyEur: 36.70,
    notes: 'Best €/GB RAM at budget tier. CPU-light workloads.',
  },
  // Newer Zen4 mid-tier. Useful when you specifically want DDR5 + Zen4 ISA.
  'AX42-U': {
    id: 'AX42-U',
    vcpus: 16,             // Ryzen 7 PRO 8700GE: 8 cores × SMT
    ramGb: 64,
    usableStorageGb: 500,
    monthlyEur: 52.30,
    notes: 'Zen4 + DDR5. Step up from AX41 when ISA matters.',
  },
  // High-density mid-tier. 16 cores Zen4 + 128 GB DDR5.
  'AX102-U': {
    id: 'AX102-U',
    vcpus: 32,             // Ryzen 9 7950X3D: 16 cores × SMT
    ramGb: 128,
    usableStorageGb: 1920,
    monthlyEur: 117.30,
    notes: 'High-density mid-tier. Doubles AX41 capacity.',
  },
  // Standard "big baremetal" — 96 threads + 256 GB ECC.
  'AX162-R': {
    id: 'AX162-R',
    vcpus: 96,             // EPYC 9454P: 48 cores × SMT
    ramGb: 256,
    usableStorageGb: 1920,
    monthlyEur: 227.30,
    notes: 'Default big-box tier. Best €/vCPU at scale + 256GB ECC RAM.',
  },
  'AX162-S': {
    id: 'AX162-S',
    vcpus: 96,
    ramGb: 128,
    usableStorageGb: 3840,
    monthlyEur: 227.30,
    notes: 'Same compute as AX162-R but trades RAM for 2× storage. Pick when storage-bound.',
  },
  // Listed for completeness; Intel Arrow Lake mid-tier.
  'EX63': {
    id: 'EX63',
    vcpus: 20,             // Intel Ultra 7 265: 8P + 12E (no HT in Arrow Lake) = 20 threads
    ramGb: 64,
    usableStorageGb: 1000,
    monthlyEur: 74.30,
    notes: 'More storage than EX44 but worse €/vCPU; pick when storage matters.',
  },
};

export const DEFAULT_SKU_ID = 'EX44';
export const DEFAULT_BIG_SKU_ID = 'AX162-R';

// Procurement policy. Returns the recommended SKU given current fleet
// state + the resource that's currently binding. Operator's first read
// when deciding what to order next.
//
// Rule of thumb (today, agent sandbox workload):
//   • <10 hosts in fleet              → always EX44 (simpler beats clever)
//   • 10-30 hosts + vcpu binding      → EX44 (cheapest €/vCPU)
//   • 10-30 hosts + ram binding       → AX41-NVMe (cheapest €/GB-RAM)
//   • 10-30 hosts + storage binding   → AX162-S (cheapest €/GB-storage)
//   • 30+ hosts + consolidation pref  → AX162-R (high density, fewer boxes
//                                       to manage, smaller fleet failure
//                                       surface area).
export function recommendNextSku(opts: {
  fleetHostCount: number;
  bindingConstraint: 'vcpus' | 'ram' | 'storage' | null;
  preferConsolidation?: boolean;
}): { skuId: string; rationale: string } {
  const { fleetHostCount, bindingConstraint, preferConsolidation } = opts;
  // Explicit consolidation override takes precedence over fleet-size rules
  // — the operator is asserting that compaction matters more than simplicity.
  if (preferConsolidation) {
    return { skuId: DEFAULT_BIG_SKU_ID, rationale: `Operator requested consolidation — AX162-R (96 vCPU / 256GB ECC).` };
  }
  if (fleetHostCount < 10) {
    return { skuId: DEFAULT_SKU_ID, rationale: `<10 host fleet — keep it simple, default EX44 (€42.30, 20 vCPU / 64GB).` };
  }
  if (fleetHostCount >= 30) {
    return { skuId: DEFAULT_BIG_SKU_ID, rationale: `${fleetHostCount}+ host fleet — consolidate via AX162-R (€227.30, 96 vCPU / 256GB ECC).` };
  }
  if (bindingConstraint === 'ram') {
    return { skuId: 'AX41-NVMe', rationale: `RAM is the binding resource — AX41-NVMe is cheapest €/GB-RAM at this tier.` };
  }
  if (bindingConstraint === 'storage') {
    return { skuId: 'AX162-S', rationale: `Storage is the binding resource — AX162-S has best €/GB-storage in catalog.` };
  }
  return { skuId: DEFAULT_SKU_ID, rationale: `vCPU is the binding resource — EX44 stays cheapest €/vCPU at this tier.` };
}

// Per-resource unit cost at a given target fill rate. Filling above ~80%
// risks performance degradation (memory pressure, CPU contention), so we
// quote effective rates at 0.8. Operators can pass a different target if
// they want.
export type PerResourceRates = {
  eurPerVcpuMonth: number;
  eurPerGbRamMonth: number;
  eurPerGbStorageMonth: number;
};

export function unitCostsAtFill(sku: Sku, targetFill = 0.8): PerResourceRates {
  return {
    eurPerVcpuMonth: sku.monthlyEur / (sku.vcpus * targetFill),
    eurPerGbRamMonth: sku.monthlyEur / (sku.ramGb * targetFill),
    eurPerGbStorageMonth: sku.monthlyEur / (sku.usableStorageGb * targetFill),
  };
}

// Worst-binding-resource cost. If the cluster is full of sandboxes shaped
// (vCPU, GB RAM, GB storage), the binding resource gets the lion's share
// of cost attribution. This returns whichever rate is highest — i.e. what
// you'd quote a customer if they're going to fill that bottleneck first.
export function bottleneckRate(sku: Sku, shape: { vcpus: number; ramGb: number; storageGb: number }, targetFill = 0.8): { resource: 'vcpu' | 'ram' | 'storage'; eurMonth: number } {
  const rates = unitCostsAtFill(sku, targetFill);
  const candidates = [
    { resource: 'vcpu' as const, eurMonth: rates.eurPerVcpuMonth * shape.vcpus },
    { resource: 'ram' as const, eurMonth: rates.eurPerGbRamMonth * shape.ramGb },
    { resource: 'storage' as const, eurMonth: rates.eurPerGbStorageMonth * shape.storageGb },
  ];
  return candidates.reduce((max, c) => (c.eurMonth > max.eurMonth ? c : max));
}

export function getSku(id: string | undefined): Sku | null {
  if (!id) return null;
  return SKU_CATALOG[id] ?? null;
}
