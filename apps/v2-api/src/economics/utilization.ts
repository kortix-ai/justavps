// Cluster utilization & cost rollups.
//
// Reads each cluster's instances + members and decomposes them into
// per-resource (vCPU, RAM, storage) allocation %, dollar fill, and
// binding-constraint identification. Pure function over current state —
// no historical metrics here; that's a future timeseries job.

import type { IncusClusterConfig } from '../config.js';
import type { IncusClusterMember, IncusInstance } from '../incus/types.js';
import { DEFAULT_SKU_ID, getSku, unitCostsAtFill, type Sku } from './skuCatalog.js';

// Parse Incus's `limits.cpu` value. Accepts:
//   "4"       → 4 vCPUs (count form)
//   "0,1,2,3" → 4 vCPUs (pinning form, count distinct)
//   "0-3"     → 4 vCPUs (range form, count via expansion)
//   ""/missing → null (uncapped — instance can use whole host)
export function parseCpuLimit(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  // Plain number — count form.
  if (/^\d+$/.test(v)) return Number(v);
  // Comma-separated list of cpus or ranges.
  let total = 0;
  for (const piece of v.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (/^\d+$/.test(piece)) {
      total += 1;
    } else {
      const m = /^(\d+)-(\d+)$/.exec(piece);
      if (m) {
        const lo = Number(m[1]);
        const hi = Number(m[2]);
        if (hi >= lo) total += hi - lo + 1;
      }
      // Anything else is malformed — skip silently rather than crash a
      // utilization report.
    }
  }
  return total > 0 ? total : null;
}

// Parse Incus's `limits.memory` value. Accepts SI ("8GB"), IEC ("8GiB"),
// percentages ("25%" = pct of host), and bare bytes. Returns GB (decimal).
export function parseMemoryLimitGb(raw: string | undefined, hostRamGb?: number): number | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  // Percentage of host.
  const pct = /^([\d.]+)%$/.exec(v);
  if (pct) {
    const fraction = Number(pct[1]) / 100;
    return hostRamGb ? hostRamGb * fraction : null;
  }
  // Number with unit suffix. Strip suffix, multiply.
  const m = /^([\d.]+)\s*(K|M|G|T|Ki|Mi|Gi|Ti|KB|MB|GB|TB|KiB|MiB|GiB|TiB|B)?$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? '').toUpperCase();
  // Map unit → bytes. Treat bare numbers as bytes (Incus convention).
  const factor: Record<string, number> = {
    '': 1, 'B': 1,
    'K': 1e3, 'KB': 1e3, 'KI': 1024, 'KIB': 1024,
    'M': 1e6, 'MB': 1e6, 'MI': 1024 * 1024, 'MIB': 1024 * 1024,
    'G': 1e9, 'GB': 1e9, 'GI': 1024 ** 3, 'GIB': 1024 ** 3,
    'T': 1e12, 'TB': 1e12, 'TI': 1024 ** 4, 'TIB': 1024 ** 4,
  };
  const bytes = n * (factor[unit] ?? 1);
  return bytes / 1e9;
}

// Sum the storage requested by an instance across its `disk` devices.
// Incus profile devices look like { root: { type: 'disk', size: '20GB' } };
// instance-level devices override the profile. We read instance.devices —
// the API returns merged config when called with recursion=1.
export function sumInstanceStorageGb(devices: Record<string, Record<string, string>> | undefined): number | null {
  if (!devices) return null;
  let total = 0;
  let any = false;
  for (const dev of Object.values(devices)) {
    if (dev?.type !== 'disk') continue;
    const size = dev.size ?? dev['size.state'];
    const gb = parseMemoryLimitGb(size);
    if (gb !== null) {
      total += gb;
      any = true;
    }
  }
  return any ? total : null;
}

// Per-cluster economics roll-up. Cost = sum of member SKU prices. Capacity
// = sum of member SKU resources. Allocation = sum of running instance
// limits. Fill % = allocation / capacity. Effective unit costs at 80% fill
// are the operator-meaningful number — what each €/vCPU·month etc actually
// costs you when comfortably full.
export type ClusterEconomics = {
  cluster_id: string;
  cluster_name: string;
  region: string;
  members: number;
  members_online: number;
  member_sku: string | null;
  monthly_cost_eur: number | null;
  capacity: { vcpus: number; ram_gb: number; storage_gb: number } | null;
  allocated: { vcpus: number; ram_gb: number; storage_gb: number };
  unbounded_instances: number;       // instances with no limits.cpu / limits.memory
  fill_pct: { vcpus: number | null; ram: number | null; storage: number | null } | null;
  binding_constraint: 'vcpus' | 'ram' | 'storage' | null;
  effective_unit_costs_at_80_pct_fill: { eur_per_vcpu_month: number; eur_per_gb_ram_month: number; eur_per_gb_storage_month: number } | null;
  active_instances: number;
  cost_per_active_instance_eur: number | null;
};

