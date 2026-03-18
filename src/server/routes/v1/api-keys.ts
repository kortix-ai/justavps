import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { apiKeys } from '../../db/schema';
import { generateApiKey } from '../../lib/crypto';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { syncApiKeyToKV, deleteApiKeyFromKV } from '../../lib/proxy-kv';

export const apiKeysApp = new Hono<{ Variables: AuthVariables }>();
apiKeysApp.use('*', apiGuard);

apiKeysApp.post('/', async (c) => {
  const body = await c.req.json();
  const { name } = body;
  if (!name) return c.json({ error: true, message: 'name required', status: 400 }, 400);

  const ownerId = c.get('userId');
  const { key, hash, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({ ownerId, name, keyPrefix: prefix, keyHash: hash }).returning();

  // Sync SHA-256 hash to CF KV for Worker API key auth
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

apiKeysApp.get('/', async (c) => {
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
  });
});

apiKeysApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.ownerId, ownerId)));
  if (!key) return c.json({ error: true, message: 'API key not found', status: 404 }, 404);

  // Remove from KV (best-effort — we don't have the raw key, only the prefix)
  await deleteApiKeyFromKV(key.keyPrefix).catch(() => {});

  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  return c.body(null, 204);
});
