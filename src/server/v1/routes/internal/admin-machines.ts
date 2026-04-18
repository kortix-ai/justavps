/**
 * Admin Machines — list all machines across all accounts with filtering,
 * and graceful delete (Hetzner server + DNS + KV + billing + DB).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq, and, ne, ilike, sql, inArray, desc, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import { machines, users, accounts, subscriptions } from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse } from "@/server/core/route-helpers";
import { cleanupMachineResources } from "@/server/v1/services/machine-lifecycle";
import { getProvider } from "@/server/platform/providers/index";

export const adminMachinesApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminMachinesApp.use('*', apiGuard);

type ListFilters = {
  status?: string;
  source?: string;
  accountId?: string;
  userId?: string;
  ownerQuery?: string;
  accountQuery?: string;
  accountType?: string;
  search?: string;
  includeDeleted: boolean;
};

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
}

function buildMachineConditions(filters: ListFilters, options?: { exclude?: Array<keyof ListFilters> }) {
  const exclude = new Set(options?.exclude ?? []);
  const conditions: SQL<unknown>[] = [];

  if (!filters.includeDeleted && !exclude.has('includeDeleted')) {
    conditions.push(ne(machines.status, 'deleted'));
  }
  if (filters.status && !exclude.has('status')) {
    conditions.push(eq(machines.status, filters.status));
  }
  if (filters.source && !exclude.has('source')) {
    conditions.push(eq(machines.source, filters.source));
  }
  if (filters.accountId && !exclude.has('accountId')) {
    conditions.push(eq(machines.accountId, filters.accountId));
  }
  if (filters.userId && !exclude.has('userId')) {
    conditions.push(eq(machines.ownerId, filters.userId));
  }
  if (filters.ownerQuery && !exclude.has('ownerQuery')) {
    const pattern = `%${filters.ownerQuery}%`;
    conditions.push(
      or(
        ilike(users.email, pattern),
        ilike(users.name, pattern),
        ilike(sql`cast(${machines.ownerId} as text)`, pattern),
      )!,
    );
  }
  if (filters.accountQuery && !exclude.has('accountQuery')) {
    const pattern = `%${filters.accountQuery}%`;
    conditions.push(
      or(
        ilike(accounts.name, pattern),
        ilike(accounts.slug, pattern),
        ilike(sql`cast(${machines.accountId} as text)`, pattern),
      )!,
    );
  }
  if (filters.accountType && !exclude.has('accountType')) {
    conditions.push(eq(accounts.type, filters.accountType as 'personal' | 'organization'));
  }
  if (filters.search && !exclude.has('search')) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(machines.slug, pattern),
        ilike(machines.name, pattern),
        ilike(machines.ip, pattern),
        ilike(machines.kortixSandboxId, pattern),
        ilike(users.email, pattern),
        ilike(users.name, pattern),
        ilike(accounts.name, pattern),
        ilike(accounts.slug, pattern),
        ilike(sql`cast(${machines.ownerId} as text)`, pattern),
        ilike(sql`cast(${machines.accountId} as text)`, pattern),
      )!,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ─── GET / — List all machines (admin view, with joins + filters) ───────────

adminMachinesApp.get('/', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  // Query params for filtering
  const status = c.req.query('status'); // provisioning | ready | error | stopped | deleted
  const source = c.req.query('source'); // user | kortix
  const accountId = c.req.query('account_id');
  const userId = c.req.query('user_id');
  const ownerQuery = c.req.query('owner_query');
  const accountQuery = c.req.query('account_query');
  const accountType = c.req.query('account_type'); // personal | organization
  const search = c.req.query('search'); // machine / owner / account search
  const includeDeleted = c.req.query('include_deleted') === 'true';
  const rawLimit = Number(c.req.query('limit') || '200');
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200, 500);
  const rawOffset = Number(c.req.query('offset') || '0');
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const filters: ListFilters = {
    status: status || undefined,
    source: source || undefined,
    accountId: accountId || undefined,
    userId: userId || undefined,
    ownerQuery: ownerQuery || undefined,
    accountQuery: accountQuery || undefined,
    accountType: accountType || undefined,
    search: search || undefined,
    includeDeleted,
  };

  const where = buildMachineConditions(filters);
  const statusWhere = buildMachineConditions(filters, { exclude: ['status', 'includeDeleted'] });
  const sourceWhere = buildMachineConditions(filters, { exclude: ['source'] });

  // Count total matching
  const [{ count: totalCount }] = await db.select({ count: sql<number>`count(*)` })
    .from(machines)
    .leftJoin(users, eq(machines.ownerId, users.id))
    .leftJoin(accounts, eq(machines.accountId, accounts.id))
    .where(where);

  // Fetch rows with owner + account info
  const rows = await db
    .select({
      machine: machines,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(machines)
    .leftJoin(users, eq(machines.ownerId, users.id))
    .leftJoin(accounts, eq(machines.accountId, accounts.id))
    .where(where)
    .orderBy(desc(machines.createdAt))
    .limit(limit)
    .offset(offset);

  // Batch-fetch subscriptions
  const machineIds = rows.map((r) => r.machine.id);
  const subs = machineIds.length
    ? await db.select().from(subscriptions).where(inArray(subscriptions.machineId, machineIds))
    : [];
  const subsByMachineId = new Map(subs.map((s) => [s.machineId, s]));

  // Status summary within current scope, excluding status itself
  const statusCounts = await db
    .select({
      status: machines.status,
      count: sql<number>`count(*)`,
    })
    .from(machines)
    .leftJoin(users, eq(machines.ownerId, users.id))
    .leftJoin(accounts, eq(machines.accountId, accounts.id))
    .where(statusWhere)
    .groupBy(machines.status);
  const statusSummary: Record<string, number> = {};
  for (const row of statusCounts) {
    statusSummary[row.status] = Number(row.count);
  }

  // Source summary within current scope, excluding source itself
  const sourceCounts = await db
    .select({
      source: machines.source,
      count: sql<number>`count(*)`,
    })
    .from(machines)
    .leftJoin(users, eq(machines.ownerId, users.id))
    .leftJoin(accounts, eq(machines.accountId, accounts.id))
    .where(sourceWhere)
    .groupBy(machines.source);
  const sourceSummary: Record<string, number> = {};
  for (const row of sourceCounts) {
    sourceSummary[row.source] = Number(row.count);
  }

  return c.json({
    total: Number(totalCount),
    limit,
    offset,
    summary: {
      by_status: statusSummary,
      by_source: sourceSummary,
    },
    machines: rows.map((r) => {
      const m = r.machine;
      const sub = subsByMachineId.get(m.id);
      return {
        id: m.id,
        slug: m.slug,
        name: m.name,
        status: m.status,
        provisioning_stage: m.provisioningStage ?? null,
        provider: m.provider,
        server_type: m.serverType,
        region: m.region,
        ip: m.ip,
        source: m.source,
        kortix_sandbox_id: m.kortixSandboxId ?? null,
        price_monthly: m.priceMonthly ?? null,
        backups_enabled: m.backupsEnabled,
        provider_server_id: m.providerServerId ?? null,
        daemon_version: m.daemonVersion ?? null,
        created_at: m.createdAt.toISOString(),
        ready_at: m.readyAt?.toISOString() ?? null,
        deleted_at: m.deletedAt?.toISOString() ?? null,
        last_heartbeat_at: m.lastHeartbeatAt?.toISOString() ?? null,
        health: m.lastHeartbeat && typeof m.lastHeartbeat === 'object' ? {
          cpu: (m.lastHeartbeat as Record<string, unknown>).cpu ?? null,
          memory: (m.lastHeartbeat as Record<string, unknown>).memory ?? null,
          disk: (m.lastHeartbeat as Record<string, unknown>).disk ?? null,
        } : null,
        owner: {
          id: m.ownerId,
          email: r.ownerEmail ?? null,
          name: r.ownerName ?? null,
        },
        account: m.accountId ? {
          id: m.accountId,
          name: r.accountName ?? null,
          slug: r.accountSlug ?? null,
          type: r.accountType ?? null,
        } : null,
        subscription: sub ? {
          status: sub.status,
          stripe_subscription_id: sub.stripeSubscriptionId,
          cancel_at_period_end: sub.cancelAtPeriodEnd,
          current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
        } : null,
      };
    }),
  });
});

// ─── DELETE /:id — Graceful admin delete (full cleanup) ─────────────────────

adminMachinesApp.delete('/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return errorResponse(c, 400, 'Invalid machine ID');
  }

  const [machine] = await db.select().from(machines).where(eq(machines.id, id));
  if (!machine) {
    return errorResponse(c, 404, 'Machine not found');
  }

  if (machine.status === 'deleted') {
    return errorResponse(c, 400, 'Machine is already deleted');
  }

  try {
    const provider = getProvider(machine.provider);
    await cleanupMachineResources(machine, provider);
    return c.json({
      ok: true,
      message: `Machine ${machine.slug} deleted gracefully`,
      machine_id: machine.id,
      slug: machine.slug,
      provider_server_id: machine.providerServerId ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ADMIN] Failed to delete machine ${machine.slug}:`, message);
    return errorResponse(c, 500, `Delete failed: ${message}`);
  }
});

// ─── POST /batch-delete — Batch graceful delete ─────────────────────────────

adminMachinesApp.post('/batch-delete', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    machine_ids: z.array(z.string().uuid()).min(1).max(50),
  }).safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, 400, 'machine_ids is required (array of UUIDs, max 50)');
  }

  const rows = await db.select().from(machines).where(
    and(
      inArray(machines.id, parsed.data.machine_ids),
      ne(machines.status, 'deleted'),
    ),
  );

  const results: Array<{ machine_id: string; slug: string; ok: boolean; error?: string }> = [];

  for (const machine of rows) {
    try {
      const provider = getProvider(machine.provider);
      await cleanupMachineResources(machine, provider);
      results.push({ machine_id: machine.id, slug: machine.slug, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ADMIN] Failed to batch-delete machine ${machine.slug}:`, message);
      results.push({ machine_id: machine.id, slug: machine.slug, ok: false, error: message });
    }
  }

  return c.json({
    ok: results.every((r) => r.ok),
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});