function findMemberSku(cluster: IncusClusterConfig): Sku | null {
  return getSku(cluster.defaultMemberSku ?? DEFAULT_SKU_ID);
}

export function computeClusterEconomics(
  cluster: IncusClusterConfig,
  members: IncusClusterMember[],
  instances: IncusInstance[],
): ClusterEconomics {
  const sku = findMemberSku(cluster);
  const onlineCount = members.filter((m) => (m.status ?? '').toLowerCase() === 'online').length;

  // Capacity: assume every member is the cluster's defaultMemberSku.
  // Mixed-SKU clusters need per-member overrides — IncusMember.observed.sku
  // is the (later) escape hatch.
  const capacity = sku
    ? {
        vcpus: sku.vcpus * members.length,
        ram_gb: sku.ramGb * members.length,
        storage_gb: sku.usableStorageGb * members.length,
      }
    : null;

  let allocVcpus = 0;
  let allocRamGb = 0;
  let allocStorageGb = 0;
  let unbounded = 0;

  // Only count running/started instances against the live capacity. Stopped
  // ones still occupy storage but don't pin CPU/RAM — for a first pass we
  // count all of them since stopped sandboxes can be resumed and "should
  // fit" is the operator question. Refine later if needed.
  for (const inst of instances) {
    const cpu = parseCpuLimit(inst.config?.['limits.cpu']);
    const memGb = parseMemoryLimitGb(inst.config?.['limits.memory'], sku?.ramGb);
    const diskGb = sumInstanceStorageGb(inst.devices);
    if (cpu === null && memGb === null) unbounded += 1;
    if (cpu !== null) allocVcpus += cpu;
    if (memGb !== null) allocRamGb += memGb;
    if (diskGb !== null) allocStorageGb += diskGb;
  }

  const fillPct = capacity
    ? {
        vcpus: capacity.vcpus > 0 ? (allocVcpus / capacity.vcpus) * 100 : null,
        ram: capacity.ram_gb > 0 ? (allocRamGb / capacity.ram_gb) * 100 : null,
        storage: capacity.storage_gb > 0 ? (allocStorageGb / capacity.storage_gb) * 100 : null,
      }
    : null;

  let binding: 'vcpus' | 'ram' | 'storage' | null = null;
  if (fillPct) {
    const candidates: Array<{ key: 'vcpus' | 'ram' | 'storage'; pct: number | null }> = [
      { key: 'vcpus', pct: fillPct.vcpus },
      { key: 'ram', pct: fillPct.ram },
      { key: 'storage', pct: fillPct.storage },
    ];
    const max = candidates.reduce<{ key: 'vcpus' | 'ram' | 'storage'; pct: number } | null>((acc, c) => {
      if (c.pct === null) return acc;
      if (!acc || c.pct > acc.pct) return { key: c.key, pct: c.pct };
      return acc;
    }, null);
    // Don't claim a "binding" resource when nothing is allocated — that's
    // misleading. Only surface a binding constraint once at least one
    // resource is in use.
    binding = max && max.pct > 0 ? max.key : null;
  }

  const monthlyCost = sku ? sku.monthlyEur * members.length : null;
  const unitRates = sku ? unitCostsAtFill(sku, 0.8) : null;
  const activeInstances = instances.filter((i) => (i.status ?? '').toLowerCase() === 'running').length;

  return {
    cluster_id: cluster.id,
    cluster_name: cluster.name,
    region: cluster.region,
    members: members.length,
    members_online: onlineCount,
    member_sku: sku?.id ?? null,
    monthly_cost_eur: monthlyCost,
    capacity,
    allocated: { vcpus: allocVcpus, ram_gb: allocRamGb, storage_gb: allocStorageGb },
    unbounded_instances: unbounded,
    fill_pct: fillPct,
    binding_constraint: binding,
    effective_unit_costs_at_80_pct_fill: unitRates
      ? {
          eur_per_vcpu_month: unitRates.eurPerVcpuMonth,
          eur_per_gb_ram_month: unitRates.eurPerGbRamMonth,
          eur_per_gb_storage_month: unitRates.eurPerGbStorageMonth,
        }
      : null,
    active_instances: activeInstances,
    cost_per_active_instance_eur: monthlyCost !== null && activeInstances > 0 ? monthlyCost / activeInstances : null,
  };
}
