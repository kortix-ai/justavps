/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin Keys & Security surface.
 *
 * Covers:
 *  - GET /admin/ssh-keys              — list + summary; public_key NOT in rows
 *  - GET /admin/ssh-keys/:id          — public_key IS in detail
 *  - DELETE /admin/ssh-keys/:id       — 404 unknown, 200 success
 *  - GET /admin/api-keys?expired=true — filter returns only expired rows
 *  - GET /admin/api-keys/:id          — never returns keyHash / keySha256
 *  - DELETE /admin/api-keys/:id       — 200 success
 *  - POST /admin/proxy-tokens/:id/revoke — sets revoked_at; idempotent
 *  - Non-admin 403 on each route
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SSH_KEY_ID = 'aaaa1111-2222-4333-8444-555555555501';
const SSH_KEY_ID_2 = 'aaaa1111-2222-4333-8444-555555555502';
const API_KEY_ID = 'bbbb1111-2222-4333-8444-555555555501';
const API_KEY_EXPIRED_ID = 'bbbb1111-2222-4333-8444-555555555502';
const PROXY_TOKEN_ID = 'cccc1111-2222-4333-8444-555555555501';
const UNKNOWN_ID = 'ffff1111-2222-4333-8444-999999999999';
const OWNER_ID = 'dddd1111-2222-4333-8444-555555555501';
const ACCOUNT_ID = 'eeee1111-2222-4333-8444-555555555501';
const MACHINE_ID = '9999aaaa-2222-4333-8444-555555555501';

const SSH_PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample fingerprint-source user@host';

const sshKeyRow = {
  id: SSH_KEY_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  name: 'laptop',
  publicKey: SSH_PUBLIC_KEY,
  fingerprint: 'SHA256:abcdef0123456789',
  providerKeyId: 'hetzner-42',
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
};

const apiKeyExpiredRow = {
  id: API_KEY_EXPIRED_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  name: 'old-ci-runner',
  keyPrefix: 'ak_dead',
  keyHash: 'SECRET_BCRYPT_HASH',
  keySha256: 'SECRET_SHA256',
  scope: 'account',
  machineIds: null as null | string[],
  permissions: ['*'],
  expiresAt: new Date('2024-01-01T00:00:00.000Z'),
  lastUsed: new Date('2023-06-01T00:00:00.000Z'),
  createdAt: new Date('2023-01-01T00:00:00.000Z'),
};

const apiKeyActiveDetailRow = {
  id: API_KEY_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  name: 'ci-runner',
  keyPrefix: 'ak_abcd',
  keyHash: 'SECRET_BCRYPT_HASH',
  keySha256: 'SECRET_SHA256',
  scope: 'machine',
  machineIds: [MACHINE_ID],
  permissions: ['read', 'write'],
  expiresAt: null as Date | null,
  lastUsed: new Date('2026-04-19T00:00:00.000Z'),
  createdAt: new Date('2026-03-15T00:00:00.000Z'),
};

const proxyTokenActiveRow = {
  id: PROXY_TOKEN_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  machineId: MACHINE_ID,
  tokenHash: 'SECRET_BCRYPT_HASH',
  tokenSha256: 'SECRET_SHA256',
  tokenPrefix: 'pt_abc1',
  label: 'collab-link',
  ports: [8080, 3000],
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  revokedAt: null as Date | null,
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
};

const FIXED_REVOKED_AT = new Date('2026-04-20T00:00:00.000Z');
const proxyTokenRevokedRow = {
  ...proxyTokenActiveRow,
  revokedAt: FIXED_REVOKED_AT,
};

// ── Auth guard stub ─────────────────────────────────────────────────────────

let currentIsAdmin = true;
vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', currentIsAdmin);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

// ── DB stub (FIFO queue) ────────────────────────────────────────────────────

const selectQueue: any[][] = [];
const updateCalls: Array<{ set: Record<string, unknown>; where: unknown }> = [];
const deleteCalls: Array<{ table: unknown; where: unknown }> = [];

function enqueueSelect(rows: any[]) {
  selectQueue.push(rows);
}

