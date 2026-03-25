/**
 * E2E: Admin Machines panel — list, filter, single delete, batch delete.
 *
 * Creates ephemeral test users + machines directly in the DB, then exercises
 * the admin API over HTTP against the running dev server.  No cloud resources
 * are created — machines are inserted with source='user' + no providerServerId
 * so the graceful-delete path only touches the DB (skips Hetzner/Cloudflare/Stripe).
 *
 * Requires:
 *   - Dev server running on port 4100
 *   - Database access (DATABASE_URL)
 *
 * Run:
 *   npx vitest run --config vitest.e2e.config.ts src/__tests__/e2e/admin-machines.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db';
import {
  accounts,
  accountMemberships,
  apiKeys,
  machines,
  machineEvents,
  subscriptions,
  sshKeys,
  users,
} from '@/server/db/schema';
import { generateApiKey, hashPassword, generateMachineToken } from '@/server/lib/crypto';
import { nanoid } from 'nanoid';

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:4100/api/v1';

// ─── Test state ─────────────────────────────────────────────────────────────

let adminUserId = '';
let adminApiKey = '';
let regularUserId = '';
let regularApiKey = '';

// Machines we'll seed for testing
const testMachineIds: string[] = [];
let machineReady1Id = '';
let machineReady2Id = '';
let machineKortixId = '';
let machineErrorId = '';
let machineDeletedId = '';

// ─── Helpers ────────────────────────────────────────────────────────────────

function adminHeaders() {
  return {
    Authorization: `Bearer ${adminApiKey}`,
    'Content-Type': 'application/json',
  };
}

function regularHeaders() {
  return {
    Authorization: `Bearer ${regularApiKey}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(path: string, init?: RequestInit, headers?: Record<string, string>) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(headers || adminHeaders()), ...(init?.headers || {}) },
  });
}

function slug() {
  return nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
}

// ─── Setup: create admin user, regular user, and test machines ──────────────

beforeAll(async () => {
  // Verify dev server is up
  try {
    const health = await fetch(`${API_BASE.replace('/v1', '')}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error('Dev server not healthy');
  } catch {
    throw new Error('Dev server not reachable on port 4100 — cannot run admin-machines E2E tests');
  }

  const passwordHash = await hashPassword('TestAdminMachines123!');

  // ── Admin user ────────────────────────────────────────────────────────────
  const [adminUser] = await db.insert(users).values({
    email: `admin-machines-e2e-${Date.now()}@kortix.ai`,
    passwordHash,
    name: 'Admin Machines E2E',
    isAdmin: true,
  }).returning();
  adminUserId = adminUser.id;

  const adminKey = await generateApiKey();
  adminApiKey = adminKey.key;
  await db.insert(apiKeys).values({
    ownerId: adminUser.id,
    name: 'admin-machines-e2e',
    keyPrefix: adminKey.prefix,
    keyHash: adminKey.hash,
    keySha256: adminKey.sha256,
  });

  // ── Regular (non-admin) user ──────────────────────────────────────────────
  const [regularUser] = await db.insert(users).values({
    email: `regular-machines-e2e-${Date.now()}@test.justavps.com`,
    passwordHash,
    name: 'Regular Machines E2E',
    isAdmin: false,
  }).returning();
  regularUserId = regularUser.id;

  const regularKey = await generateApiKey();
  regularApiKey = regularKey.key;
  await db.insert(apiKeys).values({
    ownerId: regularUser.id,
    name: 'regular-machines-e2e',
    keyPrefix: regularKey.prefix,
    keyHash: regularKey.hash,
    keySha256: regularKey.sha256,
  });

  // ── Warm up the admin's account graph (ensures personal account exists) ───
  // We do this by making a simple API call first
  await apiFetch('/account');
  await apiFetch('/account', undefined, regularHeaders());

  // ── Resolve admin's personal account ID for machine inserts ───────────────
  const [adminAccount] = await db.select()
    .from(accounts)
    .where(eq(accounts.personalForUserId, adminUserId))
    .limit(1);
  const adminAccountId = adminAccount?.id ?? null;

  const [regularAccount] = await db.select()
    .from(accounts)
    .where(eq(accounts.personalForUserId, regularUserId))
    .limit(1);
  const regularAccountId = regularAccount?.id ?? null;

  // ── Seed test machines ────────────────────────────────────────────────────

  const baseMachine = {
    provider: 'cloud',
    serverType: 'cpx11',
    region: 'hel1',
    machineToken: generateMachineToken(),
    codeServerPassword: '',
  };

  // Machine 1: admin-owned, ready
  const s1 = slug();
  const [m1] = await db.insert(machines).values({
    ...baseMachine,
    ownerId: adminUserId,
    accountId: adminAccountId,
    slug: `adm-rdy-${s1}`,
    name: `Admin Ready ${s1}`,
    status: 'ready',
    ip: '10.0.0.1',
    source: 'user',
  }).returning();
  machineReady1Id = m1.id;
  testMachineIds.push(m1.id);

  // Machine 2: admin-owned, ready (for batch delete)
  const s2 = slug();
  const [m2] = await db.insert(machines).values({
    ...baseMachine,
    ownerId: adminUserId,
    accountId: adminAccountId,
    slug: `adm-rdy-${s2}`,
    name: `Admin Ready ${s2}`,
    status: 'ready',
    ip: '10.0.0.2',
    source: 'user',
  }).returning();
  machineReady2Id = m2.id;
  testMachineIds.push(m2.id);

  // Machine 3: kortix-imported sandbox
  const s3 = slug();
  const [m3] = await db.insert(machines).values({
    ...baseMachine,
    ownerId: adminUserId,
    accountId: adminAccountId,
    slug: `krtx-${s3}`,
    name: `Kortix Sandbox ${s3}`,
    status: 'ready',
    ip: '10.0.0.3',
    source: 'kortix',
    kortixSandboxId: `sbx_${nanoid(12)}`,
  }).returning();
  machineKortixId = m3.id;
  testMachineIds.push(m3.id);

  // Machine 4: error state
  const s4 = slug();
  const [m4] = await db.insert(machines).values({
    ...baseMachine,
    ownerId: regularUserId,
    accountId: regularAccountId,
    slug: `err-${s4}`,
    name: `Error Machine ${s4}`,
    status: 'error',
    ip: null,
    source: 'user',
  }).returning();
  machineErrorId = m4.id;
  testMachineIds.push(m4.id);

  // Machine 5: deleted
  const s5 = slug();
  const [m5] = await db.insert(machines).values({
    ...baseMachine,
    ownerId: regularUserId,
    accountId: regularAccountId,
    slug: `del-${s5}`,
    name: `Deleted Machine ${s5}`,
    status: 'deleted',
    ip: null,
    source: 'user',
    deletedAt: new Date(),
  }).returning();
  machineDeletedId = m5.id;
  testMachineIds.push(m5.id);

  console.log(`[E2E admin-machines] Seeded ${testMachineIds.length} test machines`);
});

// ─── Teardown ───────────────────────────────────────────────────────────────

afterAll(async () => {
  // Clean up test machines
  if (testMachineIds.length > 0) {
    await db.delete(machineEvents).where(inArray(machineEvents.machineId, testMachineIds)).catch(() => {});
    await db.delete(subscriptions).where(inArray(subscriptions.machineId, testMachineIds)).catch(() => {});
    await db.delete(machines).where(inArray(machines.id, testMachineIds)).catch(() => {});
  }

  // Clean up users, api keys, ssh keys, accounts + memberships
  for (const uid of [adminUserId, regularUserId]) {
    if (!uid) continue;
    await db.delete(sshKeys).where(eq(sshKeys.ownerId, uid)).catch(() => {});
    await db.delete(apiKeys).where(eq(apiKeys.ownerId, uid)).catch(() => {});

    // Delete account memberships + accounts for this user
    const userAccounts = await db.select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.personalForUserId, uid));
    for (const acct of userAccounts) {
      await db.delete(accountMemberships).where(eq(accountMemberships.accountId, acct.id)).catch(() => {});
      await db.delete(accounts).where(eq(accounts.id, acct.id)).catch(() => {});
    }

    await db.delete(users).where(eq(users.id, uid)).catch(() => {});
  }

  console.log('[E2E admin-machines] Cleanup complete');
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('admin machines: access control', () => {
  it('rejects non-admin users with 403', async () => {
    const res = await apiFetch('/admin/machines', undefined, regularHeaders());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.message).toContain('Admin');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${API_BASE}/admin/machines`);
    expect(res.status).toBe(401);
  });

  it('admin can access the endpoint', async () => {
    const res = await apiFetch('/admin/machines');
    expect(res.status).toBe(200);
  });
});

describe('admin machines: list with default params', () => {
  it('returns a valid response structure', async () => {
    const res = await apiFetch('/admin/machines');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.total).toBeGreaterThanOrEqual(testMachineIds.length - 1); // -1 for deleted (excluded by default)
    expect(data.limit).toBe(200);
    expect(data.offset).toBe(0);
    expect(Array.isArray(data.machines)).toBe(true);
    expect(data.summary).toBeDefined();
    expect(data.summary.by_status).toBeDefined();
    expect(data.summary.by_source).toBeDefined();
  });

  it('returns machines with all expected fields', async () => {
    const res = await apiFetch('/admin/machines');
    const data = await res.json();
    const m = data.machines.find((m: { id: string }) => m.id === machineReady1Id);
    expect(m).toBeDefined();

    // Core fields
    expect(m.id).toBe(machineReady1Id);
    expect(m.slug).toBeTruthy();
    expect(m.name).toBeTruthy();
    expect(m.status).toBe('ready');
    expect(m.provider).toBe('cloud');
    expect(m.server_type).toBe('cpx11');
    expect(m.region).toBe('hel1');
    expect(m.ip).toBe('10.0.0.1');
    expect(m.source).toBe('user');
    expect(m.created_at).toBeTruthy();

    // Owner info
    expect(m.owner).toBeDefined();
    expect(m.owner.id).toBe(adminUserId);
    expect(m.owner.email).toContain('@kortix.ai');

    // Account info
    expect(m.account).toBeDefined();
    expect(m.account.id).toBeTruthy();
  });

  it('excludes deleted machines by default', async () => {
    const res = await apiFetch('/admin/machines');
    const data = await res.json();
    const deleted = data.machines.find((m: { id: string }) => m.id === machineDeletedId);
    expect(deleted).toBeUndefined();
  });

  it('includes kortix-source machines', async () => {
    const res = await apiFetch('/admin/machines');
    const data = await res.json();
    const kortix = data.machines.find((m: { id: string }) => m.id === machineKortixId);
    expect(kortix).toBeDefined();
    expect(kortix.source).toBe('kortix');
    expect(kortix.kortix_sandbox_id).toBeTruthy();
    expect(kortix.kortix_sandbox_id).toMatch(/^sbx_/);
  });
});

describe('admin machines: filtering', () => {
  it('filters by status=error', async () => {
    const res = await apiFetch('/admin/machines?status=error');
    expect(res.status).toBe(200);
    const data = await res.json();

    // Every returned machine should be in error status
    for (const m of data.machines) {
      expect(m.status).toBe('error');
    }

    // Our test error machine should be present
    const errorMachine = data.machines.find((m: { id: string }) => m.id === machineErrorId);
    expect(errorMachine).toBeDefined();
  });

  it('filters by source=kortix', async () => {
    const res = await apiFetch('/admin/machines?source=kortix');
    expect(res.status).toBe(200);
    const data = await res.json();

    for (const m of data.machines) {
      expect(m.source).toBe('kortix');
    }

    const kortixMachine = data.machines.find((m: { id: string }) => m.id === machineKortixId);
    expect(kortixMachine).toBeDefined();
  });

  it('filters by user_id', async () => {
    const res = await apiFetch(`/admin/machines?user_id=${regularUserId}`);
    expect(res.status).toBe(200);
    const data = await res.json();

    for (const m of data.machines) {
      expect(m.owner.id).toBe(regularUserId);
    }
  });

  it('filters by account_id', async () => {
    const [adminAccount] = await db.select()
      .from(accounts)
      .where(eq(accounts.personalForUserId, adminUserId))
      .limit(1);

    const res = await apiFetch(`/admin/machines?account_id=${adminAccount.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();

    for (const m of data.machines) {
      expect(m.account?.id).toBe(adminAccount.id);
    }

    // Admin-owned machines should be here
    const m1 = data.machines.find((m: { id: string }) => m.id === machineReady1Id);
    expect(m1).toBeDefined();
  });

  it('searches by slug substring', async () => {
    // Fetch the slug of our known machine
    const [machine] = await db.select({ slug: machines.slug })
      .from(machines)
      .where(eq(machines.id, machineKortixId));

    const partial = machine.slug.slice(0, 8);
    const res = await apiFetch(`/admin/machines?search=${partial}`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.machines.length).toBeGreaterThanOrEqual(1);
    const found = data.machines.find((m: { id: string }) => m.id === machineKortixId);
    expect(found).toBeDefined();
  });

  it('searches by sandbox ID', async () => {
    // Get the sandbox ID from DB
    const [machine] = await db.select({ kortixSandboxId: machines.kortixSandboxId })
      .from(machines)
      .where(eq(machines.id, machineKortixId));

    const sandboxId = machine.kortixSandboxId!;
    const res = await apiFetch(`/admin/machines?search=${sandboxId.slice(0, 10)}`);
    expect(res.status).toBe(200);
    const data = await res.json();

    const found = data.machines.find((m: { id: string }) => m.id === machineKortixId);
    expect(found).toBeDefined();
  });

  it('include_deleted=true shows deleted machines', async () => {
    const res = await apiFetch('/admin/machines?include_deleted=true&status=deleted');
    expect(res.status).toBe(200);
    const data = await res.json();

    const deleted = data.machines.find((m: { id: string }) => m.id === machineDeletedId);
    expect(deleted).toBeDefined();
    expect(deleted.status).toBe('deleted');
    expect(deleted.deleted_at).toBeTruthy();
  });

  it('combined filters work (source=user AND status=ready)', async () => {
    const res = await apiFetch('/admin/machines?source=user&status=ready');
    expect(res.status).toBe(200);
    const data = await res.json();

    for (const m of data.machines) {
      expect(m.source).toBe('user');
      expect(m.status).toBe('ready');
    }
  });
});

describe('admin machines: pagination', () => {
  it('respects limit parameter', async () => {
    const res = await apiFetch('/admin/machines?limit=2');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.machines.length).toBeLessThanOrEqual(2);
    expect(data.limit).toBe(2);
  });

  it('respects offset parameter', async () => {
    // Get all machines first
    const allRes = await apiFetch('/admin/machines?limit=500');
    const allData = await allRes.json();
    const total = allData.total;

    if (total <= 1) return; // Need at least 2 machines for offset test

    // Get page 2
    const res = await apiFetch('/admin/machines?limit=1&offset=1');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.offset).toBe(1);
    expect(data.total).toBe(total); // Total doesn't change with offset

    // The machine at offset 1 should be different from offset 0
    if (allData.machines.length >= 2) {
      expect(data.machines[0]?.id).not.toBe(allData.machines[0]?.id);
    }
  });

  it('caps limit at 500', async () => {
    const res = await apiFetch('/admin/machines?limit=9999');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.limit).toBe(500);
  });

  it('handles NaN limit gracefully (falls back to 200)', async () => {
    const res = await apiFetch('/admin/machines?limit=abc');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.limit).toBe(200);
  });

  it('handles NaN offset gracefully (falls back to 0)', async () => {
    const res = await apiFetch('/admin/machines?offset=xyz');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.offset).toBe(0);
  });

  it('handles negative limit gracefully (falls back to 200)', async () => {
    const res = await apiFetch('/admin/machines?limit=-5');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.limit).toBe(200);
  });
});

describe('admin machines: summary stats', () => {
  it('by_status includes counts for known statuses', async () => {
    const res = await apiFetch('/admin/machines');
    const data = await res.json();
    const byStatus = data.summary.by_status;

    // We seeded ready, error, deleted machines
    expect(byStatus.ready).toBeGreaterThanOrEqual(2);
    expect(byStatus.error).toBeGreaterThanOrEqual(1);
    expect(byStatus.deleted).toBeGreaterThanOrEqual(1);
  });

  it('by_source includes source counts', async () => {
    const res = await apiFetch('/admin/machines');
    const data = await res.json();
    const bySource = data.summary.by_source;

    expect(bySource.user).toBeGreaterThanOrEqual(2);
    expect(bySource.kortix).toBeGreaterThanOrEqual(1);
  });
});

describe('admin machines: single delete', () => {
  it('rejects delete for non-admin user', async () => {
    const res = await apiFetch(`/admin/machines/${machineReady1Id}`, { method: 'DELETE' }, regularHeaders());
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent machine', async () => {
    const res = await apiFetch('/admin/machines/00000000-0000-0000-0000-000000000000', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await apiFetch('/admin/machines/not-a-uuid', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for already-deleted machine', async () => {
    const res = await apiFetch(`/admin/machines/${machineDeletedId}`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toContain('already deleted');
  });

  it('gracefully deletes a ready machine (no provider server = DB-only)', async () => {
    const res = await apiFetch(`/admin/machines/${machineReady1Id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.machine_id).toBe(machineReady1Id);
    expect(data.slug).toBeTruthy();

    // Verify machine is now deleted in DB
    const [machine] = await db.select().from(machines).where(eq(machines.id, machineReady1Id));
    expect(machine.status).toBe('deleted');
    expect(machine.deletedAt).toBeTruthy();
  });

  it('gracefully deletes a kortix-source machine (skips Hetzner)', async () => {
    const res = await apiFetch(`/admin/machines/${machineKortixId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify deleted in DB
    const [machine] = await db.select().from(machines).where(eq(machines.id, machineKortixId));
    expect(machine.status).toBe('deleted');
    expect(machine.deletedAt).toBeTruthy();
  });

  it('deleted machine no longer shows up in default list', async () => {
    const res = await apiFetch('/admin/machines');
    const data = await res.json();
    const found = data.machines.find((m: { id: string }) => m.id === machineReady1Id);
    expect(found).toBeUndefined();
  });
});

describe('admin machines: batch delete', () => {
  it('rejects batch delete for non-admin user', async () => {
    const res = await apiFetch('/admin/machines/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ machine_ids: [machineReady2Id] }),
    }, regularHeaders());
    expect(res.status).toBe(403);
  });

  it('rejects empty machine_ids array', async () => {
    const res = await apiFetch('/admin/machines/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ machine_ids: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid body', async () => {
    const res = await apiFetch('/admin/machines/batch-delete', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('batch deletes machines successfully', async () => {
    const res = await apiFetch('/admin/machines/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ machine_ids: [machineReady2Id, machineErrorId] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.succeeded).toBe(2);
    expect(data.failed).toBe(0);
    expect(data.ok).toBe(true);

    // Verify each result
    for (const result of data.results) {
      expect(result.ok).toBe(true);
      expect(result.slug).toBeTruthy();
    }

    // Verify machines are deleted in DB
    const [m2] = await db.select().from(machines).where(eq(machines.id, machineReady2Id));
    expect(m2.status).toBe('deleted');
    expect(m2.deletedAt).toBeTruthy();

    const [m4] = await db.select().from(machines).where(eq(machines.id, machineErrorId));
    expect(m4.status).toBe('deleted');
    expect(m4.deletedAt).toBeTruthy();
  });

  it('skips already-deleted machines in batch (no error, just absent from results)', async () => {
    const res = await apiFetch('/admin/machines/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ machine_ids: [machineReady2Id] }), // already deleted
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Already deleted → filtered out by ne(status, 'deleted') → 0 processed
    expect(data.total).toBe(0);
    expect(data.ok).toBe(true);
  });
});

describe('admin machines: delete endpoints for non-admin are protected', () => {
  it('regular user cannot single-delete via admin route', async () => {
    // Even if they somehow knew a machine ID
    const res = await apiFetch(`/admin/machines/${machineDeletedId}`, { method: 'DELETE' }, regularHeaders());
    expect(res.status).toBe(403);
  });

  it('regular user cannot batch-delete via admin route', async () => {
    const res = await apiFetch('/admin/machines/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ machine_ids: [machineDeletedId] }),
    }, regularHeaders());
    expect(res.status).toBe(403);
  });
});
