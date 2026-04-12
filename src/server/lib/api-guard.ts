/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'crypto';
import { decode } from 'next-auth/jwt';
import { setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { apiKeys, users } from '../db/schema';
import { ensureAutoAdminUser } from './auto-admin';
import {
  ACCOUNT_COOKIE_NAME,
  ensureUserAccountGraph,
  isAccountAdmin,
  isAccountOwner,
  resolveAccountForUser,
} from './accounts';
import { validateApiKey } from './crypto';

export type Permission = 'read' | 'write' | 'delete' | 'exec' | 'proxy' | '*';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function buildApiKeyPrefix(key: string): string {
  return `${key.slice(0, 16)}...`;
}

export type AuthVariables = {
  userId: string;
  accountId: string;
  accountRole: 'owner' | 'admin' | 'member' | null;
  isAccountOwner: boolean;
  isAccountAdmin: boolean;
  isAdmin: boolean;
  apiKeyScope?: string;
  apiKeyMachineIds?: string[] | null;
  apiKeyPermissions?: string[];
};

function extractCookieValue(cookieHeader: string, name: string): string | null {
  const regex = new RegExp(`(?:^|;\\s*)${name.replace(/\./g, '\\.')}=([^;]+)`);
  const match = cookieHeader.match(regex);
  return match ? decodeURIComponent(match[1]) : null;
}

function extractSessionCookie(cookieHeader: string): { value: string; salt: string } | null {
  const patterns: { name: string; salt: string }[] = [
    { name: '__Secure-authjs.session-token', salt: '__Secure-authjs.session-token' },
    { name: 'authjs.session-token', salt: 'authjs.session-token' },
    { name: 'next-auth.session-token', salt: 'next-auth.session-token' },
  ];

  for (const { name, salt } of patterns) {
    const value = extractCookieValue(cookieHeader, name);
    if (value) return { value, salt };
  }

  return null;
}

function extractRequestedAccountId(c: any): { accountId: string | null; source: 'header' | 'cookie' | 'none' } {
  const headerAccountId = c.req.header('X-Account-Id');
  if (headerAccountId) return { accountId: headerAccountId, source: 'header' };

  const cookieHeader = c.req.header('Cookie') || '';
  const cookieAccountId = extractCookieValue(cookieHeader, ACCOUNT_COOKIE_NAME);
  if (cookieAccountId) return { accountId: cookieAccountId, source: 'cookie' };

  return { accountId: null, source: 'none' };
}

function accountCookieOptions(c: any) {
  const url = new URL(c.req.url);
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: url.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 30,
  };
}

async function setResolvedContext(
  c: any,
  user: {
    id: string;
    email: string;
    name: string | null;
    isAdmin: boolean;
    stripeCustomerId: string | null;
    defaultAccountId: string | null;
  },
  options?: {
    forcedAccountId?: string;
    apiKeyScope?: string;
    apiKeyMachineIds?: string[] | null;
    apiKeyPermissions?: string[];
  },
) {
  const resolvedUser = await ensureAutoAdminUser(user);
  await ensureUserAccountGraph(resolvedUser);

  const requested = extractRequestedAccountId(c);
  const requestedAccountId = requested.accountId;

  if (options?.forcedAccountId && requestedAccountId && requestedAccountId !== options.forcedAccountId) {
    return c.json({ error: true, message: 'API key account mismatch', status: 403 }, 403);
  }

  const targetAccountId = options?.forcedAccountId ?? requestedAccountId;
  const accountContext = await resolveAccountForUser(resolvedUser, targetAccountId);

  if (options?.forcedAccountId && accountContext.active.account.id !== options.forcedAccountId) {
    return c.json({ error: true, message: 'API key account access denied', status: 403 }, 403);
  }

  if (!options?.forcedAccountId && requestedAccountId && accountContext.active.account.id !== requestedAccountId) {
    if (requested.source === 'header') {
      return c.json({ error: true, message: 'Account access denied', status: 403 }, 403);
    }

    // Stale account cookie from a previous login/account switch.
    // Heal it automatically so a valid session can continue with its resolved account.
    setCookie(c, ACCOUNT_COOKIE_NAME, accountContext.active.account.id, accountCookieOptions(c));
  }

  c.set('userId', resolvedUser.id);
  c.set('accountId', accountContext.active.account.id);
  c.set('accountRole', accountContext.active.membership.role);
  c.set('isAccountOwner', isAccountOwner(accountContext.active.membership.role));
  c.set('isAccountAdmin', isAccountAdmin(accountContext.active.membership.role));
  c.set('isAdmin', resolvedUser.isAdmin);

  if (options?.apiKeyScope) c.set('apiKeyScope', options.apiKeyScope);
  if (options?.apiKeyMachineIds !== undefined) c.set('apiKeyMachineIds', options.apiKeyMachineIds);
  if (options?.apiKeyPermissions) c.set('apiKeyPermissions', options.apiKeyPermissions);

  return null;
}

/**
 * Middleware that checks whether the current API key has a required permission.
 * Session-based auth (cookie) always passes (full access).
 * API keys with `['*']` always pass.
 */
export function requirePermission(...required: Permission[]) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const perms = c.get('apiKeyPermissions');
    if (!perms) return next();
    if (perms.includes('*')) return next();
    for (const p of required) {
      if (!perms.includes(p)) {
        return c.json({ error: true, message: `Insufficient permissions: requires '${p}'`, status: 403 }, 403);
      }
    }
    return next();
  });
}

