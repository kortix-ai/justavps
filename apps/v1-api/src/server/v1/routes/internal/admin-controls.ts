/**
 * Admin Operational Controls — emergency kill switches and feature flags.
 *
 * Read/write surface for the /v2/admin/controls page. The actual enforcement
 * happens at create-time via `assertNotPaused` in `operational-flags.ts`.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { operationalFlags, users } from '@/server/db/schema';
import { apiGuard, type AuthVariables } from '@/server/auth/api-guard';
import { errorResponse } from '@/server/core/route-helpers';
import {
  getOperationalFlagRow,
  invalidateOperationalFlag,
  isKnownFlagKey,
  listKnownFlagDescriptors,
  type OperationalFlagDescriptor,
  type OperationalFlagValue,
} from '@/server/v1/services/operational-flags';

export const adminControlsApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminControlsApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) return errorResponse(c, 403, 'Admin access required');
  return null;
}

type FlagResponseRow = {
  key: string;
  value: OperationalFlagValue;
  updated_by_user_id: string | null;
  updated_by_email: string | null;
  updated_at: string | null;
  created_at: string | null;
};

async function buildFlagRow(key: string): Promise<FlagResponseRow> {
  const row = await getOperationalFlagRow(key);
  if (!row) {
    return {
      key,
      value: { enabled: false },
      updated_by_user_id: null,
      updated_by_email: null,
      updated_at: null,
      created_at: null,
    };
  }
  let email: string | null = null;
  if (row.updatedBy) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.updatedBy));
    email = u?.email ?? null;
  }
  const value = row.value as OperationalFlagValue;
  return {
    key,
    value: { enabled: Boolean(value?.enabled), reason: value?.reason ?? null, metadata: value?.metadata ?? {} },
    updated_by_user_id: row.updatedBy ?? null,
    updated_by_email: email,
    updated_at: row.updatedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

adminControlsApp.get('/', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;
  const descriptors = await listKnownFlagDescriptors();
  const flags = await Promise.all(descriptors.map((d) => buildFlagRow(d.key)));
  return c.json({ known_flags: descriptors, flags });
});

adminControlsApp.get('/:key', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;
  const key = c.req.param('key');
  if (!key) return errorResponse(c, 400, 'key is required');
  if (!(await isKnownFlagKey(key))) return errorResponse(c, 404, `Unknown flag '${key}'`);
  return c.json({ flag: await buildFlagRow(key) });
});

adminControlsApp.put('/:key', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;
  const key = c.req.param('key');
  if (!key) return errorResponse(c, 400, 'key is required');
  if (!(await isKnownFlagKey(key))) return errorResponse(c, 400, `Unknown flag '${key}'`);

  let body: { enabled?: unknown; reason?: unknown; metadata?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'Invalid JSON body');
  }

  const enabled = Boolean(body.enabled);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? (body.metadata as Record<string, unknown>)
    : undefined;

  if (enabled && (!reason || reason.length < 2)) {
    return errorResponse(c, 400, 'Reason is required when enabling a kill switch');
  }

  const userId = c.get('userId') ?? null;
  const now = new Date();
  const value: OperationalFlagValue = { enabled, reason: reason || null, metadata };

  await db.insert(operationalFlags).values({
    key,
    value,
    updatedBy: userId,
    updatedAt: now,
    createdAt: now,
  }).onConflictDoUpdate({
    target: operationalFlags.key,
    set: { value, updatedBy: userId, updatedAt: now },
  });

  invalidateOperationalFlag(key);
  return c.json({ flag: await buildFlagRow(key) });
});

adminControlsApp.get('/:key/history', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;
  const key = c.req.param('key');
  if (!key) return errorResponse(c, 400, 'key is required');
  // No audit-log table yet — return the current value as a one-element history.
  // Follow-up: add operational_flag_history table if we need a real trail.
  const flag = await buildFlagRow(key);
  return c.json({ history: flag.updated_at ? [flag] : [] });
});

export type AdminControlsListResponse = {
  known_flags: OperationalFlagDescriptor[];
  flags: FlagResponseRow[];
};
