import { z } from '@hono/zod-openapi';

import type { AppConfig } from '../config.js';
import { getPrisma } from '../db/client.js';
import { aggregateBillingLedger, eurFromMicro, floorUtcHour, parseExplicitWindow } from './aggregate.js';
import { ensureDefaultBillingPriceVersion } from './prices.js';
import { buildBillingV2LedgerDrafts, writeBillingV2LedgerDrafts } from './reconcile.js';

type HonoLike = {
  get: (path: string, handler: (c: any) => Promise<Response> | Response) => unknown;
  post: (path: string, handler: (c: any) => Promise<Response> | Response) => unknown;
};

const reconcileSchema = z.object({
  account_id: z.string().min(1).optional().nullable(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  mode: z.enum(['dry_run', 'write_unfinalized', 'finalize']).default('dry_run'),
});

export function registerBillingV2Routes(app: HonoLike, config: AppConfig) {
  app.get('/admin/billing/v2/accounts/:accountId/statement', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const prisma = getPrisma();
      const accountId = c.req.param('accountId');
      const account = await prisma.account.findUnique({ where: { id: accountId } });
      if (!account) return c.json({ error: true, message: 'Account not found' }, 404);

      const window = parseExplicitWindow({ from: c.req.query('from'), to: c.req.query('to'), month: c.req.query('month') });
      const finalizedTo = minDate(window.to, window.finalizedThrough);
      const priceVersion = await ensureDefaultBillingPriceVersion(prisma);
      const [finalizedRows, unfinalizedRows, dryRun] = await Promise.all([
        prisma.billingLedgerEntry.findMany({
          where: {
            accountId,
            status: 'finalized',
            intervalStart: { gte: window.from },
            intervalEnd: { lte: finalizedTo },
          },
          orderBy: [{ intervalStart: 'asc' }, { component: 'asc' }],
        }),
        prisma.billingLedgerEntry.findMany({
          where: {
            accountId,
            status: 'unfinalized',
            intervalStart: { gte: finalizedTo },
            intervalEnd: { lte: minDate(window.to, window.asOf) },
          },
          orderBy: [{ intervalStart: 'asc' }, { component: 'asc' }],
        }),
        buildBillingV2LedgerDrafts(prisma, { accountId, from: window.from, to: finalizedTo, priceVersion, status: 'finalized' }).catch((error) => ({ drafts: [], skipped: [{ source_type: 'coverage', source_id: accountId, reason: error instanceof Error ? error.message : String(error) }] })),
      ]);
      const aggregate = aggregateBillingLedger(finalizedRows.map(rowToAggregateInput));
      const unfinalized = aggregateBillingLedger(unfinalizedRows.map(rowToAggregateInput));
      const warnings: string[] = [];
      if (dryRun.drafts.length > finalizedRows.length) {
        warnings.push('Actual usage exists in product/session records but has not been fully finalized into Billing API v2 ledger rows yet. Run /admin/billing/v2/reconcile or enable V2_BILLING_V2_WORKER=on.');
      }
      if (dryRun.skipped.length > 0) {
        warnings.push('Some usage could not be proven exactly and is excluded fail-closed from actual totals. See unmeasured_sources for the coverage gaps.');
      }

      return c.json({
        account: { id: account.id, name: account.name, slug: account.slug, type: account.type },
        window: {
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          as_of: window.asOf.toISOString(),
          finalized_through: finalizedTo.toISOString(),
        },
        currency: priceVersion.currency,
        price_version: { id: priceVersion.id, code: priceVersion.code },
        actual_mtd: {
          micro_eur: aggregate.totalMicroEur.toString(),
          eur: eurFromMicro(aggregate.totalMicroEur),
        },
        unfinalized_current_hour: {
          included: false,
          micro_eur: unfinalized.totalMicroEur.toString(),
          eur: eurFromMicro(unfinalized.totalMicroEur),
        },
        components: aggregate.components,
        sources: aggregate.sources,
        hourly: aggregate.hourly,
        coverage: {
          status: warnings.length ? 'partial' : 'complete',
          accuracy_model: 'fail_closed_verified_usage_only',
          missing_hours: [],
          unmeasured_sources: dryRun.skipped,
          warnings,
        },
      });
    } catch (error) {
      return billingRouteError(c, error);
    }
  });

  app.get('/admin/billing/v2/accounts/:accountId/ledger', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const prisma = getPrisma();
      const accountId = c.req.param('accountId');
      const window = parseExplicitWindow({ from: c.req.query('from'), to: c.req.query('to'), month: c.req.query('month') });
      const limit = Math.max(1, Math.min(1000, Number(c.req.query('limit') || 200)));
      const rows = await prisma.billingLedgerEntry.findMany({
        where: {
          accountId,
          intervalStart: { gte: window.from },
          intervalEnd: { lte: window.to },
          ...(c.req.query('component') ? { component: c.req.query('component') } : {}),
          ...(c.req.query('source_type') ? { sourceType: c.req.query('source_type') } : {}),
          ...(c.req.query('source_id') ? { sourceId: c.req.query('source_id') } : {}),
        },
        orderBy: [{ intervalStart: 'desc' }, { component: 'asc' }],
        take: limit,
      });
      return c.json({
        entries: rows.map((row) => ({
          id: row.id,
          account_id: row.accountId,
          machine_id: row.machineId,
          source_type: row.sourceType,
          source_id: row.sourceId,
          component: row.component,
          region: row.region,
          interval_start: row.intervalStart.toISOString(),
          interval_end: row.intervalEnd.toISOString(),
          quantity: row.quantity.toString(),
          quantity_unit: row.quantityUnit,
          rate_micro_eur_per_unit: row.rateMicroEurPerUnit.toString(),
          price_version_id: row.priceVersionId,
          micro_eur: row.microEur.toString(),
          eur: Number(row.microEur) / 1_000_000,
          status: row.status,
          measurement_source: row.measurementSource,
          measurement_exact: row.measurementExact,
          metadata: row.metadata,
        })),
      });
    } catch (error) {
      return billingRouteError(c, error);
    }
  });

  app.get('/admin/billing/v2/accounts/:accountId/hourly', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const prisma = getPrisma();
      const accountId = c.req.param('accountId');
      const window = parseExplicitWindow({ from: c.req.query('from'), to: c.req.query('to'), month: c.req.query('month') });
      const groupBy = c.req.query('group_by') || 'component';
      const rows = await prisma.billingLedgerEntry.findMany({
        where: { accountId, status: 'finalized', intervalStart: { gte: window.from }, intervalEnd: { lte: window.to } },
        orderBy: [{ intervalStart: 'asc' }, { component: 'asc' }],
      });
      const aggregate = aggregateBillingLedger(rows.map(rowToAggregateInput));
      const buckets = aggregate.hourly.map((bucket) => ({
        hour: bucket.hour,
        groups: Object.entries(bucket.components).map(([key, eur]) => ({ key, eur, micro_eur: String(Math.round(Number(eur) * 1_000_000)) })),
      }));
      return c.json({ window: { from: window.from.toISOString(), to: window.to.toISOString() }, group_by: groupBy, buckets });
    } catch (error) {
      return billingRouteError(c, error);
    }
  });

  app.post('/admin/billing/v2/reconcile', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const body = reconcileSchema.parse(await c.req.json().catch(() => ({})));
      const prisma = getPrisma();
      const parsedWindow = parseExplicitWindow({ from: body.from, to: body.to, month: body.month });
      const to = body.mode === 'finalize' ? minDate(parsedWindow.to, floorUtcHour(new Date())) : parsedWindow.to;
      const priceVersion = await ensureDefaultBillingPriceVersion(prisma);
      const status = body.mode === 'write_unfinalized' ? 'unfinalized' : 'finalized';
      const result = await buildBillingV2LedgerDrafts(prisma, { accountId: body.account_id, from: parsedWindow.from, to, priceVersion, status });
      const write = body.mode === 'dry_run'
        ? { written: 0, inserted: 0, updated: 0 }
        : await writeBillingV2LedgerDrafts(prisma, result.drafts);
      return c.json({
        mode: body.mode,
        window: { from: parsedWindow.from.toISOString(), to: to.toISOString() },
        account_id: body.account_id ?? null,
        price_version: { id: priceVersion.id, code: priceVersion.code },
        planned_rows: result.drafts.length,
        measurement_gaps: result.skipped,
        ...write,
      });
    } catch (error) {
      return billingRouteError(c, error);
    }
  });
}

function rowToAggregateInput(row: {
  accountId: string;
  machineId: string | null;
  sourceType: string;
  sourceId: string;
  component: string;
  intervalStart: Date;
  intervalEnd: Date;
  quantity: unknown;
  quantityUnit: string;
  microEur: bigint;
  status: string;
  measurementExact: boolean;
  metadata: unknown;
}) {
  return {
    accountId: row.accountId,
    machineId: row.machineId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    component: row.component,
    intervalStart: row.intervalStart,
    intervalEnd: row.intervalEnd,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    microEur: row.microEur,
    status: row.status,
    measurementExact: row.measurementExact,
    metadata: row.metadata,
  };
}

function minDate(a: Date, b: Date): Date {
  return a <= b ? a : b;
}

function billingRouteError(c: any, error: unknown) {
  if (error instanceof z.ZodError) return c.json({ error: true, message: 'Invalid request', issues: error.issues }, 400);
  return c.json({ error: true, message: error instanceof Error ? error.message : String(error) }, 500);
}
