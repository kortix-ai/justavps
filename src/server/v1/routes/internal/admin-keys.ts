/**
 * Admin Keys & Security — admin-only fleet-wide views of every credential that
 * can unlock platform access: SSH keys, API keys, proxy tokens.
 *
 * Scope: operator audit + targeted revoke. Mirrors the apiGuard + requireAdmin
 * pattern of `admin-images.ts` / `admin-webhooks.ts`.
 *
 * A single OpenAPIHono app serves BOTH `/ssh-keys`, `/api-keys`, and
 * `/proxy-tokens`; in `routes/index.ts` we mount this under `/admin` so final
 * paths are `/api/v1/admin/ssh-keys`, `/api/v1/admin/api-keys`,
 * `/api/v1/admin/proxy-tokens`.
 *
 * Safety invariants (enforced throughout):
 *  - Secret material is NEVER returned. That means: no keyHash, no keySha256,
 *    no tokenHash, no tokenSha256 in any response (list or detail). Prefixes
 *    only.
 *  - The full SSH `public_key` string is only returned on the detail endpoint
 *    (too large + noisy for a list row).
 *  - ssh_keys and api_keys are hard-deleted (no soft-delete column on either
 *    table). Proxy tokens use `revokedAt` as the terminal state — we expose
 *    revoke but not delete, so the audit trail survives.
 *  - Revoke is idempotent: re-revoking returns the existing revoked_at
 *    unchanged.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, ilike, or, sql, desc, isNotNull, isNull, lt, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  sshKeys,
  apiKeys,
  proxyTokens,
  users,
  accounts,
  machines,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from '@/server/auth/api-guard';
import { errorResponse } from '@/server/core/route-helpers';

export const adminKeysApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminKeysApp.use('*', apiGuard);

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

// ═══════════════════════════════════════════════════════════════════════════
// SSH KEYS
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /ssh-keys — list SSH keys (no public_key in rows) ─────────────────

adminKeysApp.get('/ssh-keys', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const ownerUserId = c.req.query('owner_user_id');
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (ownerUserId) {
    if (!z.string().uuid().safeParse(ownerUserId).success) {
      return errorResponse(c, 400, 'Invalid owner_user_id');
    }
    conditions.push(eq(sshKeys.ownerId, ownerUserId));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(sshKeys.name, pattern),
        ilike(sshKeys.fingerprint, pattern),
        ilike(users.email, pattern),
        ilike(accounts.name, pattern),
        ilike(accounts.slug, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sshKeys)
    .leftJoin(users, eq(sshKeys.ownerId, users.id))
    .leftJoin(accounts, eq(sshKeys.accountId, accounts.id))
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  // Row projection — explicitly avoids `public_key` (large; detail-only).
  const rows = await db
    .select({
      id: sshKeys.id,
      name: sshKeys.name,
      fingerprint: sshKeys.fingerprint,
      providerKeyId: sshKeys.providerKeyId,
      createdAt: sshKeys.createdAt,
      ownerId: sshKeys.ownerId,
      accountId: sshKeys.accountId,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(sshKeys)
    .leftJoin(users, eq(sshKeys.ownerId, users.id))
    .leftJoin(accounts, eq(sshKeys.accountId, accounts.id))
    .where(where)
    .orderBy(desc(sshKeys.createdAt))
    .limit(limit)
    .offset(offset);

  // Summary across ALL ssh_keys (ignore q/filter so KPIs reflect fleet state).
  const [summaryRow] = await db
    .select({
      total: sql<number>`count(*)`,
      with_provider_id: sql<number>`count(*) filter (where ${sshKeys.providerKeyId} is not null)`,
      without_provider_id: sql<number>`count(*) filter (where ${sshKeys.providerKeyId} is null)`,
      last_7d: sql<number>`count(*) filter (where ${sshKeys.createdAt} > now() - interval '7 days')`,
    })
    .from(sshKeys);

  return c.json({
    total,
    keys: rows.map((r) => ({
      id: r.id,
      name: r.name,
      fingerprint: r.fingerprint,
      provider_key_id: r.providerKeyId ?? null,
      created_at: r.createdAt.toISOString(),
      owner: {
        id: r.ownerId,
        email: r.ownerEmail ?? null,
        name: r.ownerName ?? null,
      },
      account: r.accountId ? {
        id: r.accountId,
        name: r.accountName ?? null,
        slug: r.accountSlug ?? null,
        type: r.accountType ?? null,
      } : null,
    })),
    summary: {
      total: Number(summaryRow?.total ?? 0),
      with_provider_id: Number(summaryRow?.with_provider_id ?? 0),
      without_provider_id: Number(summaryRow?.without_provider_id ?? 0),
      last_7d: Number(summaryRow?.last_7d ?? 0),
    },
  });
});

// ─── GET /ssh-keys/:id — detail (includes full public_key) ─────────────────

adminKeysApp.get('/ssh-keys/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid SSH key ID');
  }

  const [row] = await db
    .select({
      key: sshKeys,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(sshKeys)
    .leftJoin(users, eq(sshKeys.ownerId, users.id))
    .leftJoin(accounts, eq(sshKeys.accountId, accounts.id))
    .where(eq(sshKeys.id, id));

  if (!row) {
    return errorResponse(c, 404, 'SSH key not found');
  }

  const k = row.key;

  return c.json({
    key: {
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
      // Full public key text is safe to expose to admins and is the whole
      // point of the detail view.
      public_key: k.publicKey,
      provider_key_id: k.providerKeyId ?? null,
      created_at: k.createdAt.toISOString(),
    },
    owner: {
      id: k.ownerId,
      email: row.ownerEmail ?? null,
      name: row.ownerName ?? null,
    },
    account: k.accountId ? {
      id: k.accountId,
      name: row.accountName ?? null,
      slug: row.accountSlug ?? null,
      type: row.accountType ?? null,
    } : null,
  });
});

// ─── DELETE /ssh-keys/:id — hard delete ─────────────────────────────────────

adminKeysApp.delete('/ssh-keys/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid SSH key ID');
  }

  const [existing] = await db.select({ id: sshKeys.id }).from(sshKeys).where(eq(sshKeys.id, id));
  if (!existing) {
    return errorResponse(c, 404, 'SSH key not found');
  }

  await db.delete(sshKeys).where(eq(sshKeys.id, id));

  return c.json({ ok: true, deleted_id: id });
});

// ═══════════════════════════════════════════════════════════════════════════
// API KEYS
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /api-keys — list (hashes masked, never returned) ──────────────────

adminKeysApp.get('/api-keys', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const scope = c.req.query('scope'); // account | machine | all
  const expired = c.req.query('expired'); // true | false | all
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (scope && scope !== 'all') {
    if (scope !== 'account' && scope !== 'machine') {
      return errorResponse(c, 400, 'Invalid scope');
    }
    conditions.push(eq(apiKeys.scope, scope));
  }

  const now = new Date();
  if (expired === 'true') {
    conditions.push(
      and(
        isNotNull(apiKeys.expiresAt),
        lt(apiKeys.expiresAt, now),
      )! as unknown as ReturnType<typeof eq>,
    );
  } else if (expired === 'false') {
    // active = no expiry OR expiresAt in the future
    conditions.push(
      or(
        isNull(apiKeys.expiresAt),
        gt(apiKeys.expiresAt, now),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(apiKeys.name, pattern),
        ilike(apiKeys.keyPrefix, pattern),
        ilike(users.email, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.ownerId, users.id))
    .leftJoin(accounts, eq(apiKeys.accountId, accounts.id))
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  // Explicit projection — never select keyHash / keySha256 so they can't
  // accidentally leak into the response body.
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scope: apiKeys.scope,
      machineIds: apiKeys.machineIds,
      permissions: apiKeys.permissions,
      expiresAt: apiKeys.expiresAt,
      lastUsed: apiKeys.lastUsed,
      createdAt: apiKeys.createdAt,
      ownerId: apiKeys.ownerId,
      accountId: apiKeys.accountId,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.ownerId, users.id))
    .leftJoin(accounts, eq(apiKeys.accountId, accounts.id))
    .where(where)
    .orderBy(desc(apiKeys.createdAt))
    .limit(limit)
    .offset(offset);

  // Fleet-wide summary (ignore filters so KPIs reflect overall state).
  const [summaryRow] = await db
    .select({
      total: sql<number>`count(*)`,
      expired_count: sql<number>`count(*) filter (where ${apiKeys.expiresAt} is not null and ${apiKeys.expiresAt} < now())`,
      active_count: sql<number>`count(*) filter (where ${apiKeys.expiresAt} is null or ${apiKeys.expiresAt} >= now())`,
      never_used_count: sql<number>`count(*) filter (where ${apiKeys.lastUsed} is null)`,
      last_7d_used_count: sql<number>`count(*) filter (where ${apiKeys.lastUsed} > now() - interval '7 days')`,
    })
    .from(apiKeys);

  return c.json({
    total,
    keys: rows.map((r) => ({
      id: r.id,
      name: r.name,
      key_prefix: r.keyPrefix,
      scope: r.scope,
      machine_ids: r.machineIds ?? [],
      permissions: r.permissions ?? [],
      expires_at: r.expiresAt?.toISOString() ?? null,
      last_used: r.lastUsed?.toISOString() ?? null,
      created_at: r.createdAt.toISOString(),
      is_expired: r.expiresAt ? r.expiresAt.getTime() < now.getTime() : false,
      owner: {
        id: r.ownerId,
        email: r.ownerEmail ?? null,
        name: r.ownerName ?? null,
      },
      account: r.accountId ? {
        id: r.accountId,
        name: r.accountName ?? null,
        slug: r.accountSlug ?? null,
        type: r.accountType ?? null,
      } : null,
    })),
    summary: {
      total: Number(summaryRow?.total ?? 0),
      expired_count: Number(summaryRow?.expired_count ?? 0),
      active_count: Number(summaryRow?.active_count ?? 0),
      never_used_count: Number(summaryRow?.never_used_count ?? 0),
      last_7d_used_count: Number(summaryRow?.last_7d_used_count ?? 0),
    },
  });
});

// ─── GET /api-keys/:id — detail (still no hashes) ──────────────────────────

adminKeysApp.get('/api-keys/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid API key ID');
  }

  // Explicit projection again — keyHash / keySha256 intentionally absent.
  const [row] = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scope: apiKeys.scope,
      machineIds: apiKeys.machineIds,
      permissions: apiKeys.permissions,
      expiresAt: apiKeys.expiresAt,
      lastUsed: apiKeys.lastUsed,
      createdAt: apiKeys.createdAt,
      ownerId: apiKeys.ownerId,
      accountId: apiKeys.accountId,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(apiKeys)
    .leftJoin(users, eq(apiKeys.ownerId, users.id))
    .leftJoin(accounts, eq(apiKeys.accountId, accounts.id))
    .where(eq(apiKeys.id, id));

  if (!row) {
    return errorResponse(c, 404, 'API key not found');
  }

  const now = Date.now();
  const permissions = row.permissions ?? [];
  const isWildcard = permissions.includes('*');

  return c.json({
    key: {
      id: row.id,
      name: row.name,
      key_prefix: row.keyPrefix,
      scope: row.scope,
      machine_ids: row.machineIds ?? [],
      permissions,
      // Slightly richer breakdown useful in a detail drawer
      permission_breakdown: {
        is_wildcard: isWildcard,
        read: isWildcard || permissions.includes('read'),
        write: isWildcard || permissions.includes('write'),
        delete: isWildcard || permissions.includes('delete'),
        exec: isWildcard || permissions.includes('exec'),
        proxy: isWildcard || permissions.includes('proxy'),
      },
      expires_at: row.expiresAt?.toISOString() ?? null,
      last_used: row.lastUsed?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      is_expired: row.expiresAt ? row.expiresAt.getTime() < now : false,
    },
    owner: {
      id: row.ownerId,
      email: row.ownerEmail ?? null,
      name: row.ownerName ?? null,
    },
    account: row.accountId ? {
      id: row.accountId,
      name: row.accountName ?? null,
      slug: row.accountSlug ?? null,
      type: row.accountType ?? null,
    } : null,
  });
});

// ─── DELETE /api-keys/:id — hard delete ─────────────────────────────────────

adminKeysApp.delete('/api-keys/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid API key ID');
  }

  const [existing] = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, id));
  if (!existing) {
    return errorResponse(c, 404, 'API key not found');
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, id));

  return c.json({ ok: true, deleted_id: id });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROXY TOKENS
// ═══════════════════════════════════════════════════════════════════════════

function proxyTokenProjection() {
  // Explicit projection — ensures tokenHash / tokenSha256 never leak.
  return {
    id: proxyTokens.id,
    tokenPrefix: proxyTokens.tokenPrefix,
    label: proxyTokens.label,
    ports: proxyTokens.ports,
    expiresAt: proxyTokens.expiresAt,
    revokedAt: proxyTokens.revokedAt,
    createdAt: proxyTokens.createdAt,
    ownerId: proxyTokens.ownerId,
    accountId: proxyTokens.accountId,
    machineId: proxyTokens.machineId,
    ownerEmail: users.email,
    ownerName: users.name,
    accountName: accounts.name,
    accountSlug: accounts.slug,
    accountType: accounts.type,
    machineSlug: machines.slug,
    machineName: machines.name,
  } as const;
}

type ProxyTokenRowProjected = {
  id: string;
  tokenPrefix: string;
  label: string | null;
  ports: number[] | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  ownerId: string;
  accountId: string | null;
  machineId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  accountName: string | null;
  accountSlug: string | null;
  accountType: string | null;
  machineSlug: string | null;
  machineName: string | null;
};

function serializeProxyTokenRow(r: ProxyTokenRowProjected, now: number) {
  const expiresMs = r.expiresAt.getTime();
  return {
    id: r.id,
    token_prefix: r.tokenPrefix,
    label: r.label ?? null,
    ports: r.ports ?? null,
    expires_at: r.expiresAt.toISOString(),
    revoked_at: r.revokedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
    is_revoked: Boolean(r.revokedAt),
    is_expired: expiresMs < now,
    machine: r.machineId ? {
      id: r.machineId,
      slug: r.machineSlug ?? null,
      name: r.machineName ?? null,
    } : null,
    owner: {
      id: r.ownerId,
      email: r.ownerEmail ?? null,
      name: r.ownerName ?? null,
    },
    account: r.accountId ? {
      id: r.accountId,
      name: r.accountName ?? null,
      slug: r.accountSlug ?? null,
      type: r.accountType ?? null,
    } : null,
  };
}

// ─── GET /proxy-tokens — list (hashes masked) ──────────────────────────────

adminKeysApp.get('/proxy-tokens', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const machineIdRaw = c.req.query('machine_id');
  const revokedRaw = c.req.query('revoked');
  const expiredRaw = c.req.query('expired');
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (machineIdRaw) {
    if (!z.string().uuid().safeParse(machineIdRaw).success) {
      return errorResponse(c, 400, 'Invalid machine_id');
    }
    conditions.push(eq(proxyTokens.machineId, machineIdRaw));
  }

  if (revokedRaw === 'true') {
    conditions.push(isNotNull(proxyTokens.revokedAt) as unknown as ReturnType<typeof eq>);
  } else if (revokedRaw === 'false') {
    conditions.push(isNull(proxyTokens.revokedAt) as unknown as ReturnType<typeof eq>);
  }

  const now = new Date();
  if (expiredRaw === 'true') {
    conditions.push(lt(proxyTokens.expiresAt, now) as unknown as ReturnType<typeof eq>);
  } else if (expiredRaw === 'false') {
    conditions.push(gt(proxyTokens.expiresAt, now) as unknown as ReturnType<typeof eq>);
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(proxyTokens.label, pattern),
        ilike(proxyTokens.tokenPrefix, pattern),
        ilike(users.email, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(proxyTokens)
    .leftJoin(users, eq(proxyTokens.ownerId, users.id))
    .leftJoin(accounts, eq(proxyTokens.accountId, accounts.id))
    .leftJoin(machines, eq(proxyTokens.machineId, machines.id))
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select(proxyTokenProjection())
    .from(proxyTokens)
    .leftJoin(users, eq(proxyTokens.ownerId, users.id))
    .leftJoin(accounts, eq(proxyTokens.accountId, accounts.id))
    .leftJoin(machines, eq(proxyTokens.machineId, machines.id))
    .where(where)
    .orderBy(desc(proxyTokens.createdAt))
    .limit(limit)
    .offset(offset);

  // Fleet-wide summary (ignores filters).
  const [summaryRow] = await db
    .select({
      total: sql<number>`count(*)`,
      active_count: sql<number>`count(*) filter (where ${proxyTokens.revokedAt} is null and ${proxyTokens.expiresAt} > now())`,
      revoked_count: sql<number>`count(*) filter (where ${proxyTokens.revokedAt} is not null)`,
      expired_count: sql<number>`count(*) filter (where ${proxyTokens.expiresAt} <= now() and ${proxyTokens.revokedAt} is null)`,
    })
    .from(proxyTokens);

  const nowMs = now.getTime();
  return c.json({
    total,
    tokens: rows.map((r) => serializeProxyTokenRow(r as ProxyTokenRowProjected, nowMs)),
    summary: {
      total: Number(summaryRow?.total ?? 0),
      active_count: Number(summaryRow?.active_count ?? 0),
      revoked_count: Number(summaryRow?.revoked_count ?? 0),
      expired_count: Number(summaryRow?.expired_count ?? 0),
    },
  });
});

// ─── GET /proxy-tokens/:id — detail (still no hashes) ──────────────────────

adminKeysApp.get('/proxy-tokens/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid proxy token ID');
  }

  const [row] = await db
    .select(proxyTokenProjection())
    .from(proxyTokens)
    .leftJoin(users, eq(proxyTokens.ownerId, users.id))
    .leftJoin(accounts, eq(proxyTokens.accountId, accounts.id))
    .leftJoin(machines, eq(proxyTokens.machineId, machines.id))
    .where(eq(proxyTokens.id, id));

  if (!row) {
    return errorResponse(c, 404, 'Proxy token not found');
  }

  return c.json({
    token: serializeProxyTokenRow(row as ProxyTokenRowProjected, Date.now()),
  });
});

// ─── POST /proxy-tokens/:id/revoke — idempotent revoke ─────────────────────

adminKeysApp.post('/proxy-tokens/:id/revoke', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid proxy token ID');
  }

  const [existing] = await db
    .select({ id: proxyTokens.id, revokedAt: proxyTokens.revokedAt })
    .from(proxyTokens)
    .where(eq(proxyTokens.id, id));

  if (!existing) {
    return errorResponse(c, 404, 'Proxy token not found');
  }

  // Idempotent: if already revoked, leave revokedAt untouched so callers
  // can replay the action without shifting the audit timestamp.
  if (!existing.revokedAt) {
    await db
      .update(proxyTokens)
      .set({ revokedAt: new Date() })
      .where(eq(proxyTokens.id, id));
  }

  const [row] = await db
    .select(proxyTokenProjection())
    .from(proxyTokens)
    .leftJoin(users, eq(proxyTokens.ownerId, users.id))
    .leftJoin(accounts, eq(proxyTokens.accountId, accounts.id))
    .leftJoin(machines, eq(proxyTokens.machineId, machines.id))
    .where(eq(proxyTokens.id, id));

  if (!row) {
    // Extremely unlikely race — row existed on first read, gone on second.
    return errorResponse(c, 404, 'Proxy token not found');
  }

  return c.json({
    ok: true,
    token: serializeProxyTokenRow(row as ProxyTokenRowProjected, Date.now()),
  });
});
