import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { db } from '../../db';
import { webhooks } from '../../db/schema';
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
