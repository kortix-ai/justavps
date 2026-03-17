/**
 * Internal routes — called by machines (agents) and Cloudflare Workers.
 * No API key auth — IP-restricted at the Cloudflare/proxy level.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { machines, apiKeys } from '../../db/schema';
import { validateApiKey } from '../../lib/crypto';
import { cloudflareClient } from '../../lib/cloudflare';
import { config } from '../../lib/config';
import { errorResponse } from '../../lib/route-helpers';
import { eventBus } from '../../lib/event-bus';
import { HeartbeatSchema } from '@/lib/schemas';
import { z } from 'zod';

export const internalApp = new Hono();

// ─── Schemas ────────────────────────────────────────────────────────────────

const StageReportSchema = z.object({
  slug: z.string().min(1),
  machine_token: z.string().min(1),
  stage: z.string().min(1),
  message: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── POST /heartbeat — Agent heartbeat callback ─────────────────────────────

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

    // Emit events
    if (wasProvisioning) {
      await eventBus.emitStatusChange(machine.id, machine.ownerId, 'ready', 'Machine is ready');
    }
    eventBus.emit({
      machineId: machine.id,
      ownerId: machine.ownerId,
      event: 'heartbeat',
      metadata: { uptime, services, load },
      timestamp: new Date().toISOString(),
    });

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

// ─── POST /stage — Machine reports provisioning stage ───────────────────────

internalApp.post('/stage', async (c) => {
  const body = await c.req.json();
  const parsed = StageReportSchema.safeParse(body);
  if (!parsed.success) return errorResponse(c, 400, 'Invalid stage report');

  const { slug, machine_token, stage, message, metadata } = parsed.data;

  try {
    const [machine] = await db.select().from(machines).where(eq(machines.slug, slug));
    if (!machine || machine.machineToken !== machine_token) {
      return errorResponse(c, 401, 'Unauthorized');
    }

    await eventBus.emitStageChange(machine.id, machine.ownerId, stage, message, metadata);

    console.log(`[STAGE] ${slug}: ${stage}${message ? ` — ${message}` : ''}`);
    return c.json({ ack: true });
  } catch (err) {
    console.error('[STAGE] error:', err);
    return errorResponse(c, 500, 'Failed to process stage report');
  }
});

// ─── GET /validate-key — Validate API key (called by CF Worker for auth) ────

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
