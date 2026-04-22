/**
 * Admin Webhooks — admin-only fleet-wide views of customer webhook
 * configurations and their delivery history.
 *
 * Scope: operator diagnostics. Read-only in this iteration — no manual
 * retry / disable / delete mutations. Mirrors the apiGuard + requireAdmin
 * pattern of `admin-accounts.ts` / `admin-images.ts`.
 *
 * A single OpenAPIHono app serves BOTH `/webhooks` and `/webhook-deliveries`;
 * in `routes/index.ts` we mount this under `/admin` so final paths are
 * `/api/v1/admin/webhooks` and `/api/v1/admin/webhook-deliveries`.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, gt, ilike, or, sql, desc, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  webhooks,
  webhookDeliveries,
  users,
  accounts,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse } from "@/server/core/route-helpers";

export const adminWebhooksApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminWebhooksApp.use('*', apiGuard);

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

/** Mask a webhook secret — first 4 chars + "..." so admins can verify
 *  which secret it is without leaking the signing key. */
function maskSecret(secret: string | null | undefined): string {
  if (!secret) return '';
  if (secret.length <= 4) return `${secret}...`;
  return `${secret.slice(0, 4)}...`;
}

/** Response bodies can be huge. Truncate for the list endpoint — the
 *  detail endpoint returns the full body. */
