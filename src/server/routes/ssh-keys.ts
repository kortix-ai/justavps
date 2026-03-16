import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { sshKeys } from '../db/schema';
import { hetznerClient } from '../lib/hetzner';
import { fingerprintSSHKey } from '../lib/crypto';
import { config } from '../lib/config';
import { apiGuard, type AuthVariables } from '../lib/api-guard';

export const sshKeysApp = new Hono<{ Variables: AuthVariables }>();
sshKeysApp.use('*', apiGuard);

sshKeysApp.post('/', async (c) => {
  const body = await c.req.json();
  const { name, public_key } = body;
  if (!name || !public_key) return c.json({ error: true, message: 'name and public_key required', status: 400 }, 400);

  const ownerId = c.get('userId');
  try {
    const fingerprint = fingerprintSSHKey(public_key);
    let hetznerKeyId: number | null = null;
    if (config.isHetznerConfigured()) {
      try {
        const result = await hetznerClient.uploadSSHKey(`justavps-${name}`, public_key);
        hetznerKeyId = result.keyId;
      } catch (err: any) {
        // Hetzner may reject the key (invalid format, already exists, etc.)
        // Log but continue — key is still stored locally in our DB
        console.warn('[SSH-KEYS] Hetzner upload failed (non-fatal):', err.message?.slice(0, 200));
      }
    }
    const [key] = await db.insert(sshKeys).values({ ownerId, name, publicKey: public_key, fingerprint, hetznerKeyId }).returning();
    return c.json({ id: key.id, name: key.name, fingerprint: key.fingerprint, created_at: key.createdAt.toISOString() }, 201);
  } catch (err) {
    console.error('[SSH-KEYS] create error:', err);
    return c.json({ error: true, message: 'Failed to add SSH key', status: 500 }, 500);
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
    if (key.hetznerKeyId && config.isHetznerConfigured()) await hetznerClient.deleteSSHKey(key.hetznerKeyId).catch(() => {});
    await db.delete(sshKeys).where(eq(sshKeys.id, id));
    return c.body(null, 204);
  } catch (err) {
    return c.json({ error: true, message: 'Failed to delete SSH key', status: 500 }, 500);
  }
});
