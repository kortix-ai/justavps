import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { apiKeys } from '../db/schema';
import { generateApiKey } from '../lib/crypto';
import { authMiddleware, type AuthVariables } from '../lib/middleware';

export const apiKeysApp = new Hono<{ Variables: AuthVariables }>();
apiKeysApp.use('*', authMiddleware);

apiKeysApp.post('/', async (c) => {
  const body = await c.req.json();
  const { name } = body;
  if (!name) return c.json({ error: true, message: 'name required', status: 400 }, 400);

  const ownerId = c.get('userId');
  const { key, hash, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({ ownerId, name, keyPrefix: prefix, keyHash: hash }).returning();

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
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  return c.body(null, 204);
});
