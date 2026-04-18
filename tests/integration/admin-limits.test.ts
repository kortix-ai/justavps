/**
 * E2E: Admin limits — verifies admin users get unlimited account limits.
 *
 * Requires a reachable API via E2E_BASE_URL (defaults to local dev server).
 * This test only touches the DB for a temporary user + API key and does not
 * create cloud resources.
 *
 * Run: E2E_BASE_URL=https://dev.justavps.com/api/v1 pnpm exec vitest run --config vitest.e2e.config.ts src/__tests__/e2e/admin-limits.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { apiKeys, users } from '@/server/db/schema';
import { generateApiKey, hashPassword } from "@/server/core/crypto";

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:4100/api/v1';
const UNLIMITED = Number.MAX_SAFE_INTEGER;

let adminUserId = '';
let adminApiKey = '';

beforeAll(async () => {
  const passwordHash = await hashPassword('TestPass123!');
  const [adminUser] = await db.insert(users).values({
    email: `admin-limits-e2e-${Date.now()}@kortix.com`,
    passwordHash,
    name: 'Admin Limits E2E',
    isAdmin: true,
  }).returning();

  adminUserId = adminUser.id;

  const apiKey = await generateApiKey();
  adminApiKey = apiKey.key;

  await db.insert(apiKeys).values({
    ownerId: adminUser.id,
    name: 'admin-limits-e2e',
    keyPrefix: apiKey.prefix,
    keyHash: apiKey.hash,
  });
});

afterAll(async () => {
  if (!adminUserId) return;
  await db.delete(apiKeys).where(eq(apiKeys.ownerId, adminUserId));
  await db.delete(users).where(eq(users.id, adminUserId));
});

describe('admin account limits', () => {
  it('returns unlimited limits for admin users over the live API', async () => {
    const res = await fetch(`${API_BASE}/account/limits`, {
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json() as {
      limits: { max_machines: number; max_images: number };
      usage: { machines: number; images: number };
    };

    expect(data.limits.max_machines).toBe(UNLIMITED);
    expect(data.limits.max_images).toBe(UNLIMITED);
    expect(data.usage.machines).toBeGreaterThanOrEqual(0);
    expect(data.usage.images).toBeGreaterThanOrEqual(0);
  });

  it('returns is_admin=true for the same admin user', async () => {
    const res = await fetch(`${API_BASE}/account`, {
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { is_admin: boolean; email: string };

    expect(data.is_admin).toBe(true);
    expect(data.email).toContain('@kortix.com');
  });
});
