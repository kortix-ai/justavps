/**
 * Proxy tokens — shareable, expiring machine access tokens.
 *
 * POST   /proxy-tokens          — Create a proxy token
 * GET    /proxy-tokens          — List active tokens
 * DELETE /proxy-tokens/:id      — Revoke a token
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { proxyTokens, machines } from '../../db/schema';
import { generateProxyToken } from '../../lib/crypto';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { syncProxyTokenToKV, deleteProxyTokenFromKV } from '../../lib/proxy-kv';
import { config } from '../../lib/config';
import {
  CreateProxyTokenSchema,
  ProxyTokenResponseSchema,
  ProxyTokenListResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const proxyTokensApp = new OpenAPIHono<{ Variables: AuthVariables }>();
proxyTokensApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

// ─── POST / — Create Proxy Token ────────────────────────────────────────────

const createProxyTokenRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Proxy Tokens'],
  security: bearerSecurity,
  summary: 'Create a proxy token',
  description: 'Create a short-lived token for sharing machine access. The full token is only returned once.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateProxyTokenSchema } },
    },
  },
  responses: {
    201: {
      description: 'Proxy token created',
      content: { 'application/json': { schema: ProxyTokenResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Machine not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: { description: 'Worker proxy-token cache sync failed', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

proxyTokensApp.openapi(createProxyTokenRoute, async (c) => {
  const body = c.req.valid('json');
  const ownerId = c.get('userId');
  const accountId = c.get('accountId');

  // Verify machine exists and user owns it
  const [machine] = await db.select().from(machines).where(
    and(eq(machines.id, body.machine_id), eq(machines.accountId, accountId)),
  );
  if (!machine) {
    return c.json({ error: true, message: 'Machine not found or not owned by you', status: 404 }, 404);
  }

  const expiresInSeconds = body.expires_in_seconds ?? 3600;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const ports = body.ports ?? null;

  const { token, hash, sha256, prefix } = await generateProxyToken();

  const [row] = await db.insert(proxyTokens).values({
    ownerId,
    accountId,
    machineId: body.machine_id,
    tokenHash: hash,
    tokenSha256: sha256,
    tokenPrefix: prefix,
    label: body.label ?? null,
    ports,
    expiresAt,
  }).returning();

  try {
    await syncProxyTokenToKV(token, {
      account_id: accountId,
      machine_id: machine.id,
      machine_slug: machine.slug,
      ports,
      expires_at: expiresAt.toISOString(),
    }, expiresInSeconds);
  } catch (error) {
    await db.delete(proxyTokens).where(eq(proxyTokens.id, row.id)).catch(() => {});
    return c.json({
      error: true,
      message: `Failed to sync proxy token to Worker auth cache: ${error instanceof Error ? error.message : String(error)}`,
      status: 502,
    }, 502);
  }

  // Build proxy URL
  const firstPort = ports?.[0];
  const baseUrl = !firstPort || firstPort === 80
    ? `https://${machine.slug}.${config.PROXY_DOMAIN}`
    : `https://${firstPort}--${machine.slug}.${config.PROXY_DOMAIN}`;
  const proxyUrl = `${baseUrl}?__proxy_token=${token}`;

  return c.json({
    id: row.id,
    token,  // Only shown ONCE
    token_prefix: row.tokenPrefix,
    label: row.label ?? null,
    machine_id: row.machineId,
    machine_slug: machine.slug,
    ports: row.ports ?? null,
    expires_at: row.expiresAt.toISOString(),
    proxy_url: proxyUrl,
    created_at: row.createdAt.toISOString(),
  }, 201);
});

// ─── GET / — List Proxy Tokens ──────────────────────────────────────────────

const listProxyTokensRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Proxy Tokens'],
  security: bearerSecurity,
  summary: 'List proxy tokens',
  description: 'Returns active (non-revoked, non-expired) proxy tokens. Optionally filter by machine_id.',
  request: {
    query: z.object({
      machine_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of proxy tokens',
      content: { 'application/json': { schema: ProxyTokenListResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

proxyTokensApp.openapi(listProxyTokensRoute, async (c) => {
  const accountId = c.get('accountId');
  const machineIdFilter = c.req.query('machine_id');

  const conditions = [
    eq(proxyTokens.accountId, accountId),
    isNull(proxyTokens.revokedAt),
  ];
  if (machineIdFilter) {
    conditions.push(eq(proxyTokens.machineId, machineIdFilter));
  }

  const tokens = await db.select({
    token: proxyTokens,
    machineSlug: machines.slug,
  })
    .from(proxyTokens)
    .innerJoin(machines, eq(proxyTokens.machineId, machines.id))
    .where(and(...conditions));

  // Filter out expired tokens in app layer (simpler than SQL date comparison)
  const now = new Date();
  const active = tokens.filter((t) => t.token.expiresAt > now);

  return c.json({
    proxy_tokens: active.map((t) => ({
      id: t.token.id,
      token_prefix: t.token.tokenPrefix,
      label: t.token.label ?? null,
      machine_id: t.token.machineId,
      machine_slug: t.machineSlug,
      ports: t.token.ports ?? null,
      expires_at: t.token.expiresAt.toISOString(),
      created_at: t.token.createdAt.toISOString(),
    })),
  }, 200);
});

// ─── DELETE /:id — Revoke Proxy Token ───────────────────────────────────────

const revokeProxyTokenRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Proxy Tokens'],
  security: bearerSecurity,
  summary: 'Revoke a proxy token',
  description: 'Revokes a proxy token. Access using it will immediately fail.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Proxy Token ID' }) }),
  },
  responses: {
    204: { description: 'Proxy token revoked' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: { description: 'Worker proxy-token revoke failed', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

proxyTokensApp.openapi(revokeProxyTokenRoute, async (c) => {
  const { id } = c.req.valid('param');
  const accountId = c.get('accountId');

  const [token] = await db.select().from(proxyTokens).where(
    and(eq(proxyTokens.id, id), eq(proxyTokens.accountId, accountId)),
  );
  if (!token) {
    return c.json({ error: true, message: 'Proxy token not found', status: 404 }, 404);
  }

  try {
    await deleteProxyTokenFromKV(token.tokenSha256);
  } catch (error) {
    return c.json({
      error: true,
      message: `Failed to revoke proxy token from Worker auth cache: ${error instanceof Error ? error.message : String(error)}`,
      status: 502,
    }, 502);
  }

  // Set revoked_at only after Worker auth cache revoke succeeds.
  await db.update(proxyTokens).set({ revokedAt: new Date() }).where(eq(proxyTokens.id, id));

  return c.body(null, 204);
});