/**
 * Middleware that checks machine-scoped API keys.
 * Expects `machineId` or `id` param in the route.
 * Session-based auth and account-scoped keys always pass.
 */
export function requireMachineAccess() {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const scope = c.get('apiKeyScope');
    if (!scope || scope === 'account') return next();
    const machineIds = c.get('apiKeyMachineIds');
    if (!machineIds) return next();
    const targetMachineId = c.req.param('machineId') || c.req.param('id');
    if (!targetMachineId) return next();
    if (!machineIds.includes(targetMachineId)) {
      return c.json({ error: true, message: 'API key does not have access to this machine', status: 403 }, 403);
    }
    return next();
  });
}

export const apiGuard = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer sk_live_')) {
    const key = authHeader.slice(7);
    try {
      const hash = sha256(key);

      const [match] = await db.select().from(apiKeys).where(eq(apiKeys.keySha256, hash)).limit(1);
      if (match) {
        if (match.expiresAt && match.expiresAt < new Date()) {
          return c.json({ error: true, message: 'API key has expired', status: 401 }, 401);
        }

        db.update(apiKeys)
          .set({ lastUsed: new Date() })
          .where(eq(apiKeys.id, match.id))
          .catch(() => {});

        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            isAdmin: users.isAdmin,
            stripeCustomerId: users.stripeCustomerId,
            defaultAccountId: users.defaultAccountId,
          })
          .from(users)
          .where(eq(users.id, match.ownerId));

        if (!user) {
          return c.json({ error: true, message: 'API key owner not found', status: 401 }, 401);
        }

        const denied = await setResolvedContext(c, user, {
          forcedAccountId: match.accountId ?? undefined,
          apiKeyScope: match.scope,
          apiKeyMachineIds: match.machineIds,
          apiKeyPermissions: match.permissions,
        });
        if (denied) return denied;
        return next();
      }

      const fallbackPrefix = buildApiKeyPrefix(key);
      const fallbackCandidates = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, fallbackPrefix)).limit(8);
      for (const candidate of fallbackCandidates) {
        if (!(await validateApiKey(key, candidate.keyHash))) continue;

        if (candidate.expiresAt && candidate.expiresAt < new Date()) {
          return c.json({ error: true, message: 'API key has expired', status: 401 }, 401);
        }

        db.update(apiKeys)
          .set({ keySha256: hash, lastUsed: new Date() })
          .where(eq(apiKeys.id, candidate.id))
          .catch(() => {});

        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            isAdmin: users.isAdmin,
            stripeCustomerId: users.stripeCustomerId,
            defaultAccountId: users.defaultAccountId,
          })
          .from(users)
          .where(eq(users.id, candidate.ownerId));

        if (!user) {
          return c.json({ error: true, message: 'API key owner not found', status: 401 }, 401);
        }

        const denied = await setResolvedContext(c, user, {
          forcedAccountId: candidate.accountId ?? undefined,
          apiKeyScope: candidate.scope,
          apiKeyMachineIds: candidate.machineIds,
          apiKeyPermissions: candidate.permissions,
        });
        if (denied) return denied;
        return next();
      }
    } catch (err) {
      console.error('[API_GUARD] API key validation error:', err);
    }

    return c.json({ error: true, message: 'Invalid API key', status: 401 }, 401);
  }

  if (authHeader?.startsWith('Bearer ')) {
    return c.json({ error: true, message: 'Invalid API key format', status: 401 }, 401);
  }

  const authSecret = process.env.AUTH_SECRET;
  if (authSecret) {
    try {
      const cookieHeader = c.req.header('Cookie') || '';
      const session = extractSessionCookie(cookieHeader);

      if (session) {
        const token = await decode({
          token: session.value,
          secret: authSecret,
          salt: session.salt,
        });

        if (token?.sub) {
          const [user] = await db
            .select({
              id: users.id,
              email: users.email,
              name: users.name,
              isAdmin: users.isAdmin,
              stripeCustomerId: users.stripeCustomerId,
              defaultAccountId: users.defaultAccountId,
            })
            .from(users)
            .where(eq(users.id, token.sub));

          if (user) {
            const denied = await setResolvedContext(c, user);
            if (denied) return denied;
            return next();
          }
        }
      }
    } catch (err) {
      console.error('[API_GUARD] Session decode error:', err);
    }
  }

  if (!authSecret && process.env.NODE_ENV !== 'production') {
    console.warn('[API_GUARD] No AUTH_SECRET — using dev fallback (non-production only)');
    try {
      const [firstUser] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          isAdmin: users.isAdmin,
          stripeCustomerId: users.stripeCustomerId,
          defaultAccountId: users.defaultAccountId,
        })
        .from(users)
        .limit(1);

      if (firstUser) {
        const denied = await setResolvedContext(c, firstUser);
        if (denied) return denied;
        return next();
      }
    } catch (err) {
      console.error('[API_GUARD] Dev fallback DB error:', err);
    }

    c.set('userId', 'dev-user-00000000-0000-0000-0000-000000000000');
    c.set('accountId', 'dev-account-00000000-0000-0000-0000-000000000000');
    c.set('accountRole', 'owner');
    c.set('isAccountOwner', true);
    c.set('isAccountAdmin', true);
    c.set('isAdmin', false);
    return next();
  }

  return c.json({ error: true, message: 'Authentication required', status: 401 }, 401);
});
