import { createHash } from 'node:crypto';

import { splitIntervalByHour } from './aggregate.js';
import { rateForBillingComponent } from './prices.js';
import { BILLING_V2_COMPONENTS, type BillingV2Component, type BillingV2LedgerDraft, type BillingV2RateSet, type BillingV2SourceType } from './types.js';

export type UsageIntervalInput = {
  accountId: string;
  machineId?: string | null;
  sourceType: BillingV2SourceType;
  sourceId: string;
  sourceName?: string | null;
  component: BillingV2Component;
  region?: string | null;
  start: Date;
  end: Date;
  units: number;
  windowFrom: Date;
  windowTo: Date;
  priceVersionId: string;
  rates: BillingV2RateSet;
  status?: 'finalized' | 'unfinalized';
  measurementSource: string;
  measurementExact?: boolean;
  metadata?: Record<string, unknown>;
};

export function ledgerDraftsForUsageInterval(input: UsageIntervalInput): BillingV2LedgerDraft[] {
  if (!Number.isFinite(input.units) || input.units <= 0) return [];
  const componentMeta = BILLING_V2_COMPONENTS[input.component];
  const rate = rateForBillingComponent(input.component, input.rates);
  const rows: BillingV2LedgerDraft[] = [];
  for (const slice of splitIntervalByHour(input.start, input.end, input.windowFrom, input.windowTo)) {
    const quantity = input.units * slice.seconds;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const microEur = BigInt(Math.round(quantity * rate));
    if (microEur <= 0n) continue;
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.sourceName ? { source_name: input.sourceName } : {}),
      seconds: slice.seconds,
      units: input.units,
    };
    rows.push({
      accountId: input.accountId,
      machineId: input.machineId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      component: input.component,
      region: input.region ?? null,
      intervalStart: slice.start,
      intervalEnd: slice.end,
      quantity,
      quantityUnit: componentMeta.quantityUnit,
      rateMicroEurPerUnit: rate,
      priceVersionId: input.priceVersionId,
      microEur,
      status: input.status ?? 'finalized',
      measurementSource: input.measurementSource,
      measurementExact: input.measurementExact ?? true,
      idempotencyKey: idempotencyKey({
        accountId: input.accountId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        component: input.component,
        start: slice.start,
        end: slice.end,
        priceVersionId: input.priceVersionId,
        quantity,
      }),
      metadata,
    });
  }
  return rows;
}

export function idempotencyKey(input: {
  accountId: string;
  sourceType: string;
  sourceId: string;
  component: string;
  start: Date;
  end: Date;
  priceVersionId: string;
  quantity: number;
}) {
  const stable = [
    'bv2',
    input.accountId,
    input.sourceType,
    input.sourceId,
    input.component,
    input.start.toISOString(),
    input.end.toISOString(),
    input.priceVersionId,
    input.quantity.toFixed(9),
  ].join(':');
  return `bv2:${createHash('sha256').update(stable).digest('hex')}`;
}