function truncateResponseBody(body: string | null | undefined, limit = 1024): string | null {
  if (body == null) return null;
  if (body.length <= limit) return body;
  return body.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /webhooks — list webhooks with aggregates ─────────────────────────

adminWebhooksApp.get('/webhooks', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const activeRaw = c.req.query('active');
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (activeRaw === 'true') {
    conditions.push(eq(webhooks.active, true));
  } else if (activeRaw === 'false') {
    conditions.push(eq(webhooks.active, false));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(webhooks.url, pattern),
        ilike(accounts.name, pattern),
        ilike(accounts.slug, pattern),
        ilike(users.email, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total (apply same joins to allow q filter against joined columns)
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(webhooks)
    .leftJoin(users, eq(webhooks.ownerId, users.id))
    .leftJoin(accounts, eq(webhooks.accountId, accounts.id))
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  // Correlated subqueries for per-webhook 24h aggregates. Done inline so we
  // avoid N+1 across the page.
  const deliveryCount24hSql = sql<number>`(
    select count(*)::int
    from ${webhookDeliveries} wd
    where wd.webhook_id = ${webhooks.id}
      and wd.created_at > now() - interval '24 hours'
  )`;
  const successCount24hSql = sql<number>`(
    select count(*)::int
    from ${webhookDeliveries} wd
    where wd.webhook_id = ${webhooks.id}
      and wd.created_at > now() - interval '24 hours'
      and wd.success = true
  )`;
  const failureCount24hSql = sql<number>`(
    select count(*)::int
    from ${webhookDeliveries} wd
    where wd.webhook_id = ${webhooks.id}
      and wd.created_at > now() - interval '24 hours'
      and wd.success = false
  )`;

  const rows = await db
    .select({
      webhook: webhooks,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
      deliveryCount24h: deliveryCount24hSql,
      successCount24h: successCount24hSql,
      failureCount24h: failureCount24hSql,
    })
    .from(webhooks)
    .leftJoin(users, eq(webhooks.ownerId, users.id))
    .leftJoin(accounts, eq(webhooks.accountId, accounts.id))
    .where(where)
    .orderBy(desc(webhooks.createdAt))
    .limit(limit)
    .offset(offset);

  // Summary across ALL webhooks (ignore q/active so KPIs reflect the full
  // fleet state regardless of current filters).
  const [summaryRow] = await db
    .select({
      total: sql<number>`count(*)`,
      active_count: sql<number>`count(*) filter (where ${webhooks.active} = true)`,
      disabled_count: sql<number>`count(*) filter (where ${webhooks.active} = false)`,
    })
    .from(webhooks);

  const [deliverySummaryRow] = await db
    .select({
      total_deliveries_24h: sql<number>`count(*) filter (where ${webhookDeliveries.createdAt} > now() - interval '24 hours')`,
      total_failures_24h: sql<number>`count(*) filter (where ${webhookDeliveries.createdAt} > now() - interval '24 hours' and ${webhookDeliveries.success} = false)`,
      dead_lettered_count: sql<number>`count(*) filter (where ${webhookDeliveries.deadLetteredAt} is not null)`,
    })
    .from(webhookDeliveries);

  return c.json({
    total,
    webhooks: rows.map((r) => ({
      id: r.webhook.id,
      url: r.webhook.url,
      events: r.webhook.events ?? [],
      active: r.webhook.active,
      failure_count: r.webhook.failureCount,
      last_delivered_at: r.webhook.lastDeliveredAt?.toISOString() ?? null,
      disabled_at: r.webhook.disabledAt?.toISOString() ?? null,
      disable_reason: r.webhook.disableReason ?? null,
      created_at: r.webhook.createdAt.toISOString(),
      owner: {
        id: r.webhook.ownerId,
        email: r.ownerEmail ?? null,
        name: r.ownerName ?? null,
      },
      account: r.webhook.accountId ? {
        id: r.webhook.accountId,
        name: r.accountName ?? null,
        slug: r.accountSlug ?? null,
        type: r.accountType ?? null,
      } : null,
      delivery_count_24h: Number(r.deliveryCount24h ?? 0),
      success_count_24h: Number(r.successCount24h ?? 0),
      failure_count_24h: Number(r.failureCount24h ?? 0),
    })),
    summary: {
      total: Number(summaryRow?.total ?? 0),
      active_count: Number(summaryRow?.active_count ?? 0),
      disabled_count: Number(summaryRow?.disabled_count ?? 0),
      total_deliveries_24h: Number(deliverySummaryRow?.total_deliveries_24h ?? 0),
      total_failures_24h: Number(deliverySummaryRow?.total_failures_24h ?? 0),
      dead_lettered_count: Number(deliverySummaryRow?.dead_lettered_count ?? 0),
    },
  });
});

// ─── GET /webhooks/:id — webhook detail ────────────────────────────────────

adminWebhooksApp.get('/webhooks/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid webhook ID');
  }

  const [row] = await db
    .select({
      webhook: webhooks,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(webhooks)
    .leftJoin(users, eq(webhooks.ownerId, users.id))
    .leftJoin(accounts, eq(webhooks.accountId, accounts.id))
    .where(eq(webhooks.id, id));

  if (!row) {
    return errorResponse(c, 404, 'Webhook not found');
  }

  const wh = row.webhook;

  // Last 100 deliveries (newest first)
  const deliveryRows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(100);

  return c.json({
    webhook: {
      id: wh.id,
      url: wh.url,
      // Mask the signing secret — operators need to verify which secret
      // it is, not what the secret is.
      secret_preview: maskSecret(wh.secret),
      events: wh.events ?? [],
      active: wh.active,
      failure_count: wh.failureCount,
      last_delivered_at: wh.lastDeliveredAt?.toISOString() ?? null,
      disabled_at: wh.disabledAt?.toISOString() ?? null,
      disable_reason: wh.disableReason ?? null,
      created_at: wh.createdAt.toISOString(),
    },
    owner: {
      id: wh.ownerId,
      email: row.ownerEmail ?? null,
      name: row.ownerName ?? null,
    },
    account: wh.accountId ? {
      id: wh.accountId,
      name: row.accountName ?? null,
      slug: row.accountSlug ?? null,
      type: row.accountType ?? null,
    } : null,
    deliveries: deliveryRows.map((d) => ({
      id: d.id,
      webhook_id: d.webhookId,
      event_type: d.eventType,
      status: d.status,
      status_code: d.statusCode ?? null,
      // Full response body is OK here — detail view, single webhook.
      response_body: d.responseBody ?? null,
      duration_ms: d.durationMs ?? null,
      attempt: d.attempt,
      next_attempt_at: d.nextAttemptAt?.toISOString() ?? null,
      last_attempt_at: d.lastAttemptAt?.toISOString() ?? null,
      success: d.success,
      error: d.error ?? null,
      delivered_at: d.deliveredAt?.toISOString() ?? null,
      dead_lettered_at: d.deadLetteredAt?.toISOString() ?? null,
      created_at: d.createdAt.toISOString(),
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK DELIVERIES — unified cross-webhook feed
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /webhook-deliveries — list unified deliveries ─────────────────────

adminWebhooksApp.get('/webhook-deliveries', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const statusFilter = c.req.query('status'); // all | queued | delivered | failed | dead_lettered
  const eventType = c.req.query('event_type');
  const webhookId = c.req.query('webhook_id');
  const sinceRaw = c.req.query('since');
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (statusFilter && statusFilter !== 'all') {
    if (statusFilter === 'delivered') {
      conditions.push(eq(webhookDeliveries.success, true) as unknown as ReturnType<typeof eq>);
    } else if (statusFilter === 'failed') {
      // failed = not successful AND not dead-lettered yet (still retrying or
      // permanently-failed-but-not-DLQ)
      conditions.push(
        and(
          eq(webhookDeliveries.success, false),
          isNull(webhookDeliveries.deadLetteredAt),
        )! as unknown as ReturnType<typeof eq>,
      );
    } else if (statusFilter === 'dead_lettered') {
      conditions.push(
        isNotNull(webhookDeliveries.deadLetteredAt) as unknown as ReturnType<typeof eq>,
      );
    } else if (statusFilter === 'queued') {
      conditions.push(eq(webhookDeliveries.status, 'queued'));
    }
  }

  if (eventType) {
    conditions.push(eq(webhookDeliveries.eventType, eventType));
  }

  if (webhookId) {
    if (!z.string().uuid().safeParse(webhookId).success) {
      return errorResponse(c, 400, 'Invalid webhook_id');
    }
    conditions.push(eq(webhookDeliveries.webhookId, webhookId));
  }

  if (sinceRaw) {
    const since = new Date(sinceRaw);
    if (Number.isNaN(since.getTime())) {
      return errorResponse(c, 400, 'Invalid since timestamp');
    }
    conditions.push(
      gt(webhookDeliveries.createdAt, since) as unknown as ReturnType<typeof eq>,
    );
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(webhookDeliveries.error, pattern),
        ilike(webhookDeliveries.eventType, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(webhookDeliveries)
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      delivery: webhookDeliveries,
      webhookUrl: webhooks.url,
    })
    .from(webhookDeliveries)
    .leftJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(where)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
    .offset(offset);

  // Summary across the filtered set — gives operators the KPI matching their
  // current view. Keep it inexpensive: same where, single grouping pass.
  const [summaryRow] = await db
    .select({
      delivered_count: sql<number>`count(*) filter (where ${webhookDeliveries.success} = true)`,
      failed_count: sql<number>`count(*) filter (where ${webhookDeliveries.success} = false and ${webhookDeliveries.deadLetteredAt} is null)`,
      dead_lettered_count: sql<number>`count(*) filter (where ${webhookDeliveries.deadLetteredAt} is not null)`,
      avg_duration_ms: sql<number>`coalesce(avg(${webhookDeliveries.durationMs}), 0)`,
    })
    .from(webhookDeliveries)
    .where(where);

  function deriveStatus(d: typeof webhookDeliveries.$inferSelect): string {
    if (d.deadLetteredAt) return 'dead_lettered';
    if (d.success) return 'delivered';
    if (d.status === 'queued') return 'queued';
    return 'failed';
  }

  return c.json({
    total,
    deliveries: rows.map((r) => {
      const d = r.delivery;
      return {
        id: d.id,
        webhook_id: d.webhookId,
        webhook_url: r.webhookUrl ?? null,
        event_type: d.eventType,
        status: deriveStatus(d),
        status_code: d.statusCode ?? null,
        attempt: d.attempt,
        success: d.success,
        error: d.error ?? null,
        // Truncate the response body for the list endpoint — detail returns full.
        response_body: truncateResponseBody(d.responseBody, 1024),
        duration_ms: d.durationMs ?? null,
        created_at: d.createdAt.toISOString(),
        delivered_at: d.deliveredAt?.toISOString() ?? null,
        dead_lettered_at: d.deadLetteredAt?.toISOString() ?? null,
        last_attempt_at: d.lastAttemptAt?.toISOString() ?? null,
        next_attempt_at: d.nextAttemptAt?.toISOString() ?? null,
      };
    }),
    summary: {
      delivered_count: Number(summaryRow?.delivered_count ?? 0),
      failed_count: Number(summaryRow?.failed_count ?? 0),
      dead_lettered_count: Number(summaryRow?.dead_lettered_count ?? 0),
      avg_duration_ms: Math.round(Number(summaryRow?.avg_duration_ms ?? 0)),
    },
  });
});

// ─── GET /webhook-deliveries/:id — delivery detail incl. full payload ──────

adminWebhooksApp.get('/webhook-deliveries/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid delivery ID');
  }

  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      webhookUrl: webhooks.url,
      webhookActive: webhooks.active,
      webhookEvents: webhooks.events,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
      accountId: accounts.id,
    })
    .from(webhookDeliveries)
    .leftJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .leftJoin(users, eq(webhooks.ownerId, users.id))
    .leftJoin(accounts, eq(webhooks.accountId, accounts.id))
    .where(eq(webhookDeliveries.id, id));

  if (!row) {
    return errorResponse(c, 404, 'Webhook delivery not found');
  }

  const d = row.delivery;

  function deriveStatus(): string {
    if (d.deadLetteredAt) return 'dead_lettered';
    if (d.success) return 'delivered';
    if (d.status === 'queued') return 'queued';
    return 'failed';
  }

  return c.json({
    delivery: {
      id: d.id,
      webhook_id: d.webhookId,
      event_type: d.eventType,
      status: deriveStatus(),
      status_code: d.statusCode ?? null,
      // Full, unturncated payload + response body — detail view only.
      payload: d.payload,
      payload_version: d.payloadVersion,
      response_body: d.responseBody ?? null,
      duration_ms: d.durationMs ?? null,
      attempt: d.attempt,
      next_attempt_at: d.nextAttemptAt?.toISOString() ?? null,
      last_attempt_at: d.lastAttemptAt?.toISOString() ?? null,
      success: d.success,
      error: d.error ?? null,
      delivered_at: d.deliveredAt?.toISOString() ?? null,
      dead_lettered_at: d.deadLetteredAt?.toISOString() ?? null,
      created_at: d.createdAt.toISOString(),
    },
    webhook: {
      id: d.webhookId,
      url: row.webhookUrl ?? null,
      active: row.webhookActive ?? null,
      events: row.webhookEvents ?? [],
    },
    owner: row.ownerEmail || row.ownerName ? {
      email: row.ownerEmail ?? null,
      name: row.ownerName ?? null,
    } : null,
    account: row.accountId ? {
      id: row.accountId,
      name: row.accountName ?? null,
      slug: row.accountSlug ?? null,
      type: row.accountType ?? null,
    } : null,
  });
});
