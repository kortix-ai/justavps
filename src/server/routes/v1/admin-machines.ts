/**
 * Admin Machines — list all machines across all accounts with filtering,
 * and graceful delete (Hetzner server + DNS + KV + billing + DB).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq, and, ne, like, sql, inArray, desc, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { machines, users, accounts, subscriptions } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { errorResponse } from '../../lib/route-helpers';
import { cleanupMachineResources } from '../../lib/machine-lifecycle';
import { getProvider } from '../../lib/providers';

export const adminMachinesApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminMachinesApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
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
  const search = c.req.query('search'); // slug / name / IP search
  const includeDeleted = c.req.query('include_deleted') === 'true';
  const rawLimit = Number(c.req.query('limit') || '200');
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200, 500);
  const rawOffset = Number(c.req.query('offset') || '0');
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  // Build conditions
  const conditions = [];

  if (!includeDeleted) {
    conditions.push(ne(machines.status, 'deleted'));
  }
  if (status) {
    conditions.push(eq(machines.status, status));
  }
  if (source) {
    conditions.push(eq(machines.source, source));
  }
  if (accountId) {
    conditions.push(eq(machines.accountId, accountId));
  }
  if (userId) {
    conditions.push(eq(machines.ownerId, userId));
  }
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        like(machines.slug, pattern),
        like(machines.name, pattern),
        like(machines.ip, pattern),
        like(machines.kortixSandboxId, pattern),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total matching
  const [{ count: totalCount }] = await db.select({ count: sql<number>`count(*)` })
    .from(machines)
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

  // Status summary (always unfiltered)
  const statusCounts = await db
    .select({
      status: machines.status,
      count: sql<number>`count(*)`,
    })
    .from(machines)
    .groupBy(machines.status);
  const statusSummary: Record<string, number> = {};
  for (const row of statusCounts) {
    statusSummary[row.status] = Number(row.count);
  }

  // Source summary
  const sourceCounts = await db
    .select({
      source: machines.source,
      count: sql<number>`count(*)`,
    })
    .from(machines)
    .where(ne(machines.status, 'deleted'))
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
