/**
 * Admin Billing — operator view of customer subscriptions, MRR, failed-payment
 * watchlist, and Stripe webhook health.
 *
 * Scope: read-only. Stripe owns the subscription lifecycle (cancel, retry,
 * refund, etc.) — this surface is purely for visibility / triage.
 *
 * Security: every endpoint is admin-guarded and never exposes Stripe secret
 * keys. Subscription + customer IDs are operator-needed metadata and are
 * returned; full customer PII is kept to email only.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, gt, ilike, isNotNull, or, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  users,
  accounts,
  machines,
  subscriptions,
  machineEvents,
  stripeEvents,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from '@/server/auth/api-guard';
import { errorResponse } from '@/server/core/route-helpers';

export const adminBillingApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminBillingApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
}

function parseLimit(raw: string | undefined, fallback: number, max = 500) {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseOffset(raw: string | undefined) {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

const SUBSCRIPTION_STATUSES = [
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
] as const;

// ─── GET /summary — dashboard numbers ──────────────────────────────────────

adminBillingApp.get('/summary', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  // MRR = SUM(machine.price_monthly) across active subscriptions where the
  // machine is neither deleted nor errored. price_monthly is stored in USD
  // (dollars) so we multiply by 100 at the end to report cents.
  const [mrrRow] = await db
    .select({
      priceSum: sql<number>`coalesce(sum(${machines.priceMonthly}), 0)`,
    })
    .from(subscriptions)
    .innerJoin(machines, eq(subscriptions.machineId, machines.id))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        isNotNull(machines.priceMonthly),
        sql`${machines.status} not in ('deleted', 'error')`,
      ),
    );
  const mrrCents = Number(mrrRow?.priceSum ?? 0) * 100;

  // Per-status counts across all non-soft-deleted subscriptions.
  const statusRows = await db
    .select({
      status: subscriptions.status,
      count: sql<number>`count(*)`,
    })
    .from(subscriptions)
    .groupBy(subscriptions.status);

  const mrrByStatus: Record<(typeof SUBSCRIPTION_STATUSES)[number], number> = {
    active: 0,
    past_due: 0,
    unpaid: 0,
    canceled: 0,
    incomplete: 0,
  };
  for (const row of statusRows) {
    if (row.status && row.status in mrrByStatus) {
      mrrByStatus[row.status as keyof typeof mrrByStatus] = Number(row.count);
    }
  }

  const activeCount = mrrByStatus.active;
  const atRiskCount = mrrByStatus.past_due + mrrByStatus.unpaid;

  // Cancelling = cancel_at_period_end=true and not yet fully cancelled.
  const [cancellingRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.cancelAtPeriodEnd, true),
        sql`${subscriptions.status} <> 'canceled'`,
      ),
    );
  const cancellingCount = Number(cancellingRow?.count ?? 0);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [cancelledLast30Row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, 'canceled'),
        isNotNull(subscriptions.cancelledAt),
        gt(subscriptions.cancelledAt, thirtyDaysAgo),
      ),
    );
  const cancelledLast30d = Number(cancelledLast30Row?.count ?? 0);

  // Top 5 accounts by summed MRR (active subs × machine.price_monthly).
  const topAccountRows = await db
    .select({
      accountId: machines.accountId,
      accountName: accounts.name,
      priceSum: sql<number>`coalesce(sum(${machines.priceMonthly}), 0)`,
      subscriptionCount: sql<number>`count(*)`,
    })
    .from(subscriptions)
    .innerJoin(machines, eq(subscriptions.machineId, machines.id))
    .leftJoin(accounts, eq(machines.accountId, accounts.id))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        isNotNull(machines.accountId),
        isNotNull(machines.priceMonthly),
        sql`${machines.status} not in ('deleted', 'error')`,
      ),
    )
    .groupBy(machines.accountId, accounts.name)
    .orderBy(desc(sql`coalesce(sum(${machines.priceMonthly}), 0)`))
    .limit(5);

  const topAccountsByMrr = topAccountRows
    .filter((r) => r.accountId)
    .map((r) => ({
      account_id: r.accountId as string,
      account_name: r.accountName ?? null,
      mrr_cents: Number(r.priceSum ?? 0) * 100,
      subscription_count: Number(r.subscriptionCount ?? 0),
    }));

  // Stripe webhook events in the last 24h.
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [stripeEventsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(stripeEvents)
    .where(gt(stripeEvents.processedAt, twentyFourHoursAgo));
  const stripeEventsLast24h = Number(stripeEventsRow?.count ?? 0);

  return c.json({
    mrr_cents: mrrCents,
    mrr_by_status: mrrByStatus,
    active_count: activeCount,
    at_risk_count: atRiskCount,
    cancelling_count: cancellingCount,
    cancelled_last_30d: cancelledLast30d,
    top_accounts_by_mrr: topAccountsByMrr,
    stripe_events_last_24h: stripeEventsLast24h,
  });
});

// ─── GET /subscriptions — paginated list ───────────────────────────────────

adminBillingApp.get('/subscriptions', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const status = c.req.query('status');
  const includeCancelled = c.req.query('include_cancelled') === 'true';
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (status && status !== 'all') {
    if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(subscriptions.status, status) as unknown as ReturnType<typeof eq>);
    }
  } else if (!includeCancelled) {
    // By default hide cancelled subs unless the caller explicitly asked.
    conditions.push(
      sql`${subscriptions.status} <> 'canceled'` as unknown as ReturnType<typeof eq>,
    );
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(machines.slug, pattern),
        ilike(users.email, pattern),
        ilike(subscriptions.stripeSubscriptionId, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total (uses the same joins because q filters join columns).
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .leftJoin(machines, eq(subscriptions.machineId, machines.id))
    .leftJoin(users, eq(subscriptions.ownerId, users.id))
    .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      subscription: subscriptions,
      machine: machines,
      ownerEmail: users.email,
      ownerName: users.name,
      ownerId: users.id,
      accountId: accounts.id,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(subscriptions)
    .leftJoin(machines, eq(subscriptions.machineId, machines.id))
    .leftJoin(users, eq(subscriptions.ownerId, users.id))
    .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
    .where(where)
    .orderBy(desc(subscriptions.createdAt))
    .limit(limit)
    .offset(offset);

  const subscriptionsOut = rows.map((r) => {
    const s = r.subscription;
    const m = r.machine;
    return {
      id: s.id,
      stripe_subscription_id: s.stripeSubscriptionId,
      stripe_subscription_item_id: s.stripeSubscriptionItemId ?? null,
      stripe_price_id: s.stripePriceId ?? null,
      status: s.status,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      cancel_at: s.cancelAt?.toISOString() ?? null,
      cancelled_at: s.cancelledAt?.toISOString() ?? null,
      current_period_start: s.currentPeriodStart?.toISOString() ?? null,
      current_period_end: s.currentPeriodEnd?.toISOString() ?? null,
      machine: m
        ? {
            id: m.id,
            slug: m.slug,
            name: m.name,
            status: m.status,
            region: m.region,
            server_type: m.serverType,
            price_monthly: m.priceMonthly ?? null,
          }
        : null,
      owner: {
        id: s.ownerId,
        email: r.ownerEmail ?? null,
        name: r.ownerName ?? null,
      },
      account: r.accountId
        ? {
            id: r.accountId,
            name: r.accountName ?? null,
            slug: r.accountSlug ?? null,
            type: r.accountType ?? null,
          }
        : null,
      created_at: s.createdAt.toISOString(),
      updated_at: s.updatedAt.toISOString(),
    };
  });

  return c.json({
    total,
    subscriptions: subscriptionsOut,
  });
});

// ─── GET /subscriptions/:id — subscription detail ──────────────────────────

adminBillingApp.get('/subscriptions/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return errorResponse(c, 400, 'Invalid subscription ID');
  }

  const [row] = await db
    .select({
      subscription: subscriptions,
      machine: machines,
      ownerEmail: users.email,
      ownerName: users.name,
      accountId: accounts.id,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(subscriptions)
    .leftJoin(machines, eq(subscriptions.machineId, machines.id))
    .leftJoin(users, eq(subscriptions.ownerId, users.id))
    .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
    .where(eq(subscriptions.id, id));

  if (!row) {
    return errorResponse(c, 404, 'Subscription not found');
  }

  const s = row.subscription;
  const m = row.machine;

  // Recent machine events for triage. Scoped to the linked machine.
  let recentEvents: Array<typeof machineEvents.$inferSelect> = [];
  if (m) {
    recentEvents = await db
      .select()
      .from(machineEvents)
      .where(eq(machineEvents.machineId, m.id))
      .orderBy(desc(machineEvents.createdAt))
      .limit(10);
  }

  return c.json({
    subscription: {
      id: s.id,
      stripe_subscription_id: s.stripeSubscriptionId,
      stripe_subscription_item_id: s.stripeSubscriptionItemId ?? null,
      stripe_checkout_session_id: s.stripeCheckoutSessionId ?? null,
      stripe_price_id: s.stripePriceId ?? null,
      status: s.status,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      cancel_at: s.cancelAt?.toISOString() ?? null,
      cancelled_at: s.cancelledAt?.toISOString() ?? null,
      current_period_start: s.currentPeriodStart?.toISOString() ?? null,
      current_period_end: s.currentPeriodEnd?.toISOString() ?? null,
      created_at: s.createdAt.toISOString(),
      updated_at: s.updatedAt.toISOString(),
    },
    machine: m
      ? {
          id: m.id,
          slug: m.slug,
          name: m.name,
          status: m.status,
          region: m.region,
          server_type: m.serverType,
          price_monthly: m.priceMonthly ?? null,
          last_heartbeat_at: m.lastHeartbeatAt?.toISOString() ?? null,
          created_at: m.createdAt.toISOString(),
          deleted_at: m.deletedAt?.toISOString() ?? null,
        }
      : null,
    owner: {
      id: s.ownerId,
      email: row.ownerEmail ?? null,
      name: row.ownerName ?? null,
    },
    account: row.accountId
      ? {
          id: row.accountId,
          name: row.accountName ?? null,
          slug: row.accountSlug ?? null,
          type: row.accountType ?? null,
        }
      : null,
    recent_events: recentEvents.map((ev) => ({
      id: ev.id,
      event: ev.event,
      stage: ev.stage ?? null,
      message: ev.message ?? null,
      created_at: ev.createdAt.toISOString(),
    })),
  });
});

// ─── GET /stripe-events — last N Stripe webhook events ────────────────────

adminBillingApp.get('/stripe-events', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const limit = parseLimit(c.req.query('limit'), 50, 200);
  const sinceRaw = c.req.query('since');

  const conditions: ReturnType<typeof eq>[] = [];
  if (sinceRaw) {
    const since = new Date(sinceRaw);
    if (!Number.isNaN(since.getTime())) {
      conditions.push(
        gt(stripeEvents.processedAt, since) as unknown as ReturnType<typeof eq>,
      );
    }
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      eventId: stripeEvents.eventId,
      eventType: stripeEvents.eventType,
      processedAt: stripeEvents.processedAt,
    })
    .from(stripeEvents)
    .where(where)
    .orderBy(desc(stripeEvents.processedAt))
    .limit(limit);

  return c.json({
    events: rows.map((r) => ({
      event_id: r.eventId,
      event_type: r.eventType,
      processed_at: r.processedAt.toISOString(),
    })),
  });
});

