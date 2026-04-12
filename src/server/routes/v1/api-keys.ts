import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { apiKeys, machines } from '../../db/schema';
import { generateApiKey } from '../../lib/crypto';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { syncApiKeyToKV, deleteApiKeyFromKV } from '../../lib/proxy-kv';
import {
  CreateAPIKeySchema,
  APIKeyResponseSchema,
  APIKeyListResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const apiKeysApp = new OpenAPIHono<{ Variables: AuthVariables }>();
apiKeysApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

// ─── POST / — Create API Key ────────────────────────────────────────────────

const createAPIKeyRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['API Keys'],
  security: bearerSecurity,
  summary: 'Create an API key',
  description: '**The full key is only returned once in this response.** Store it securely.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateAPIKeySchema } },
    },
  },
  responses: {
    201: {
      description: 'API key created',
      content: { 'application/json': { schema: APIKeyResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: { description: 'Worker auth cache sync failed', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

apiKeysApp.openapi(createAPIKeyRoute, async (c) => {
  const body = c.req.valid('json');
  const ownerId = c.get('userId');
  const accountId = c.get('accountId');

  // Validate scope + machine_ids consistency
  const scope = body.scope ?? 'account';
  const machineIds = body.machine_ids ?? null;
  const permissions = body.permissions ?? ['*'];
  if (scope === 'machine' && (!machineIds || machineIds.length === 0)) {
    return c.json({ error: true, message: 'machine_ids is required when scope is "machine"', status: 400 }, 400);
  }

  if (scope === 'machine' && machineIds) {
    const ownedMachines = await db.select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.accountId, accountId), inArray(machines.id, machineIds)));
    if (ownedMachines.length !== machineIds.length) {
      return c.json({ error: true, message: 'machine_ids must belong to the active account', status: 400 }, 400);
    }
  }

  // Compute expiration
  const expiresAt = body.expires_in_seconds
    ? new Date(Date.now() + body.expires_in_seconds * 1000)
    : null;

  const { key, hash, sha256, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({
    ownerId,
    accountId,
    name: body.name,
    keyPrefix: prefix,
    keyHash: hash,
    keySha256: sha256,
    scope,
    machineIds: machineIds,
    permissions,
    expiresAt,
  }).returning();

  try {
    await syncApiKeyToKV(key, accountId, body.name, {
      scope,
      machineIds,
      permissions,
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  } catch (error) {
    await db.delete(apiKeys).where(eq(apiKeys.id, apiKey.id)).catch(() => {});
    return c.json({
      error: true,
      message: `Failed to sync API key to Worker auth cache: ${error instanceof Error ? error.message : String(error)}`,
      status: 502,
    }, 502);
  }

  return c.json({
    id: apiKey.id,
    name: apiKey.name,
    key,  // Only shown ONCE
    key_prefix: apiKey.keyPrefix,
    scope: apiKey.scope as 'account' | 'machine',
    machine_ids: apiKey.machineIds ?? null,
    permissions: apiKey.permissions,
    expires_at: apiKey.expiresAt?.toISOString() ?? null,
    created_at: apiKey.createdAt.toISOString(),
    last_used: null as string | null,
  }, 201);
});

// ─── GET / — List API Keys ──────────────────────────────────────────────────

const listAPIKeysRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['API Keys'],
  security: bearerSecurity,
  summary: 'List API keys',
  description: 'Returns all API keys. Full key value is never returned after creation.',
  responses: {
    200: {
      description: 'List of API keys',
      content: { 'application/json': { schema: APIKeyListResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

apiKeysApp.openapi(listAPIKeysRoute, async (c) => {
  const accountId = c.get('accountId');
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.accountId, accountId));
  return c.json({
    api_keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      key_prefix: k.keyPrefix,
      scope: k.scope as 'account' | 'machine',
      machine_ids: k.machineIds ?? null,
      permissions: k.permissions,
      expires_at: k.expiresAt?.toISOString() ?? null,
      created_at: k.createdAt.toISOString(),
      last_used: k.lastUsed?.toISOString() ?? null,
    })),
  }, 200);
});

// ─── DELETE /:id — Delete API Key ───────────────────────────────────────────

const deleteAPIKeyRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['API Keys'],
  security: bearerSecurity,
  summary: 'Delete an API key',
  description: 'Permanently revokes the API key. Requests using it will immediately fail.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'API Key ID' }) }),
  },
  responses: {
    204: { description: 'API key deleted' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: { description: 'Worker auth cache revoke failed', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

apiKeysApp.openapi(deleteAPIKeyRoute, async (c) => {
  const { id } = c.req.valid('param');
  const accountId = c.get('accountId');
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, accountId)));
  if (!key) return c.json({ error: true, message: 'API key not found', status: 404 }, 404);

  if (key.keySha256) {
    try {
      await deleteApiKeyFromKV(key.keySha256);
    } catch (error) {
      return c.json({
        error: true,
        message: `Failed to revoke API key from Worker auth cache: ${error instanceof Error ? error.message : String(error)}`,
        status: 502,
      }, 502);
    }
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  return c.body(null, 204);
});
