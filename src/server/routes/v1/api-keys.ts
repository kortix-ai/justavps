import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { apiKeys } from '../../db/schema';
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
  },
});

apiKeysApp.openapi(createAPIKeyRoute, async (c) => {
  const { name } = c.req.valid('json');
  const ownerId = c.get('userId');
  const { key, hash, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({ ownerId, name, keyPrefix: prefix, keyHash: hash }).returning();

  await syncApiKeyToKV(key, ownerId, name).catch((err: unknown) => {
    console.warn('[API-KEYS] Failed to sync API key to KV:', err);
  });

  return c.json({
    id: apiKey.id,
    name: apiKey.name,
    key,  // Only shown ONCE
    key_prefix: apiKey.keyPrefix,
    created_at: apiKey.createdAt.toISOString(),
    last_used: null,
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
  const ownerId = c.get('userId');
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.ownerId, ownerId));
  return c.json({
    api_keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      key_prefix: k.keyPrefix,
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
  },
});

apiKeysApp.openapi(deleteAPIKeyRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.ownerId, ownerId)));
  if (!key) return c.json({ error: true, message: 'API key not found', status: 404 }, 404);

  await deleteApiKeyFromKV(key.keyPrefix).catch(() => {});

  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  return c.body(null, 204);
});
