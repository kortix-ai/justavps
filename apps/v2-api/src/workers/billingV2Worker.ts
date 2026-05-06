import type { AppConfig } from '../config.js';
import { getPrisma } from '../db/client.js';
import { floorUtcHour } from '../billing/aggregate.js';
import { ensureDefaultBillingPriceVersion } from '../billing/prices.js';
import { buildBillingV2LedgerDrafts, writeBillingV2LedgerDrafts } from '../billing/reconcile.js';

export async function billingV2ClosedHourTick(config: AppConfig, now = new Date()) {
  if (!config.databaseConfigured) return { skipped: true as const, reason: 'database not configured' };
  const prisma = getPrisma();
  const priceVersion = await ensureDefaultBillingPriceVersion(prisma);
  const to = floorUtcHour(now);
  const from = new Date(to.getTime() - 3600_000);
  if (to <= from) return { skipped: true as const, reason: 'invalid closed hour' };
  const { drafts, skipped } = await buildBillingV2LedgerDrafts(prisma, { from, to, priceVersion, status: 'finalized' });
  const write = await writeBillingV2LedgerDrafts(prisma, drafts);
  return { skipped: false as const, window: { from, to }, drafts: drafts.length, measurement_gaps: skipped, ...write };
}

export function startBillingV2Worker(config: AppConfig) {
  if (['0', 'false', 'off', 'no'].includes(String(process.env.V2_BILLING_V2_WORKER ?? '').trim().toLowerCase())) return null;
  if (!config.databaseConfigured) {
    console.warn('[billing-v2] database not configured — skipping');
    return null;
  }
  const tickMs = Number(process.env.V2_BILLING_V2_TICK_MS || 60_000);
  const tick = async () => {
    const result = await billingV2ClosedHourTick(config);
    if (!result.skipped && result.drafts) {
      console.log(`[billing-v2] finalized ${result.drafts} row(s) for ${result.window.from.toISOString()}..${result.window.to.toISOString()}`);
    }
  };
  void tick().catch((error) => console.error('[billing-v2]', error));
  const timer = setInterval(() => { tick().catch((error) => console.error('[billing-v2]', error)); }, tickMs);
  console.log(`[v2-api] billing-v2 worker started (tick=${tickMs}ms)`);
  return timer;
}
