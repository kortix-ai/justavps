// PnL roll-up. Pure function over cost ledger + revenue ledger rows.
// All math in BigInt micro-eur to avoid float drift on large totals.

export type CostEntry = {
  hostId: string;
  tsFrom: Date;
  tsTo: Date;
  microEur: bigint;
};

export type RevenueEntry = {
  customerId: string | null;
  machineId: string;
  tsFrom: Date;
  tsTo: Date;
  microEur: bigint;
};

export type PnLRollup = {
  total_cost_micro_eur: bigint;
  total_revenue_micro_eur: bigint;
  margin_micro_eur: bigint;
  margin_pct: number | null;        // null when revenue is zero (undefined ratio)
  by_host: Array<{ host_id: string; cost_micro_eur: bigint }>;
  by_customer: Array<{ customer_id: string | null; revenue_micro_eur: bigint }>;
  by_machine: Array<{ machine_id: string; revenue_micro_eur: bigint }>;
};

export function rollupPnL(costs: CostEntry[], revenues: RevenueEntry[]): PnLRollup {
  let totalCost = 0n;
  let totalRevenue = 0n;

  const byHost = new Map<string, bigint>();
  for (const c of costs) {
    totalCost += c.microEur;
    byHost.set(c.hostId, (byHost.get(c.hostId) ?? 0n) + c.microEur);
  }

  const byCustomer = new Map<string | null, bigint>();
  const byMachine = new Map<string, bigint>();
  for (const r of revenues) {
    totalRevenue += r.microEur;
    byCustomer.set(r.customerId, (byCustomer.get(r.customerId) ?? 0n) + r.microEur);
    byMachine.set(r.machineId, (byMachine.get(r.machineId) ?? 0n) + r.microEur);
  }

  const margin = totalRevenue - totalCost;
  // Margin pct = margin / revenue × 100. Convert via Number (safe at our
  // scale: BigInt → Number loses precision past 2^53 µEUR ≈ €9.0 trillion;
  // we're nowhere close).
  const marginPct = totalRevenue === 0n
    ? null
    : (Number(margin) / Number(totalRevenue)) * 100;

  return {
    total_cost_micro_eur: totalCost,
    total_revenue_micro_eur: totalRevenue,
    margin_micro_eur: margin,
    margin_pct: marginPct,
    by_host: Array.from(byHost, ([host_id, cost_micro_eur]) => ({ host_id, cost_micro_eur })),
    by_customer: Array.from(byCustomer, ([customer_id, revenue_micro_eur]) => ({ customer_id, revenue_micro_eur })),
    by_machine: Array.from(byMachine, ([machine_id, revenue_micro_eur]) => ({ machine_id, revenue_micro_eur })),
  };
}
