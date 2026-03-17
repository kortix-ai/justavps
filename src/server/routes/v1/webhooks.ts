import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../../db';
import { webhooks } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { errorResponse, handleRouteError } from '../../lib/route-helpers';

export const webhooksApp = new Hono<{ Variables: AuthVariables }>();
webhooksApp.use('*', apiGuard);

const VALID_EVENTS = [
  '*',
  'machine.stage_changed',
  'machine.status_changed',
  'machine.heartbeat',
] as const;

const CreateWebhookSchema = z.object({
  url: z.string().url().describe('HTTPS URL to receive webhook POSTs'),
  events: z.array(z.string()).min(1).describe('Event types to subscribe to (e.g. ["machine.stage_changed", "*"])'),
  secret: z.string().min(16).optional().describe('HMAC secret for signature verification (auto-generated if omitted)'),
});

webhooksApp.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = CreateWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, 400, parsed.error.message);
  }

  const ownerId = c.get('userId');
  const secret = parsed.data.secret || `whsec_${randomBytes(24).toString('hex')}`;

  try {
    const [webhook] = await db.insert(webhooks).values({
      ownerId,
      url: parsed.data.url,
      secret,
      events: parsed.data.events,
      active: true,
    }).returning();

    return c.json({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      secret,
      active: webhook.active,
      created_at: webhook.createdAt.toISOString(),
    }, 201);
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS');
  }
});

webhooksApp.get('/', async (c) => {
  const ownerId = c.get('userId');

  try {
    const rows = await db
      .select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        active: webhooks.active,
        createdAt: webhooks.createdAt,
      })
      .from(webhooks)
      .where(eq(webhooks.ownerId, ownerId));

    return c.json({
      webhooks: rows.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        created_at: w.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS');
  }
});

webhooksApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  try {
    const deleted = await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.ownerId, ownerId)))
      .returning();

    if (deleted.length === 0) {
      return errorResponse(c, 404, 'Webhook not found');
    }

    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS');
  }
});
