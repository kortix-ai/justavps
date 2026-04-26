/**
 * Admin Machines — full CRUD + lifecycle control for the admin panel.
 *
 * This route lets operators list, inspect, create, rename, resize,
 * start/stop/reboot, and delete any machine across any account.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq, and, ne, ilike, sql, inArray, desc, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  machines,
  users,
  accounts,
  subscriptions,
  baremetalHosts,
  machineEvents,
  machineHeartbeatStates,
  machinePortAllocations,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse } from "@/server/core/route-helpers";
import { cleanupMachineResources } from "@/server/v1/services/machine-lifecycle";
import { getProvider } from "@/server/platform/providers/index";
import { HttpBaremetalRunnerClient } from "@/server/platform/baremetal/runner-client";

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

// ─── Serializers ────────────────────────────────────────────────────────────

type MachineRow = typeof machines.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;

function serializeAdminMachine(
  m: MachineRow,
  extra: {
    ownerEmail?: string | null;
    ownerName?: string | null;
    accountName?: string | null;
    accountSlug?: string | null;
    accountType?: string | null;
    subscription?: SubscriptionRow | null;
  } = {},
) {
  const heartbeat = m.lastHeartbeat && typeof m.lastHeartbeat === 'object' ? m.lastHeartbeat as Record<string, unknown> : null;
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
    public_ipv4: m.publicIpv4 ?? null,
    public_ipv6: m.publicIpv6 ?? null,
    ssh_port: m.sshPort ?? null,
    http_port: m.httpPort ?? null,
    source: m.source,
    kortix_sandbox_id: m.kortixSandboxId ?? null,
    price_monthly: m.priceMonthly ?? null,
    backups_enabled: m.backupsEnabled,
    provider_server_id: m.providerServerId ?? null,
    baremetal_host_id: m.baremetalHostId ?? null,
    daemon_version: m.daemonVersion ?? null,
    machine_mode: m.machineMode,
    api_version: m.apiVersion,
    vcpu: m.vcpu ?? null,
    memory_gb: m.ramGb ?? null,
    disk_gb: m.diskGb ?? null,
    domains: Array.isArray(m.domains) ? m.domains : [],
    created_at: m.createdAt.toISOString(),
    ready_at: m.readyAt?.toISOString() ?? null,
    deleted_at: m.deletedAt?.toISOString() ?? null,
    last_heartbeat_at: m.lastHeartbeatAt?.toISOString() ?? null,
    health: heartbeat ? {
      cpu: heartbeat.cpu ?? null,
      memory: heartbeat.memory ?? null,
      disk: heartbeat.disk ?? null,
    } : null,
    owner: {
      id: m.ownerId,
      email: extra.ownerEmail ?? null,
      name: extra.ownerName ?? null,
    },
    account: m.accountId ? {
      id: m.accountId,
      name: extra.accountName ?? null,
      slug: extra.accountSlug ?? null,
      type: extra.accountType ?? null,
    } : null,
    subscription: extra.subscription ? {
      status: extra.subscription.status,
      stripe_subscription_id: extra.subscription.stripeSubscriptionId,
      cancel_at_period_end: extra.subscription.cancelAtPeriodEnd,
      current_period_end: extra.subscription.currentPeriodEnd?.toISOString() ?? null,
    } : null,
  };
}

async function loadMachineWithJoins(id: string) {
  const [row] = await db
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
    .where(eq(machines.id, id));
  return row ?? null;
}

async function serializeFullMachineById(id: string) {
  const row = await loadMachineWithJoins(id);
  if (!row) return null;
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));
  return serializeAdminMachine(row.machine, {
    ownerEmail: row.ownerEmail,
    ownerName: row.ownerName,
    accountName: row.accountName,
    accountSlug: row.accountSlug,
    accountType: row.accountType,
    subscription: sub ?? null,
  });
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
    machines: rows.map((r) => serializeAdminMachine(r.machine, {
      ownerEmail: r.ownerEmail,
      ownerName: r.ownerName,
      accountName: r.accountName,
      accountSlug: r.accountSlug,
      accountType: r.accountType,
      subscription: subsByMachineId.get(r.machine.id) ?? null,
    })),
  });
});

// ─── GET /:id — Full machine detail (events, heartbeat, ports, host) ───────

adminMachinesApp.get('/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return errorResponse(c, 400, 'Invalid machine ID');
  }

  const row = await loadMachineWithJoins(id);
  if (!row) {
    return errorResponse(c, 404, 'Machine not found');
  }

  const machine = row.machine;

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));

  const recentEvents = await db
    .select()
    .from(machineEvents)
    .where(eq(machineEvents.machineId, id))
    .orderBy(desc(machineEvents.createdAt))
    .limit(50);

  const [heartbeat] = await db
    .select()
    .from(machineHeartbeatStates)
    .where(eq(machineHeartbeatStates.machineId, id));

  const portRows = await db
    .select()
    .from(machinePortAllocations)
    .where(eq(machinePortAllocations.machineId, id));

  let host: {
    id: string;
    name: string;
    region: string;
    location: string;
    public_ipv4: string | null;
  } | null = null;
  if (machine.baremetalHostId) {
    const [hostRow] = await db
      .select({
        id: baremetalHosts.id,
        name: baremetalHosts.name,
        region: baremetalHosts.region,
        location: baremetalHosts.location,
        publicIpv4: baremetalHosts.publicIpv4,
      })
      .from(baremetalHosts)
      .where(eq(baremetalHosts.id, machine.baremetalHostId));
    if (hostRow) {
      host = {
        id: hostRow.id,
        name: hostRow.name,
        region: hostRow.region,
        location: hostRow.location,
        public_ipv4: hostRow.publicIpv4 ?? null,
      };
    }
  }

  return c.json({
    machine: serializeAdminMachine(machine, {
      ownerEmail: row.ownerEmail,
      ownerName: row.ownerName,
      accountName: row.accountName,
      accountSlug: row.accountSlug,
      accountType: row.accountType,
      subscription: sub ?? null,
    }),
    events: recentEvents.map((ev) => ({
      id: ev.id,
      event: ev.event,
      stage: ev.stage ?? null,
      message: ev.message ?? null,
      metadata: ev.metadata ?? {},
      created_at: ev.createdAt.toISOString(),
    })),
    heartbeat: heartbeat ? {
      daemon_version: heartbeat.daemonVersion ?? null,
      last_heartbeat_at: heartbeat.lastHeartbeatAt?.toISOString() ?? null,
      last_projected_at: heartbeat.lastProjectedAt?.toISOString() ?? null,
      heartbeat_count: heartbeat.heartbeatCount,
      last_ready_at: heartbeat.lastReadyAt?.toISOString() ?? null,
      uptime_sec: heartbeat.uptimeSec ?? null,
      services: heartbeat.services ?? {},
      load: heartbeat.load ?? null,
      network: heartbeat.network ?? null,
      security: heartbeat.security ?? null,
      updated_at: heartbeat.updatedAt.toISOString(),
    } : null,
    port_allocations: portRows.map((p) => ({
      id: p.id,
      protocol: p.protocol,
      public_port: p.publicPort,
      target_port: p.targetPort,
      metadata: p.metadata ?? {},
      updated_at: p.updatedAt.toISOString(),
    })),
    host,
  });
});

// ─── POST / — Admin-on-behalf-of create ─────────────────────────────────────

const CreateMachineBodySchema = z.object({
  owner_user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
  name: z.string().min(1).max(64).optional(),
  region: z.string().min(1).default('eu'),
  vcpu: z.number().int().min(1).max(128),
  memory_gb: z.number().int().min(1).max(512),
  disk_gb: z.number().int().min(10).max(2000),
  image_ref: z.string().min(1).optional().nullable(),
  machine_mode: z.enum(['vm', 'container']).optional().default('container'),
});

adminMachinesApp.post('/', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const body = await c.req.json().catch(() => null);
  const parsed = CreateMachineBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, parsed.error.issues.map((i) => i.message).join('; '));
  }

  const input = parsed.data;

  // Resolve owner + account
  const [owner] = await db.select().from(users).where(eq(users.id, input.owner_user_id));
  if (!owner) {
    return errorResponse(c, 400, 'owner_user_id does not reference an existing user');
  }

  const accountId = input.account_id ?? owner.defaultAccountId;
  if (!accountId) {
    return errorResponse(c, 400, 'Could not determine an account for this user (pass account_id explicitly)');
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) {
    return errorResponse(c, 400, 'account_id does not reference an existing account');
  }

  void account;
  void input;

  return errorResponse(c, 410, 'Legacy in-Next V2 admin machine creation has been removed. Use the standalone apps/v2-api service.');
});

// ─── PATCH /:id — Rename + resize (rename is live, resize rejected) ────────

const UpdateMachineBodySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  vcpu: z.number().int().min(1).max(128).optional(),
  memory_gb: z.number().int().min(1).max(512).optional(),
  disk_gb: z.number().int().min(10).max(2000).optional(),
  backups_enabled: z.boolean().optional(),
});

adminMachinesApp.patch('/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid machine ID');
  }

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateMachineBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, parsed.error.issues.map((i) => i.message).join('; '));
  }

  const [machine] = await db.select().from(machines).where(eq(machines.id, id));
  if (!machine) {
    return errorResponse(c, 404, 'Machine not found');
  }

  const data = parsed.data;
  const wantsResize =
    (data.vcpu !== undefined && data.vcpu !== (machine.vcpu ?? data.vcpu))
    || (data.memory_gb !== undefined && data.memory_gb !== (machine.ramGb ?? data.memory_gb))
    || (data.disk_gb !== undefined && data.disk_gb !== (machine.diskGb ?? data.disk_gb));

  if (wantsResize) {
    return errorResponse(c, 400, 'Resize is not implemented — requires machine stop/start and capacity rebalance');
  }

  const updates: Partial<MachineRow> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.backups_enabled !== undefined) updates.backupsEnabled = data.backups_enabled;

  if (Object.keys(updates).length === 0) {
    const full = await serializeFullMachineById(id);
    return c.json({ machine: full });
  }

  await db.update(machines).set(updates).where(eq(machines.id, id));
  const full = await serializeFullMachineById(id);
  return c.json({ machine: full });
});

// ─── POST /:id/(start|stop|reboot) — Lifecycle actions via runner client ────

async function getRunnerClientForMachine(machine: MachineRow): Promise<
  | { runner: HttpBaremetalRunnerClient; instanceId: string }
  | { error: { status: number; message: string } }
> {
  const providerServerId = machine.providerServerId
    ?? (machine.provider === 'baremetal' ? `justavps-${machine.slug}` : null);

  if (!providerServerId) {
    return { error: { status: 400, message: 'Machine has no provider server ID' } };
  }

  if (machine.provider !== 'baremetal') {
    return { error: { status: 400, message: `Lifecycle control not supported for provider ${machine.provider}` } };
  }

  if (!machine.baremetalHostId) {
    return { error: { status: 400, message: 'Machine is not bound to a bare-metal host' } };
  }

  const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, machine.baremetalHostId));
  if (!host?.runnerBaseUrl || !host.runnerToken) {
    return { error: { status: 502, message: 'Runner is not configured for this host' } };
  }

  return {
    runner: new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken),
    instanceId: providerServerId,
  };
}

function runnerErrorResponse(c: Context<{ Variables: AuthVariables }>, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[ADMIN] Runner action failed:', message);
  return errorResponse(c, 502, `Runner unreachable: ${message}`);
}

async function handleLifecycleAction(
  c: Context<{ Variables: AuthVariables }>,
  action: 'start' | 'stop' | 'reboot',
) {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  const idCheck = z.string().uuid().safeParse(id);
  if (!idCheck.success) {
    return errorResponse(c, 400, 'Invalid machine ID');
  }

  const [machine] = await db.select().from(machines).where(eq(machines.id, idCheck.data));
  if (!machine) {
    return errorResponse(c, 404, 'Machine not found');
  }
  if (machine.status === 'deleted') {
    return errorResponse(c, 400, 'Machine is deleted');
  }

  const clientResult = await getRunnerClientForMachine(machine);
  if ('error' in clientResult) {
    return errorResponse(c, clientResult.error.status, clientResult.error.message);
  }

  const { runner, instanceId } = clientResult;

  try {
    if (action === 'start') {
      await runner.startInstance(instanceId);
      await db.update(machines).set({ status: 'ready' }).where(eq(machines.id, machine.id));
    } else if (action === 'stop') {
      await runner.stopInstance(instanceId);
      await db.update(machines).set({ status: 'stopped' }).where(eq(machines.id, machine.id));
    } else {
      await runner.rebootInstance(instanceId);
    }
  } catch (err) {
    return runnerErrorResponse(c, err);
  }

  const full = await serializeFullMachineById(machine.id);
  return c.json({ ok: true, machine: full });
}

adminMachinesApp.post('/:id/start', (c) => handleLifecycleAction(c, 'start'));
adminMachinesApp.post('/:id/stop', (c) => handleLifecycleAction(c, 'stop'));
adminMachinesApp.post('/:id/reboot', (c) => handleLifecycleAction(c, 'reboot'));

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
