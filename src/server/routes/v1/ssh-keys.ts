import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { sshKeys } from '../../db/schema';
import { fingerprintSSHKey } from '../../lib/crypto';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { broadcastToProviders } from '../../lib/provider-sync';
import { handleRouteError } from '../../lib/route-helpers';

export const sshKeysApp = new Hono<{ Variables: AuthVariables }>();
sshKeysApp.use('*', apiGuard);

sshKeysApp.post('/', async (c) => {
  const body = await c.req.json();
  const { name, public_key } = body;
  if (!name || !public_key) return c.json({ error: true, message: 'name and public_key required', status: 400 }, 400);

  const ownerId = c.get('userId');
  try {
    const fingerprint = fingerprintSSHKey(public_key);

    // Upload to all available providers (non-blocking, best-effort)
    const uploaded = await broadcastToProviders(
      (provider) => provider.uploadSSHKey(`justavps-${name}`, public_key),
      'SSH-KEYS',
    );
    const providerKeyId = uploaded?.result.keyId ?? null;

    const [key] = await db.insert(sshKeys).values({
      ownerId,
      name,
      publicKey: public_key,
      fingerprint,
      providerKeyId,
    }).returning();

    return c.json({ id: key.id, name: key.name, fingerprint: key.fingerprint, created_at: key.createdAt.toISOString() }, 201);
  } catch (err) {
    return handleRouteError(c, err, 'SSH-KEYS');
  }
});

sshKeysApp.get('/', async (c) => {
  const ownerId = c.get('userId');
  const keys = await db.select().from(sshKeys).where(eq(sshKeys.ownerId, ownerId));
  return c.json({ ssh_keys: keys.map((k) => ({ id: k.id, name: k.name, fingerprint: k.fingerprint, created_at: k.createdAt.toISOString() })) });
});

sshKeysApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const [key] = await db.select().from(sshKeys).where(and(eq(sshKeys.id, id), eq(sshKeys.ownerId, ownerId)));
  if (!key) return c.json({ error: true, message: 'SSH key not found', status: 404 }, 404);
  try {
    // Delete from providers (best-effort)
    if (key.providerKeyId) {
      await broadcastToProviders(
        (provider) => provider.deleteSSHKey(key.providerKeyId!),
        'SSH-KEYS',
      );
    }
    await db.delete(sshKeys).where(eq(sshKeys.id, id));
    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'SSH-KEYS');
  }
});