function makeSelectChain() {
  const resolver = async (): Promise<any[]> => {
    const next = selectQueue.shift();
    return next ?? [];
  };
  const chain: any = {
    from: (_t: any) => chain,
    leftJoin: (_t: any, _c: any) => chain,
    where: (_c: any) => chain,
    orderBy: (..._a: any[]) => chain,
    limit: (_n: number) => chain,
    offset: (_n: number) => chain,
    groupBy: (..._a: any[]) => chain,
    then: (onFulfilled: (v: any[]) => unknown, onRejected?: (err: unknown) => unknown) =>
      resolver().then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn((_shape?: any) => ({
      from: (_t: any) => makeSelectChain(),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: async (w: unknown) => {
          updateCalls.push({ set: values, where: w });
          return [];
        },
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: async (w: unknown) => {
        deleteCalls.push({ table, where: w });
        return [];
      },
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    transaction: vi.fn(async (fn: any) =>
      fn({ select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() }),
    ),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin keys & security routes', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateCalls.length = 0;
    deleteCalls.length = 0;
    currentIsAdmin = true;
  });

  // ─── GET /admin/ssh-keys ──────────────────────────────────────────────────

  it('GET /admin/ssh-keys returns list + summary; public_key NOT in list rows', async () => {
    // SELECT order:
    //  1. count(*) total
    //  2. page rows (no public_key projected)
    //  3. summary aggregates
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        id: sshKeyRow.id,
        name: sshKeyRow.name,
        fingerprint: sshKeyRow.fingerprint,
        providerKeyId: sshKeyRow.providerKeyId,
        createdAt: sshKeyRow.createdAt,
        ownerId: sshKeyRow.ownerId,
        accountId: sshKeyRow.accountId,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
      },
    ]);
    enqueueSelect([
      {
        total: 1,
        with_provider_id: 1,
        without_provider_id: 0,
        last_7d: 0,
      },
    ]);

    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(new Request('http://localhost/ssh-keys'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(1);
    expect(data.keys).toHaveLength(1);

    const row = data.keys[0];
    expect(row.id).toBe(SSH_KEY_ID);
    expect(row.fingerprint).toBe(sshKeyRow.fingerprint);
    expect(row.provider_key_id).toBe('hetzner-42');
    // public_key MUST NOT be in the list row.
    expect(row).not.toHaveProperty('public_key');
    // And not leaked via any other field name.
    expect(JSON.stringify(row)).not.toContain(SSH_PUBLIC_KEY);
    expect(row.owner.email).toBe('owner@example.com');
    expect(row.account.slug).toBe('acme');

    expect(data.summary).toEqual({
      total: 1,
      with_provider_id: 1,
      without_provider_id: 0,
      last_7d: 0,
    });
  });

  it('GET /admin/ssh-keys rejects non-admin with 403', async () => {
    currentIsAdmin = false;
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(new Request('http://localhost/ssh-keys'));
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/ssh-keys/:id ──────────────────────────────────────────────

  it('GET /admin/ssh-keys/:id includes the full public_key in detail', async () => {
    enqueueSelect([
      {
        key: sshKeyRow,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
      },
    ]);

    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/ssh-keys/${SSH_KEY_ID}`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.key.id).toBe(SSH_KEY_ID);
    expect(data.key.public_key).toBe(SSH_PUBLIC_KEY);
    expect(data.key.provider_key_id).toBe('hetzner-42');
    expect(data.owner.email).toBe('owner@example.com');
    expect(data.account.slug).toBe('acme');
  });

  it('GET /admin/ssh-keys/:id returns 404 for unknown key', async () => {
    enqueueSelect([]);
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/ssh-keys/${UNKNOWN_ID}`),
    );
    expect(res.status).toBe(404);
  });

  // ─── DELETE /admin/ssh-keys/:id ───────────────────────────────────────────

  it('DELETE /admin/ssh-keys/:id returns 404 for unknown key', async () => {
    enqueueSelect([]); // existence check empty
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/ssh-keys/${UNKNOWN_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
    expect(deleteCalls).toHaveLength(0);
  });

  it('DELETE /admin/ssh-keys/:id hard-deletes on success', async () => {
    enqueueSelect([{ id: SSH_KEY_ID }]); // existence check hits
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/ssh-keys/${SSH_KEY_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted_id).toBe(SSH_KEY_ID);
    expect(deleteCalls).toHaveLength(1);
  });

  it('DELETE /admin/ssh-keys/:id rejects non-admin with 403', async () => {
    currentIsAdmin = false;
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/ssh-keys/${SSH_KEY_ID_2}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/api-keys?expired=true ─────────────────────────────────────

  it('GET /admin/api-keys?expired=true returns only expired keys', async () => {
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        id: apiKeyExpiredRow.id,
        name: apiKeyExpiredRow.name,
        keyPrefix: apiKeyExpiredRow.keyPrefix,
        scope: apiKeyExpiredRow.scope,
        machineIds: apiKeyExpiredRow.machineIds,
        permissions: apiKeyExpiredRow.permissions,
        expiresAt: apiKeyExpiredRow.expiresAt,
        lastUsed: apiKeyExpiredRow.lastUsed,
        createdAt: apiKeyExpiredRow.createdAt,
        ownerId: apiKeyExpiredRow.ownerId,
        accountId: apiKeyExpiredRow.accountId,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
      },
    ]);
    enqueueSelect([
      {
        total: 2,
        expired_count: 1,
        active_count: 1,
        never_used_count: 0,
        last_7d_used_count: 0,
      },
    ]);

    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request('http://localhost/api-keys?expired=true'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(1);
    expect(data.keys).toHaveLength(1);
    const row = data.keys[0];
    expect(row.id).toBe(API_KEY_EXPIRED_ID);
    expect(row.is_expired).toBe(true);
    // No hash material anywhere in the list rows.
    expect(JSON.stringify(row)).not.toContain('SECRET_BCRYPT_HASH');
    expect(JSON.stringify(row)).not.toContain('SECRET_SHA256');
    expect(row).not.toHaveProperty('key_hash');
    expect(row).not.toHaveProperty('key_sha256');
  });

  it('GET /admin/api-keys rejects non-admin with 403', async () => {
    currentIsAdmin = false;
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(new Request('http://localhost/api-keys'));
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/api-keys/:id ──────────────────────────────────────────────

  it('GET /admin/api-keys/:id does NOT include keyHash / keySha256 in the body', async () => {
    enqueueSelect([
      {
        id: apiKeyActiveDetailRow.id,
        name: apiKeyActiveDetailRow.name,
        keyPrefix: apiKeyActiveDetailRow.keyPrefix,
        scope: apiKeyActiveDetailRow.scope,
        machineIds: apiKeyActiveDetailRow.machineIds,
        permissions: apiKeyActiveDetailRow.permissions,
        expiresAt: apiKeyActiveDetailRow.expiresAt,
        lastUsed: apiKeyActiveDetailRow.lastUsed,
        createdAt: apiKeyActiveDetailRow.createdAt,
        ownerId: apiKeyActiveDetailRow.ownerId,
        accountId: apiKeyActiveDetailRow.accountId,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
      },
    ]);

    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/api-keys/${API_KEY_ID}`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const body = JSON.stringify(data);

    // No hash material at all.
    expect(body).not.toContain('SECRET_BCRYPT_HASH');
    expect(body).not.toContain('SECRET_SHA256');
    expect(body).not.toMatch(/keyHash/i);
    expect(body).not.toMatch(/key_hash/i);
    expect(body).not.toMatch(/keySha256/i);
    expect(body).not.toMatch(/key_sha256/i);

    // Expected shape is still there.
    expect(data.key.id).toBe(API_KEY_ID);
    expect(data.key.key_prefix).toBe('ak_abcd');
    expect(data.key.permission_breakdown.is_wildcard).toBe(false);
    expect(data.key.permission_breakdown.read).toBe(true);
    expect(data.key.permission_breakdown.write).toBe(true);
    expect(data.key.permission_breakdown.delete).toBe(false);
    expect(data.key.machine_ids).toEqual([MACHINE_ID]);
  });

  it('GET /admin/api-keys/:id returns 404 for unknown key', async () => {
    enqueueSelect([]);
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/api-keys/${UNKNOWN_ID}`),
    );
    expect(res.status).toBe(404);
  });

  // ─── DELETE /admin/api-keys/:id ───────────────────────────────────────────

  it('DELETE /admin/api-keys/:id hard-deletes on success', async () => {
    enqueueSelect([{ id: API_KEY_ID }]);
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/api-keys/${API_KEY_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted_id).toBe(API_KEY_ID);
    expect(deleteCalls).toHaveLength(1);
  });

  it('DELETE /admin/api-keys/:id returns 404 for unknown key', async () => {
    enqueueSelect([]);
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/api-keys/${UNKNOWN_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /admin/api-keys/:id rejects non-admin with 403', async () => {
    currentIsAdmin = false;
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/api-keys/${API_KEY_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(403);
  });

  // ─── POST /admin/proxy-tokens/:id/revoke ──────────────────────────────────

  it('POST /admin/proxy-tokens/:id/revoke sets revoked_at and is idempotent', async () => {
    // First call — not yet revoked.
    // SELECT order:
    //  1. existence + revokedAt (null → issue update)
    //  2. full projected row (returned) — now revoked
    enqueueSelect([{ id: PROXY_TOKEN_ID, revokedAt: null }]);
    enqueueSelect([
      {
        id: proxyTokenActiveRow.id,
        tokenPrefix: proxyTokenActiveRow.tokenPrefix,
        label: proxyTokenActiveRow.label,
        ports: proxyTokenActiveRow.ports,
        expiresAt: proxyTokenActiveRow.expiresAt,
        revokedAt: FIXED_REVOKED_AT,
        createdAt: proxyTokenActiveRow.createdAt,
        ownerId: proxyTokenActiveRow.ownerId,
        accountId: proxyTokenActiveRow.accountId,
        machineId: proxyTokenActiveRow.machineId,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        machineSlug: 'machine-slug',
        machineName: 'machine-name',
      },
    ]);

    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    let res = await adminKeysApp.request(
      new Request(`http://localhost/proxy-tokens/${PROXY_TOKEN_ID}/revoke`, {
        method: 'POST',
      }),
    );
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token.is_revoked).toBe(true);
    expect(body.token.revoked_at).toBe(FIXED_REVOKED_AT.toISOString());
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.set).toHaveProperty('revokedAt');

    // Second call — already revoked, idempotent: no new update, same revoked_at.
    enqueueSelect([{ id: PROXY_TOKEN_ID, revokedAt: FIXED_REVOKED_AT }]);
    enqueueSelect([
      {
        id: proxyTokenRevokedRow.id,
        tokenPrefix: proxyTokenRevokedRow.tokenPrefix,
        label: proxyTokenRevokedRow.label,
        ports: proxyTokenRevokedRow.ports,
        expiresAt: proxyTokenRevokedRow.expiresAt,
        revokedAt: FIXED_REVOKED_AT,
        createdAt: proxyTokenRevokedRow.createdAt,
        ownerId: proxyTokenRevokedRow.ownerId,
        accountId: proxyTokenRevokedRow.accountId,
        machineId: proxyTokenRevokedRow.machineId,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        machineSlug: 'machine-slug',
        machineName: 'machine-name',
      },
    ]);

    res = await adminKeysApp.request(
      new Request(`http://localhost/proxy-tokens/${PROXY_TOKEN_ID}/revoke`, {
        method: 'POST',
      }),
    );
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token.is_revoked).toBe(true);
    expect(body.token.revoked_at).toBe(FIXED_REVOKED_AT.toISOString());
    // Still exactly one update — second call did not re-stamp revokedAt.
    expect(updateCalls).toHaveLength(1);
  });

  it('POST /admin/proxy-tokens/:id/revoke returns 404 for unknown token', async () => {
    enqueueSelect([]);
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/proxy-tokens/${UNKNOWN_ID}/revoke`, {
        method: 'POST',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('POST /admin/proxy-tokens/:id/revoke rejects non-admin with 403', async () => {
    currentIsAdmin = false;
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(
      new Request(`http://localhost/proxy-tokens/${PROXY_TOKEN_ID}/revoke`, {
        method: 'POST',
      }),
    );
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/proxy-tokens — hashes masked ──────────────────────────────

  it('GET /admin/proxy-tokens never returns tokenHash / tokenSha256', async () => {
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        id: proxyTokenActiveRow.id,
        tokenPrefix: proxyTokenActiveRow.tokenPrefix,
        label: proxyTokenActiveRow.label,
        ports: proxyTokenActiveRow.ports,
        expiresAt: proxyTokenActiveRow.expiresAt,
        revokedAt: null,
        createdAt: proxyTokenActiveRow.createdAt,
        ownerId: proxyTokenActiveRow.ownerId,
        accountId: proxyTokenActiveRow.accountId,
        machineId: proxyTokenActiveRow.machineId,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        machineSlug: 'machine-slug',
        machineName: 'machine-name',
      },
    ]);
    enqueueSelect([
      {
        total: 1,
        active_count: 1,
        revoked_count: 0,
        expired_count: 0,
      },
    ]);

    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(new Request('http://localhost/proxy-tokens'));
    expect(res.status).toBe(200);
    const data = await res.json();
    const body = JSON.stringify(data);

    expect(body).not.toContain('SECRET_BCRYPT_HASH');
    expect(body).not.toContain('SECRET_SHA256');
    expect(body).not.toMatch(/token_hash/i);
    expect(body).not.toMatch(/tokenHash/i);
    expect(body).not.toMatch(/token_sha256/i);

    expect(data.tokens[0].token_prefix).toBe('pt_abc1');
    expect(data.tokens[0].machine.slug).toBe('machine-slug');
  });

  it('GET /admin/proxy-tokens rejects non-admin with 403', async () => {
    currentIsAdmin = false;
    const { adminKeysApp } = await import('@/server/v1/routes/internal/admin-keys');
    const res = await adminKeysApp.request(new Request('http://localhost/proxy-tokens'));
    expect(res.status).toBe(403);
  });
});
