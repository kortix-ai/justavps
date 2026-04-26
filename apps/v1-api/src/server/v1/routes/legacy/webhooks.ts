/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, desc } from 'drizzle-orm';
import { randomBytes } from 'crypto';

import { db } from '@/server/db';
import { webhooks, webhookDeliveries } from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse, handleRouteError } from "@/server/core/route-helpers";
import {
  CreateWebhookSchema,
  WebhookResponseSchema,
  WebhookListResponseSchema,
  ErrorResponseSchema,
} from '@/shared/lib/schemas';

export const webhooksApp = new OpenAPIHono<{ Variables: AuthVariables }>();
webhooksApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

const createWebhookRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Webhooks'],
  security: bearerSecurity,
  summary: 'Create a webhook',
  description: 'Subscribes a URL to receive POST requests for specified events. Payloads are signed with HMAC-SHA256 (`X-Signature-256` header).\n\n**Events:** `*`, `machine.stage_changed`, `machine.status_changed`, `machine.heartbeat`',
  request: { body: { required: true, content: { 'application/json': { schema: CreateWebhookSchema } } } },
  responses: {
    201: { description: 'Webhook created (secret shown once)', content: { 'application/json': { schema: WebhookResponseSchema } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

webhooksApp.openapi(createWebhookRoute, async (c) => {
  const parsed = c.req.valid('json');
  const ownerId = c.get('userId');
  const accountId = c.get('accountId');
  const secret = parsed.secret || `whsec_${randomBytes(24).toString('hex')}`;
  try {
    const [webhook] = await db.insert(webhooks).values({ ownerId, accountId, url: parsed.url, secret, events: parsed.events, active: true }).returning();
    return c.json({ id: webhook.id, url: webhook.url, events: webhook.events, secret, active: webhook.active, created_at: webhook.createdAt.toISOString() }, 201);
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

const listWebhooksRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Webhooks'],
  security: bearerSecurity,
  summary: 'List webhooks',
  responses: { 200: { description: 'List of webhooks', content: { 'application/json': { schema: WebhookListResponseSchema } } }, 401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } } },
});

webhooksApp.openapi(listWebhooksRoute, async (c) => {
  const accountId = c.get('accountId');
  try {
    const rows = await db.select().from(webhooks).where(eq(webhooks.accountId, accountId));
    return c.json({ webhooks: rows.map((w) => ({ id: w.id, url: w.url, events: w.events, active: w.active, failure_count: w.failureCount, last_delivered_at: w.lastDeliveredAt?.toISOString() ?? null, disabled_at: w.disabledAt?.toISOString() ?? null, disable_reason: w.disableReason, created_at: w.createdAt.toISOString() })) });
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

const deleteWebhookRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Webhooks'],
  security: bearerSecurity,
  summary: 'Delete a webhook',
  request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Webhook ID' }) }) },
  responses: { 204: { description: 'Webhook deleted' }, 401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } }, 404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } } },
});

webhooksApp.openapi(deleteWebhookRoute, async (c) => {
  const { id } = c.req.valid('param');
  const accountId = c.get('accountId');
  try {
    const deleted = await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId))).returning();
    if (deleted.length === 0) return errorResponse(c, 404, 'Webhook not found') as any;
    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

webhooksApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const accountId = c.get('accountId');
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
  if (Object.keys(updates).length === 0) return c.json({ error: true, message: 'No fields to update', status: 400 }, 400);
  try {
    const [updated] = await db.update(webhooks).set(updates as any).where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId))).returning();
    if (!updated) return errorResponse(c, 404, 'Webhook not found') as any;
    return c.json({ id: updated.id, url: updated.url, events: updated.events, active: updated.active, failure_count: updated.failureCount, last_delivered_at: updated.lastDeliveredAt?.toISOString() ?? null, disabled_at: updated.disabledAt?.toISOString() ?? null, disable_reason: updated.disableReason, created_at: updated.createdAt.toISOString() });
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});

webhooksApp.get('/:id/deliveries', async (c) => {
  const id = c.req.param('id');
  const accountId = c.get('accountId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const [hook] = await db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId))).limit(1);
  if (!hook) return errorResponse(c, 404, 'Webhook not found') as any;
  try {
    const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id)).orderBy(desc(webhookDeliveries.createdAt)).limit(limit).offset(offset);
    return c.json({ deliveries: rows.map((d) => ({ id: d.id, event: d.eventType, status_code: d.statusCode, success: d.success, duration_ms: d.durationMs, attempts: d.attempt, next_attempt_at: d.nextAttemptAt?.toISOString() ?? null, delivered_at: d.deliveredAt?.toISOString() ?? null, created_at: d.createdAt.toISOString() })) });
  } catch (err) {
    return handleRouteError(c, err, 'WEBHOOKS') as any;
  }
});
