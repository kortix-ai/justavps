/**
 * Admin Accounts / Users — admin-only listing + detail views for the
 * accounts-and-users admin page.
 *
 * Scope: who are our customers, what do they have, who's paying?
 * Everything here is admin-guarded, read-only, and masks secret fields.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, gt, ilike, inArray, isNull, or, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  users,
  accounts,
  accountMemberships,
  accountInvitations,
  machines,
  subscriptions,
  sshKeys,
  apiKeys,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse } from "@/server/core/route-helpers";

export const adminAccountsApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminAccountsApp.use('*', apiGuard);

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

// ─── GET /accounts — list accounts with aggregates ─────────────────────────

adminAccountsApp.get('/accounts', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const type = c.req.query('type');
  const includeDeleted = c.req.query('include_deleted') === 'true';
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions = [] as ReturnType<typeof eq>[];
  if (!includeDeleted) {
    conditions.push(isNull(accounts.deletedAt) as unknown as ReturnType<typeof eq>);
  }
  if (type && type !== 'all') {
    conditions.push(eq(accounts.type, type as 'personal' | 'organization'));
  }
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(accounts.name, pattern),
        ilike(accounts.slug, pattern),
        ilike(sql`cast(${accounts.id} as text)`, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total matching
  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(accounts)
    .where(where);
  const total = Number(totalRow[0]?.count ?? 0);

  // Fetch page of accounts
  const accountRows = await db
    .select()
    .from(accounts)
    .where(where)
    .orderBy(desc(accounts.createdAt))
    .limit(limit)
    .offset(offset);

  const accountIds = accountRows.map((r) => r.id);

  // Aggregate member counts
  const memberCountsMap = new Map<string, number>();
  if (accountIds.length > 0) {
    const memberCountRows = await db
      .select({
        accountId: accountMemberships.accountId,
        count: sql<number>`count(*)`,
      })
      .from(accountMemberships)
      .where(inArray(accountMemberships.accountId, accountIds))
      .groupBy(accountMemberships.accountId);
    for (const row of memberCountRows) {
      memberCountsMap.set(row.accountId, Number(row.count));
    }
  }

  // Aggregate machine counts (non-deleted) + MRR estimate
  const machineAggsMap = new Map<string, { count: number; priceSum: number }>();
  if (accountIds.length > 0) {
    const machineAggRows = await db
      .select({
        accountId: machines.accountId,
        count: sql<number>`count(*)`,
        priceSum: sql<number>`coalesce(sum(${machines.priceMonthly}), 0)`,
      })
      .from(machines)
      .where(
        and(
          inArray(machines.accountId, accountIds),
          sql`${machines.status} not in ('deleted', 'error')`,
        ),
      )
      .groupBy(machines.accountId);
    for (const row of machineAggRows) {
      if (row.accountId) {
        machineAggsMap.set(row.accountId, {
          count: Number(row.count),
          priceSum: Number(row.priceSum),
        });
      }
    }
  }

  // Aggregate active subscription counts
  const subCountsMap = new Map<string, number>();
  if (accountIds.length > 0) {
    const subCountRows = await db
      .select({
        accountId: subscriptions.accountId,
        count: sql<number>`count(*)`,
      })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.accountId, accountIds),
          eq(subscriptions.status, 'active'),
        ),
      )
      .groupBy(subscriptions.accountId);
    for (const row of subCountRows) {
      if (row.accountId) {
        subCountsMap.set(row.accountId, Number(row.count));
      }
    }
  }

  // Summary across ALL accounts (ignore pagination + q/type filters so KPIs
  // reflect the full fleet; but still respect include_deleted to avoid
  // counting orphaned tombstones).
  const summaryWhere = includeDeleted ? undefined : isNull(accounts.deletedAt);

  const [personalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(accounts)
    .where(
      summaryWhere
        ? and(summaryWhere, eq(accounts.type, 'personal'))
        : eq(accounts.type, 'personal'),
    );
  const [orgRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(accounts)
    .where(
      summaryWhere
        ? and(summaryWhere, eq(accounts.type, 'organization'))
        : eq(accounts.type, 'organization'),
    );
  const [totalMembersRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(accountMemberships);
  const [totalMachinesRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(machines)
    .where(sql`${machines.status} not in ('deleted', 'error')`);

  return c.json({
    total,
    accounts: accountRows.map((a) => {
      const machineAggs = machineAggsMap.get(a.id) ?? { count: 0, priceSum: 0 };
      return {
        id: a.id,
        name: a.name,
        slug: a.slug,
        type: a.type,
        billing_email: a.billingEmail ?? null,
        created_at: a.createdAt.toISOString(),
        deleted_at: a.deletedAt?.toISOString() ?? null,
        member_count: memberCountsMap.get(a.id) ?? 0,
        machine_count: machineAggs.count,
        active_subscription_count: subCountsMap.get(a.id) ?? 0,
        // price_monthly is already in USD; multiply by 100 to report cents.
        mrr_cents: machineAggs.priceSum * 100,
      };
    }),
    summary: {
      personal_count: Number(personalRow?.count ?? 0),
      org_count: Number(orgRow?.count ?? 0),
      total_members: Number(totalMembersRow?.count ?? 0),
      total_machines: Number(totalMachinesRow?.count ?? 0),
    },
  });
});

// ─── GET /accounts/:id — account detail ────────────────────────────────────

adminAccountsApp.get('/accounts/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return errorResponse(c, 400, 'Invalid account ID');
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!account) {
    return errorResponse(c, 404, 'Account not found');
  }

  // Members (with user details)
  const memberRows = await db
    .select({
      id: accountMemberships.id,
      userId: accountMemberships.userId,
      role: accountMemberships.role,
      createdAt: accountMemberships.createdAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(accountMemberships)
    .leftJoin(users, eq(accountMemberships.userId, users.id))
    .where(eq(accountMemberships.accountId, id))
    .orderBy(desc(accountMemberships.createdAt));

  const memberUserIds = memberRows.map((m) => m.userId);

  // Machines (non-deleted)
  const machineRows = await db
    .select()
    .from(machines)
    .where(
      and(
        eq(machines.accountId, id),
        sql`${machines.status} <> 'deleted'`,
      ),
    )
    .orderBy(desc(machines.createdAt));

  // Active subscriptions (joined via machine.accountId == accountId)
  const subRows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.accountId, id),
        eq(subscriptions.status, 'active'),
      ),
    )
    .orderBy(desc(subscriptions.createdAt));

  // Pending invitations: not accepted, not revoked, not expired
  const invitationRows = await db
    .select({
      id: accountInvitations.id,
      email: accountInvitations.email,
      role: accountInvitations.role,
      invitedByUserId: accountInvitations.invitedByUserId,
      expiresAt: accountInvitations.expiresAt,
      createdAt: accountInvitations.createdAt,
      invitedByEmail: users.email,
      invitedByName: users.name,
    })
    .from(accountInvitations)
    .leftJoin(users, eq(accountInvitations.invitedByUserId, users.id))
    .where(
      and(
        eq(accountInvitations.accountId, id),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.revokedAt),
        gt(accountInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(accountInvitations.createdAt));

  // SSH keys (scoped to this account OR owned by a member with no explicit account)
  let sshKeyRows: Array<typeof sshKeys.$inferSelect> = [];
  if (memberUserIds.length > 0) {
    sshKeyRows = await db
      .select()
      .from(sshKeys)
      .where(
        or(
          eq(sshKeys.accountId, id),
          and(
            inArray(sshKeys.ownerId, memberUserIds),
            isNull(sshKeys.accountId),
          ),
        )!,
      )
      .orderBy(desc(sshKeys.createdAt));
  } else {
    sshKeyRows = await db
      .select()
      .from(sshKeys)
      .where(eq(sshKeys.accountId, id))
      .orderBy(desc(sshKeys.createdAt));
  }

  return c.json({
    account: {
      id: account.id,
      name: account.name,
      slug: account.slug,
      type: account.type,
      billing_email: account.billingEmail ?? null,
      stripe_customer_id: account.stripeCustomerId ?? null,
      personal_for_user_id: account.personalForUserId ?? null,
      created_at: account.createdAt.toISOString(),
      updated_at: account.updatedAt.toISOString(),
      deleted_at: account.deletedAt?.toISOString() ?? null,
    },
    members: memberRows.map((m) => ({
      user_id: m.userId,
      email: m.userEmail ?? null,
      name: m.userName ?? null,
      role: m.role,
      created_at: m.createdAt.toISOString(),
    })),
    machines: machineRows.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      status: m.status,
      region: m.region,
      server_type: m.serverType,
      price_monthly: m.priceMonthly ?? null,
      created_at: m.createdAt.toISOString(),
    })),
    subscriptions: subRows.map((s) => ({
      id: s.id,
      machine_id: s.machineId,
      stripe_subscription_id: s.stripeSubscriptionId,
      stripe_price_id: s.stripePriceId ?? null,
      status: s.status,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      current_period_end: s.currentPeriodEnd?.toISOString() ?? null,
      cancel_at: s.cancelAt?.toISOString() ?? null,
    })),
    invitations: invitationRows.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      invited_by_user_id: inv.invitedByUserId,
      invited_by_email: inv.invitedByEmail ?? null,
      invited_by_name: inv.invitedByName ?? null,
      expires_at: inv.expiresAt.toISOString(),
      created_at: inv.createdAt.toISOString(),
    })),
    ssh_keys: sshKeyRows.map((k) => ({
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
      owner_id: k.ownerId,
      account_id: k.accountId ?? null,
      created_at: k.createdAt.toISOString(),
    })),
  });
});

// ─── GET /users — list users (typeahead + rich pagination) ─────────────────
//
// Backward-compatible: when called with only ?q= (no limit/offset params)
// we still return the typeahead shape (users with default-account info).
// When limit/offset/has_machines are provided we return the richer shape
// with aggregates.

adminAccountsApp.get('/users', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || c.req.query('search') || '').trim();
  const rawLimit = c.req.query('limit');
  const rawOffset = c.req.query('offset');
  const hasMachinesFilter = c.req.query('has_machines') === 'true';

  // Typeahead mode: no pagination, no has_machines — keep legacy behaviour.
  const isTypeahead =
    rawLimit === undefined
    && rawOffset === undefined
    && !hasMachinesFilter;

  if (isTypeahead) {
    const baseQuery = db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        defaultAccountId: users.defaultAccountId,
        accountId: accounts.id,
        accountName: accounts.name,
        accountSlug: accounts.slug,
        accountType: accounts.type,
      })
      .from(users)
      .leftJoin(accounts, eq(users.defaultAccountId, accounts.id));

    const rows = q.length >= 1
      ? await baseQuery
          .where(
            or(
              ilike(users.email, `%${q}%`),
              ilike(users.name, `%${q}%`),
              ilike(sql`cast(${users.id} as text)`, `%${q}%`),
            )!,
          )
          .limit(20)
      : await baseQuery.limit(20);

    return c.json({
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        default_account_id: r.defaultAccountId,
        account: r.accountId ? {
          id: r.accountId,
          name: r.accountName,
          slug: r.accountSlug,
          type: r.accountType,
        } : null,
      })),
    });
  }

  const limit = parseLimit(rawLimit, 100);
  const offset = parseOffset(rawOffset);

  // Base filter: q search on email/name/id
  const conditions = [] as ReturnType<typeof eq>[];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(users.email, pattern),
        ilike(users.name, pattern),
        ilike(sql`cast(${users.id} as text)`, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }
  const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;

  // If has_machines filter applied, restrict to owners with at least one
  // non-deleted machine via a subquery.
  let finalWhere = baseWhere;
  if (hasMachinesFilter) {
    const machineOwnersSub = db
      .select({ ownerId: machines.ownerId })
      .from(machines)
      .where(sql`${machines.status} <> 'deleted'`);
    const hasMachineCond = inArray(users.id, machineOwnersSub);
    finalWhere = baseWhere ? and(baseWhere, hasMachineCond) : hasMachineCond;
  }

  // Count total
  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(finalWhere);
  const total = Number(totalRow[0]?.count ?? 0);

  // Fetch page
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      defaultAccountId: users.defaultAccountId,
      createdAt: users.createdAt,
      accountId: accounts.id,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(users)
    .leftJoin(accounts, eq(users.defaultAccountId, accounts.id))
    .where(finalWhere)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  const userIds = userRows.map((u) => u.id);

  // Aggregate machine counts + last created
  const machineAggsMap = new Map<string, { count: number; lastCreatedAt: Date | null }>();
  if (userIds.length > 0) {
    const machineAggRows = await db
      .select({
        ownerId: machines.ownerId,
        count: sql<number>`count(*)`,
        lastCreatedAt: sql<Date | null>`max(${machines.createdAt})`,
      })
      .from(machines)
      .where(
        and(
          inArray(machines.ownerId, userIds),
          sql`${machines.status} <> 'deleted'`,
        ),
      )
      .groupBy(machines.ownerId);
    for (const row of machineAggRows) {
      machineAggsMap.set(row.ownerId, {
        count: Number(row.count),
        lastCreatedAt: row.lastCreatedAt ? new Date(row.lastCreatedAt as unknown as string) : null,
      });
    }
  }

  // Aggregate active subscription counts
  const subCountsMap = new Map<string, number>();
  if (userIds.length > 0) {
    const subCountRows = await db
      .select({
        ownerId: subscriptions.ownerId,
        count: sql<number>`count(*)`,
      })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.ownerId, userIds),
          eq(subscriptions.status, 'active'),
        ),
      )
      .groupBy(subscriptions.ownerId);
    for (const row of subCountRows) {
      subCountsMap.set(row.ownerId, Number(row.count));
    }
  }

  return c.json({
    total,
    users: userRows.map((r) => {
      const aggs = machineAggsMap.get(r.id) ?? { count: 0, lastCreatedAt: null };
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        is_admin: r.isAdmin,
        default_account_id: r.defaultAccountId,
        created_at: r.createdAt.toISOString(),
        account: r.accountId ? {
          id: r.accountId,
          name: r.accountName,
          slug: r.accountSlug,
          type: r.accountType,
        } : null,
        machine_count: aggs.count,
        active_subscription_count: subCountsMap.get(r.id) ?? 0,
        last_machine_created_at: aggs.lastCreatedAt
          ? aggs.lastCreatedAt.toISOString()
          : null,
      };
    }),
  });
});

// ─── GET /users/:id — user detail ──────────────────────────────────────────

adminAccountsApp.get('/users/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return errorResponse(c, 400, 'Invalid user ID');
  }

  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) {
    return errorResponse(c, 404, 'User not found');
  }

  // Memberships — which accounts does this user belong to
  const memberships = await db
    .select({
      id: accountMemberships.id,
      accountId: accountMemberships.accountId,
      role: accountMemberships.role,
      createdAt: accountMemberships.createdAt,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(accountMemberships)
    .leftJoin(accounts, eq(accountMemberships.accountId, accounts.id))
    .where(eq(accountMemberships.userId, id))
    .orderBy(desc(accountMemberships.createdAt));

  // Machines they own (non-deleted)
  const machineRows = await db
    .select()
    .from(machines)
    .where(
      and(
        eq(machines.ownerId, id),
        sql`${machines.status} <> 'deleted'`,
      ),
    )
    .orderBy(desc(machines.createdAt));

  // Active subscriptions they own
  const subRows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.ownerId, id),
        eq(subscriptions.status, 'active'),
      ),
    )
    .orderBy(desc(subscriptions.createdAt));

  // SSH keys
  const sshKeyRows = await db
    .select()
    .from(sshKeys)
    .where(eq(sshKeys.ownerId, id))
    .orderBy(desc(sshKeys.createdAt));

  // API keys (masked — never expose key_hash / key_sha256)
  const apiKeyRows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scope: apiKeys.scope,
      permissions: apiKeys.permissions,
      accountId: apiKeys.accountId,
      machineIds: apiKeys.machineIds,
      expiresAt: apiKeys.expiresAt,
      lastUsed: apiKeys.lastUsed,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.ownerId, id))
    .orderBy(desc(apiKeys.createdAt));

  return c.json({
    // Explicit projection — DO NOT include passwordHash / github tokens here.
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      email_verified: user.emailVerified?.toISOString() ?? null,
      is_admin: user.isAdmin,
      default_account_id: user.defaultAccountId ?? null,
      stripe_customer_id: user.stripeCustomerId ?? null,
      github_id: user.githubId ?? null,
      created_at: user.createdAt.toISOString(),
    },
    memberships: memberships.map((m) => ({
      account_id: m.accountId,
      account_name: m.accountName ?? null,
      account_slug: m.accountSlug ?? null,
      account_type: m.accountType ?? null,
      role: m.role,
      created_at: m.createdAt.toISOString(),
    })),
    machines: machineRows.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      status: m.status,
      region: m.region,
      server_type: m.serverType,
      price_monthly: m.priceMonthly ?? null,
      account_id: m.accountId ?? null,
      created_at: m.createdAt.toISOString(),
    })),
    subscriptions: subRows.map((s) => ({
      id: s.id,
      machine_id: s.machineId,
      stripe_subscription_id: s.stripeSubscriptionId,
      stripe_price_id: s.stripePriceId ?? null,
      status: s.status,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      current_period_end: s.currentPeriodEnd?.toISOString() ?? null,
      cancel_at: s.cancelAt?.toISOString() ?? null,
    })),
    ssh_keys: sshKeyRows.map((k) => ({
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
      account_id: k.accountId ?? null,
      created_at: k.createdAt.toISOString(),
    })),
    api_keys: apiKeyRows.map((k) => ({
      id: k.id,
      name: k.name,
      // Only the prefix is ever returned; never the full key, hash, or sha.
      key_prefix: k.keyPrefix,
      scope: k.scope,
      permissions: k.permissions,
      account_id: k.accountId ?? null,
      machine_ids: k.machineIds ?? null,
      expires_at: k.expiresAt?.toISOString() ?? null,
      last_used: k.lastUsed?.toISOString() ?? null,
      created_at: k.createdAt.toISOString(),
    })),
  });
});

