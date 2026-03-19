/**
 * Kortix import routes — OAuth link + machine claiming.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { db } from '../../db';
import { machines, kortixLinks } from '../../db/schema';
import { config } from '../../lib/config';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';

export const importKortixApp = new OpenAPIHono<{ Variables: AuthVariables }>();

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

const ErrorResponseSchema = z.object({
  error: z.boolean(),
  message: z.string(),
});

// ─── OAuth State Store (in-memory, ephemeral) ──────────────────────────────

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
    if (now - entry.createdAt > STATE_TTL_MS) {
      oauthStates.delete(key);
    }
  }
}

setInterval(cleanupExpiredStates, 60_000);

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Token Refresh Helper ──────────────────────────────────────────────────

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

    const tokens = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await db.update(kortixLinks)
      .set({
        accessTokenEnc: tokens.access_token,
        refreshTokenEnc: tokens.refresh_token || link.refreshTokenEnc,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(kortixLinks.id, link.id));

    return tokens.access_token;
  } catch {
    return null;
  }
}

async function getValidAccessToken(link: typeof kortixLinks.$inferSelect): Promise<string | null> {
  if (link.tokenExpiresAt && link.tokenExpiresAt < new Date()) {
    return refreshKortixToken(link);
  }
  return link.accessTokenEnc || null;
}

// ─── GET /import/kortix/start ──────────────────────────────────────────────

const startRoute = createRoute({
  method: 'get',
  path: '/import/kortix/start',
  tags: ['Import'],
  security: bearerSecurity,
  summary: 'Start Kortix OAuth flow',
  responses: {
    200: {
      description: 'Authorization URL',
      content: { 'application/json': { schema: z.object({ authorize_url: z.string() }) } },
    },
    400: {
      description: 'Bad Request',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

importKortixApp.use('/import/kortix/start', apiGuard);

importKortixApp.openapi(startRoute, async (c) => {
  if (!config.isKortixConfigured()) {
    return c.json({ error: true, message: 'Kortix integration is not configured' }, 400) as any;
  }

  const userId = c.get('userId');

  const codeVerifier = base64url(randomBytes(64));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const state = randomBytes(32).toString('hex');

  oauthStates.set(state, {
    state,
    codeVerifier,
    userId,
    createdAt: Date.now(),
  });

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

  const authorizeUrl = `${config.KORTIX_OAUTH_BASE_URL}/authorize?${params.toString()}`;

  return c.json({ authorize_url: authorizeUrl }, 200);
});

// ─── GET /import/kortix/callback ───────────────────────────────────────────

const callbackRoute = createRoute({
  method: 'get',
  path: '/import/kortix/callback',
  tags: ['Import'],
  summary: 'Kortix OAuth callback',
  request: {
    query: z.object({
      state: z.string(),
      code: z.string(),
    }),
  },
  responses: {
    302: { description: 'Redirect to machines page' },
    400: {
      description: 'Bad Request',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

importKortixApp.openapi(callbackRoute, async (c) => {
  const { state, code } = c.req.valid('query');

  const stored = oauthStates.get(state);
  if (!stored) {
    return c.json({ error: true, message: 'Invalid or expired OAuth state' }, 400) as any;
  }

  const stateBuffer = Buffer.from(state, 'hex');
  const storedBuffer = Buffer.from(stored.state, 'hex');
  if (stateBuffer.length !== storedBuffer.length || !timingSafeEqual(stateBuffer, storedBuffer)) {
    return c.json({ error: true, message: 'State mismatch' }, 400) as any;
  }

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

  if (!tokenRes.ok) {
    const err = await tokenRes.text().catch(() => 'unknown');
    console.error('[IMPORT_KORTIX] Token exchange failed:', err);
    return c.json({ error: true, message: 'Token exchange failed' }, 400) as any;
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const userinfoRes = await fetch(`${config.KORTIX_OAUTH_BASE_URL}/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userinfoRes.ok) {
    console.error('[IMPORT_KORTIX] Userinfo fetch failed:', await userinfoRes.text().catch(() => ''));
    return c.json({ error: true, message: 'Failed to fetch Kortix user info' }, 400) as any;
  }

  const userinfo = await userinfoRes.json() as {
    user_id: string;
    account_id: string;
    email?: string;
  };

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  const [existing] = await db.select()
    .from(kortixLinks)
    .where(eq(kortixLinks.userId, stored.userId));

  if (existing) {
    await db.update(kortixLinks)
      .set({
        kortixUserId: userinfo.user_id,
        kortixAccountId: userinfo.account_id,
        kortixEmail: userinfo.email || null,
        accessTokenEnc: tokens.access_token,
        refreshTokenEnc: tokens.refresh_token || null,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(kortixLinks.id, existing.id));
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

  return c.redirect(`${config.APP_URL}/machines?import=kortix`);
});

// ─── GET /import/kortix/machines ───────────────────────────────────────────

const listClaimableRoute = createRoute({
  method: 'get',
  path: '/import/kortix/machines',
  tags: ['Import'],
  security: bearerSecurity,
  summary: 'List claimable Kortix machines',
  responses: {
    200: {
      description: 'Claimable machines',
      content: {
        'application/json': {
          schema: z.object({
            machines: z.array(z.object({
              sandbox_id: z.string(),
              external_id: z.string(),
              name: z.string(),
              status: z.string(),
              created_at: z.string(),
            })),
          }),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Not Found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

importKortixApp.use('/import/kortix/machines', apiGuard);

importKortixApp.openapi(listClaimableRoute, async (c) => {
  const userId = c.get('userId');

  const [link] = await db.select()
    .from(kortixLinks)
    .where(eq(kortixLinks.userId, userId));

  if (!link) {
    return c.json({ error: true, message: 'No Kortix account linked' }, 404) as any;
  }

  const accessToken = await getValidAccessToken(link);
  if (!accessToken) {
    return c.json({ error: true, message: 'Kortix token expired — please re-link your account' }, 400) as any;
  }

  const res = await fetch(`${config.KORTIX_OAUTH_BASE_URL}/claimable-machines`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    console.error('[IMPORT_KORTIX] claimable-machines failed:', await res.text().catch(() => ''));
    return c.json({ error: true, message: 'Failed to fetch claimable machines from Kortix' }, 400) as any;
  }

  const data = await res.json() as {
    machines: Array<{
      sandbox_id: string;
      external_id: string;
      name: string;
      status: string;
      created_at: string;
    }>;
  };

  return c.json({ machines: data.machines }, 200);
});

// ─── POST /import/kortix/claim ─────────────────────────────────────────────

const claimRoute = createRoute({
  method: 'post',
  path: '/import/kortix/claim',
  tags: ['Import'],
  security: bearerSecurity,
  summary: 'Claim Kortix machines',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            machine_ids: z.array(z.string()).min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Claim result',
      content: {
        'application/json': {
          schema: z.object({
            claimed: z.array(z.string()),
            skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
          }),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Not Found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

importKortixApp.use('/import/kortix/claim', apiGuard);

importKortixApp.openapi(claimRoute, async (c) => {
  const userId = c.get('userId');
  const { machine_ids } = c.req.valid('json');

  const [link] = await db.select()
    .from(kortixLinks)
    .where(eq(kortixLinks.userId, userId));

  if (!link) {
    return c.json({ error: true, message: 'No Kortix account linked' }, 404) as any;
  }

  const accessToken = await getValidAccessToken(link);
  if (!accessToken) {
    return c.json({ error: true, message: 'Kortix token expired — please re-link your account' }, 400) as any;
  }

  const claimableRes = await fetch(`${config.KORTIX_OAUTH_BASE_URL}/claimable-machines`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!claimableRes.ok) {
    return c.json({ error: true, message: 'Failed to verify claimable machines' }, 400) as any;
  }

  const claimableData = await claimableRes.json() as {
    machines: Array<{ sandbox_id: string; external_id: string }>;
  };

  const claimableMap = new Map(
    claimableData.machines.map(m => [m.external_id, m.sandbox_id])
  );

  const claimed: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const machineId of machine_ids) {
    const sandboxId = claimableMap.get(machineId);
    if (!sandboxId) {
      skipped.push({ id: machineId, reason: 'Not in claimable machines list' });
      continue;
    }

    const [machine] = await db.select()
      .from(machines)
      .where(eq(machines.id, machineId));

    if (!machine) {
      skipped.push({ id: machineId, reason: 'Machine not found' });
      continue;
    }

    if (machine.source === 'kortix' && machine.ownerId !== userId) {
      skipped.push({ id: machineId, reason: 'Already claimed by another user' });
      continue;
    }

    if (machine.ownerId === userId && machine.source === 'kortix') {
      skipped.push({ id: machineId, reason: 'Already owned by you' });
      continue;
    }

    await db.update(machines)
      .set({
        ownerId: userId,
        source: 'kortix',
        kortixSandboxId: sandboxId,
        stripeSubItemId: null,
      })
      .where(eq(machines.id, machineId));

    claimed.push(machineId);
  }

  return c.json({ claimed, skipped }, 200);
});

// ─── GET /import/kortix/status ─────────────────────────────────────────────

const statusRoute = createRoute({
  method: 'get',
  path: '/import/kortix/status',
  tags: ['Import'],
  security: bearerSecurity,
  summary: 'Kortix link status',
  responses: {
    200: {
      description: 'Link status',
      content: {
        'application/json': {
          schema: z.object({
            linked: z.boolean(),
            kortix_email: z.string().nullable(),
          }),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

importKortixApp.use('/import/kortix/status', apiGuard);

importKortixApp.openapi(statusRoute, async (c) => {
  const userId = c.get('userId');

  const [link] = await db.select()
    .from(kortixLinks)
    .where(eq(kortixLinks.userId, userId));

  return c.json({
    linked: !!link,
    kortix_email: link?.kortixEmail || null,
  }, 200);
});
