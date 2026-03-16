import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { machines, apiKeys } from '../db/schema';
import { validateApiKey } from '../lib/crypto';
import { cloudflareClient } from '../lib/cloudflare';
import { config } from '../lib/config';
import { errorResponse } from '../lib/route-helpers';
import { HeartbeatSchema } from '@/lib/schemas';

export const internalApp = new Hono();

// POST /heartbeat → Agent heartbeat callback (from justavps-agent on VPS)
internalApp.post('/heartbeat', async (c) => {
  const body = await c.req.json();
  const parsed = HeartbeatSchema.safeParse(body);
  if (!parsed.success) return errorResponse(c, 400, 'Invalid heartbeat');

  const { slug, machine_token, uptime, services, load } = parsed.data;
  try {
    const [machine] = await db.select().from(machines).where(eq(machines.slug, slug));
    if (!machine || machine.machineToken !== machine_token) {
      return errorResponse(c, 401, 'Unauthorized');
    }

    const wasProvisioning = machine.status === 'provisioning';
    await db.update(machines).set({
      lastHeartbeatAt: new Date(),
      lastHeartbeat: { cpu: load.cpu, memory: load.memory, disk: load.disk, services },
      ...(wasProvisioning ? { status: 'ready', readyAt: new Date() } : {}),
    }).where(eq(machines.id, machine.id));

    // Update KV status to 'ready' so proxy Worker allows traffic
    if (wasProvisioning && config.isCloudflareConfigured() && machine.ip) {
      cloudflareClient.writeKVMachine(slug, {
        owner_id: machine.ownerId,
        ip: machine.ip,
        status: 'ready',
        server_type: machine.serverType,
      }).catch(() => {});
    }

    return c.json({ ack: true });
  } catch (err) {
    console.error('[HEARTBEAT] error:', err);
    return errorResponse(c, 500, 'Failed to process heartbeat');
  }
});

// GET /validate-key → Validate API key (called by CF Worker for auth)
// IP-restricted in production via CF Worker firewall
internalApp.get('/validate-key', async (c) => {
  const keyValue = c.req.query('key');
  const machineSlug = c.req.query('machine_slug');

  if (!keyValue) return errorResponse(c, 400, 'key required');

  try {
    const keys = await db.select().from(apiKeys);
    for (const key of keys) {
      if (await validateApiKey(keyValue, key.keyHash)) {
        await db.update(apiKeys).set({ lastUsed: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => {});

        if (machineSlug) {
          const [machine] = await db.select().from(machines).where(eq(machines.slug, machineSlug));
          if (!machine || machine.ownerId !== key.ownerId) {
            return c.json({ valid: false, message: 'Key does not own this machine' }, 403);
          }
        }
        return c.json({ valid: true, owner_id: key.ownerId });
      }
    }
    return c.json({ valid: false }, 401);
  } catch (err) {
    return c.json({ valid: false, message: 'DB unavailable' }, 503);
  }
});
