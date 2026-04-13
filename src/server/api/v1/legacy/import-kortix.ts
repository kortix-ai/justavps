/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

import { db } from '@/server/db';
import { machines, kortixLinks } from '@/server/db/schema';
import { config } from '@/server/lib/config';
import { apiGuard, type AuthVariables } from '@/server/lib/api-guard';

export const importKortixApp = new OpenAPIHono<{ Variables: AuthVariables }>();

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

const ErrorResponseSchema = z.object({
  error: z.boolean(),
  message: z.string(),
});

interface OAuthState {
  state: string;
  codeVerifier: string;
  userId: string;
  createdAt: number;
}

const oauthStates = new Map<string, OAuthState>();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, entry] of oauthStates) {
    if (now - entry.createdAt > STATE_TTL_MS) oauthStates.delete(key);
  }
}

setInterval(cleanupExpiredStates, 60_000);

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function refreshKortixToken(link: typeof kortixLinks.$inferSelect): Promise<string | null> {
  if (!link.refreshTokenEnc) return null;
  try {
    const res = await fetch(`${config.KORTIX_OAUTH_BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: link.refreshTokenEnc,
        client_id: config.KORTIX_OAUTH_CLIENT_ID,
        client_secret: config.KORTIX_OAUTH_CLIENT_SECRET,
      }),
    });
    if (!res.ok) return null;
    const tokens = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
    await db.update(kortixLinks).set({
      accessTokenEnc: tokens.access_token,
      refreshTokenEnc: tokens.refresh_token || link.refreshTokenEnc,
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    }).where(eq(kortixLinks.id, link.id));
    return tokens.access_token;
  } catch {
    return null;
  }
}

async function getValidAccessToken(link: typeof kortixLinks.$inferSelect): Promise<string | null> {
  if (link.tokenExpiresAt && link.tokenExpiresAt < new Date()) return refreshKortixToken(link);
  return link.accessTokenEnc || null;
}

const startRoute = createRoute({
  method: 'get',
  path: '/import/kortix/start',
  tags: ['Import'],
  security: bearerSecurity,
  summary: 'Start Kortix OAuth flow',
  responses: {
    200: { description: 'Authorization URL', content: { 'application/json': { schema: z.object({ authorize_url: z.string() }) } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

importKortixApp.use('/import/kortix/start', apiGuard);

importKortixApp.openapi(startRoute, async (c) => {
  if (!config.isKortixConfigured()) return c.json({ error: true, message: 'Kortix integration is not configured' }, 400) as any;
  const userId = c.get('userId');
  const codeVerifier = base64url(randomBytes(64));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const state = randomBytes(32).toString('hex');
  oauthStates.set(state, { state, codeVerifier, userId, createdAt: Date.now() });
  const redirectUri = `${config.APP_URL}/api/v1/import/kortix/callback`;
  const params = new URLSearchParams({
    client_id: config.KORTIX_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'profile machines:read',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return c.json({ authorize_url: `${config.KORTIX_OAUTH_BASE_URL}/authorize?${params.toString()}` }, 200);
});

const callbackRoute = createRoute({
  method: 'get',
  path: '/import/kortix/callback',
  tags: ['Import'],
  summary: 'Kortix OAuth callback',
  request: { query: z.object({ state: z.string(), code: z.string() }) },
  responses: { 302: { description: 'Redirect to machines page' }, 400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } } },
});

importKortixApp.openapi(callbackRoute, async (c) => {
  const { state, code } = c.req.valid('query');
  const stored = oauthStates.get(state);
  if (!stored) return c.json({ error: true, message: 'Invalid or expired OAuth state' }, 400) as any;
  const stateBuffer = Buffer.from(state, 'hex');
  const storedBuffer = Buffer.from(stored.state, 'hex');
  if (stateBuffer.length !== storedBuffer.length || !timingSafeEqual(stateBuffer, storedBuffer)) return c.json({ error: true, message: 'State mismatch' }, 400) as any;
  oauthStates.delete(state);

  const redirectUri = `${config.APP_URL}/api/v1/import/kortix/callback`;
  const tokenRes = await fetch(`${config.KORTIX_OAUTH_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.KORTIX_OAUTH_CLIENT_ID,
      client_secret: config.KORTIX_OAUTH_CLIENT_SECRET,
      code_verifier: stored.codeVerifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: true, message: 'Token exchange failed' }, 400) as any;
  const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in?: number };
  const userinfoRes = await fetch(`${config.KORTIX_OAUTH_BASE_URL}/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!userinfoRes.ok) return c.json({ error: true, message: 'Failed to fetch Kortix user info' }, 400) as any;
  const userinfo = await userinfoRes.json() as { user_id: string; account_id: string; email?: string };
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
  const [existing] = await db.select().from(kortixLinks).where(eq(kortixLinks.userId, stored.userId));
  if (existing) {
    await db.update(kortixLinks).set({
      kortixUserId: userinfo.user_id,
      kortixAccountId: userinfo.account_id,
      kortixEmail: userinfo.email || null,
      accessTokenEnc: tokens.access_token,
      refreshTokenEnc: tokens.refresh_token || null,
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    }).where(eq(kortixLinks.id, existing.id));
  } else {
    await db.insert(kortixLinks).values({
      userId: stored.userId,
      kortixUserId: userinfo.user_id,
      kortixAccountId: userinfo.account_id,
      kortixEmail: userinfo.email || null,
      accessTokenEnc: tokens.access_token,
      refreshTokenEnc: tokens.refresh_token || null,
      tokenExpiresAt: expiresAt,
    });
  }
  return c.redirect('/machines');
});

const claimRoute = createRoute({
  method: 'post',
  path: '/import/kortix/claim',
  tags: ['Import'],
  security: bearerSecurity,
  summary: 'Claim a Kortix machine',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ machine_id: z.string() }) } } } },
  responses: { 200: { description: 'Machine claimed', content: { 'application/json': { schema: z.object({ ok: z.boolean(), machine: z.object({ id: z.string(), slug: z.string(), status: z.string() }) }) } } }, 400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } }, 401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } }, 404: { description: 'Link not found', content: { 'application/json': { schema: ErrorResponseSchema } } } },
});

importKortixApp.use('/import/kortix/claim', apiGuard);

importKortixApp.openapi(claimRoute, async (c) => {
  if (!config.isKortixConfigured()) return c.json({ error: true, message: 'Kortix integration is not configured' }, 400) as any;
  const userId = c.get('userId');
  const accountId = c.get('accountId');
  const { machine_id } = c.req.valid('json');
  const [link] = await db.select().from(kortixLinks).where(eq(kortixLinks.userId, userId));
  if (!link) return c.json({ error: true, message: 'No Kortix account linked' }, 404) as any;
  const accessToken = await getValidAccessToken(link);
  if (!accessToken) return c.json({ error: true, message: 'Kortix token expired; reconnect your account' }, 401) as any;

  const machineRes = await fetch(`${config.KORTIX_OAUTH_BASE_URL}/machines/${encodeURIComponent(machine_id)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!machineRes.ok) return c.json({ error: true, message: 'Failed to fetch Kortix machine' }, 400) as any;
  const remoteMachine = await machineRes.json() as { id: string; name?: string; status?: string };
  const [machine] = await db.insert(machines).values({
    ownerId: userId,
    accountId,
    slug: `kortix-${machine_id}`,
    name: remoteMachine.name || `Kortix ${machine_id}`,
    status: remoteMachine.status === 'ready' ? 'ready' : 'provisioning',
    provider: 'cloud',
    imageId: null,
    serverType: 'kortix-import',
    region: 'kortix',
    ip: null,
    providerServerId: remoteMachine.id,
    providerMeta: { imported_from: 'kortix', kortix_machine_id: remoteMachine.id },
    machineToken: randomBytes(32).toString('hex'),
    backupsEnabled: false,
    source: 'imported',
    kortixSandboxId: remoteMachine.id,
    priceMonthly: 0,
  }).returning();
  return c.json({ ok: true, machine: { id: machine.id, slug: machine.slug, status: machine.status } });
});
