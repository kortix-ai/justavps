import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, desc } from 'drizzle-orm';
import { randomBytes, createHmac } from 'crypto';
import { db } from '../../db';
import { webhooks, webhookDeliveries } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { errorResponse, handleRouteError } from '../../lib/route-helpers';
import {
  CreateWebhookSchema,
  WebhookResponseSchema,
  WebhookListResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const webhooksApp = new OpenAPIHono<{ Variables: AuthVariables }>();
webhooksApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

// ─── POST / — Create Webhook ────────────────────────────────────────────────

const createWebhookRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Webhooks'],
  security: bearerSecurity,
  summary: 'Create a webhook',
  description: 'Subscribes a URL to receive POST requests for specified events. Payloads are signed with HMAC-SHA256 (`X-Signature-256` header).\n\n**Events:** `*`, `machine.stage_changed`, `machine.status_changed`, `machine.heartbeat`',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateWebhookSchema } },
    },
  },
  responses: {
    201: {
      description: 'Webhook created (secret shown once)',
      content: { 'application/json': { schema: WebhookResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

webhooksApp.openapi(createWebhookRoute, async (c) => {
  const parsed = c.req.valid('json');
  const ownerId = c.get('userId');
  const secret = parsed.secret || `whsec_${randomBytes(24).toString('hex')}`;

  try {
    const [webhook] = await db.insert(webhooks).values({
      ownerId,
      url: parsed.url,
      secret,
      events: parsed.events,
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
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

// ─── GET / — List Webhooks ──────────────────────────────────────────────────

const listWebhooksRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Webhooks'],
  security: bearerSecurity,
  summary: 'List webhooks',
  responses: {
    200: {
      description: 'List of webhooks',
      content: { 'application/json': { schema: WebhookListResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

webhooksApp.openapi(listWebhooksRoute, async (c) => {
  const ownerId = c.get('userId');

  try {
    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.ownerId, ownerId));

    return c.json({
      webhooks: rows.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        failure_count: w.failureCount,
        last_delivered_at: w.lastDeliveredAt?.toISOString() ?? null,
        disabled_at: w.disabledAt?.toISOString() ?? null,
        disable_reason: w.disableReason,
        created_at: w.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

// ─── DELETE /:id — Delete Webhook ───────────────────────────────────────────

const deleteWebhookRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Webhooks'],
  security: bearerSecurity,
  summary: 'Delete a webhook',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Webhook ID' }) }),
  },
  responses: {
    204: { description: 'Webhook deleted' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

webhooksApp.openapi(deleteWebhookRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  try {
    const deleted = await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.ownerId, ownerId)))
      .returning();

    if (deleted.length === 0) {
      return errorResponse(c, 404, 'Webhook not found') as any;
    }

    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

webhooksApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (typeof body.url === 'string') updates.url = body.url;
  if (Array.isArray(body.events)) updates.events = body.events;
  if (typeof body.active === 'boolean') {
    updates.active = body.active;
    if (body.active) {
      updates.disabledAt = null;
      updates.disableReason = null;
      updates.failureCount = 0;
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: true, message: 'No fields to update', status: 400 }, 400);
  }

  try {
    const [updated] = await db.update(webhooks)
      .set(updates as any)
      .where(and(eq(webhooks.id, id), eq(webhooks.ownerId, ownerId)))
      .returning();

    if (!updated) return errorResponse(c, 404, 'Webhook not found') as any;

    return c.json({
      id: updated.id,
      url: updated.url,
      events: updated.events,
      active: updated.active,
      failure_count: updated.failureCount,
      last_delivered_at: updated.lastDeliveredAt?.toISOString() ?? null,
      disabled_at: updated.disabledAt?.toISOString() ?? null,
      disable_reason: updated.disableReason,
      created_at: updated.createdAt.toISOString(),
    });
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

webhooksApp.get('/:id/deliveries', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const [hook] = await db.select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.ownerId, ownerId)))
    .limit(1);

  if (!hook) return errorResponse(c, 404, 'Webhook not found') as any;

  try {
    const rows = await db.select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      deliveries: rows.map((d) => ({
        id: d.id,
        event_type: d.eventType,
        payload: d.payload,
        status_code: d.statusCode,
        response_body: d.responseBody,
        duration_ms: d.durationMs,
        attempt: d.attempt,
        success: d.success,
        error: d.error,
        created_at: d.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

webhooksApp.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const [hook] = await db.select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.ownerId, ownerId)))
    .limit(1);

  if (!hook) return errorResponse(c, 404, 'Webhook not found') as any;

  const testPayload = {
    event: 'machine.test',
    data: {
      machineId: '00000000-0000-0000-0000-000000000000',
      ownerId,
      event: 'test',
      message: 'Test webhook delivery from JustAVPS',
      timestamp: new Date().toISOString(),
    },
    delivered_at: new Date().toISOString(),
  };

  const body = JSON.stringify(testPayload);
  const signature = createHmac('sha256', hook.secret).update(body).digest('hex');
  const start = Date.now();

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let success = false;
  let error: string | null = null;

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JustAVPS-Signature': signature,
        'X-JustAVPS-Event': 'machine.test',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    statusCode = res.status;
    responseBody = await res.text().catch(() => '');
    if (responseBody && responseBody.length > 2000) {
      responseBody = responseBody.slice(0, 2000);
    }
    success = res.ok;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err: any) {
    error = err.message?.slice(0, 200) || 'Unknown error';
  }

  const durationMs = Date.now() - start;

  await db.insert(webhookDeliveries).values({
    webhookId: hook.id,
    eventType: 'machine.test',
    payload: testPayload as any,
    statusCode,
    responseBody,
    durationMs,
    attempt: 1,
    success,
    error,
  }).catch(() => {});

  return c.json({ success, status_code: statusCode, duration_ms: durationMs, response_body: responseBody?.slice(0, 500), error });
});
