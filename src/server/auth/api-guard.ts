/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'crypto';
import { decode } from 'next-auth/jwt';
import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { apiKeys, users } from '@/server/db/schema';
import { ensureAutoAdminUser } from '@/server/auth/auto-admin';
import {
  ACCOUNT_COOKIE_NAME,
  isAccountAdmin,
  isAccountOwner,
  resolveAccountForUser,
} from '@/server/auth/accounts';
import { validateApiKey } from '@/server/core/crypto';

function buildApiKeyPrefix(key: string): string {
  return `${key.slice(0, 16)}...`;
}

/* ─── In-memory auth cache ─────────────────────────────────────────────────
 *
 * The auth pipeline (ensureAutoAdminUser → ensureUserAccountGraph →
 * backfillLegacyUserResources → resolveAccountForUser → getUserMemberships)
 * fires ~15-20 DB round-trips per request, every request. At typical
 * cross-region Neon latency (~200ms each) that's 3-4s of auth overhead
 * before the handler even runs.
 *
 * This cache memoises the resolved AuthVariables by (session-token + account-
 * selection) or (api-key-hash + account-selection) for a short TTL. On a
 * cache hit we apply the stored context and skip every DB call below.
 *
 * TTL intentionally short so permission / role changes propagate within a
 * minute. Cache is process-local — cleared on every dev rebuild and every
 * serverless cold-start, so staleness windows are further bounded in
 * practice.
 * ────────────────────────────────────────────────────────────────────────── */

type CachedAuth = {
  expires: number;
  context: Omit<AuthVariables, 'apiKeyScope' | 'apiKeyPermissions' | 'apiKeyMachineIds'> &
    Pick<AuthVariables, 'apiKeyScope' | 'apiKeyPermissions' | 'apiKeyMachineIds'>;
};

const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX_ENTRIES = 2_000;
const AUTH_CACHE = new Map<string, CachedAuth>();

function authCacheGet(key: string): CachedAuth['context'] | null {
  const entry = AUTH_CACHE.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    AUTH_CACHE.delete(key);
    return null;
  }
  // Move to end for LRU ordering
  AUTH_CACHE.delete(key);
  AUTH_CACHE.set(key, entry);
  return entry.context;
}

function authCacheSet(key: string, context: CachedAuth['context']): void {
  AUTH_CACHE.set(key, { expires: Date.now() + AUTH_CACHE_TTL_MS, context });
  while (AUTH_CACHE.size > AUTH_CACHE_MAX_ENTRIES) {
    const oldest = AUTH_CACHE.keys().next().value;
    if (!oldest) break;
    AUTH_CACHE.delete(oldest);
  }
}

function applyCachedContext(c: any, context: CachedAuth['context']): void {
  c.set('userId', context.userId);
  c.set('accountId', context.accountId);
  c.set('accountRole', context.accountRole);
  c.set('isAccountOwner', context.isAccountOwner);
  c.set('isAccountAdmin', context.isAccountAdmin);
  c.set('isAdmin', context.isAdmin);
  if (context.apiKeyId) c.set('apiKeyId', context.apiKeyId);
  if (context.apiKeyName) c.set('apiKeyName', context.apiKeyName);
  if (context.apiKeyPrefix) c.set('apiKeyPrefix', context.apiKeyPrefix);
  if (context.apiKeyScope) c.set('apiKeyScope', context.apiKeyScope);
  if (context.apiKeyMachineIds !== undefined) c.set('apiKeyMachineIds', context.apiKeyMachineIds);
  if (context.apiKeyPermissions) c.set('apiKeyPermissions', context.apiKeyPermissions);
}

function buildAuthCacheKey(credential: string, accountSelection: string | null): string {
  return `${credential}::${accountSelection ?? ''}`;
}

type Permission = 'read' | 'write' | 'delete' | 'exec' | 'proxy' | '*';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export type AuthVariables = {
  userId: string;
  accountId: string;
  accountRole: 'owner' | 'admin' | 'member' | null;
  isAccountOwner: boolean;
  isAccountAdmin: boolean;
  isAdmin: boolean;
  apiKeyId?: string;
  apiKeyName?: string;
  apiKeyPrefix?: string;
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

function extractRequestedAccountId(c: any): { id: string | null; source: 'header' | 'cookie' | null } {
  const headerAccountId = c.req.header('X-Account-Id');
  if (headerAccountId) return { id: headerAccountId, source: 'header' };

  const cookieHeader = c.req.header('Cookie') || '';
  const cookieValue = extractCookieValue(cookieHeader, ACCOUNT_COOKIE_NAME);
  return { id: cookieValue, source: cookieValue ? 'cookie' : null };
}

function clearStaleAccountCookie(c: any) {
  // Clear the __justavps_account cookie so the browser stops sending a stale id.
  // Next request will fall back to the user's default account naturally.
  c.header('Set-Cookie', `${ACCOUNT_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`, { append: true });
}

async function setResolvedContext(
  c: any,
  user: {
    id: string;
    email: string;
    emailVerified: Date | null;
    name: string | null;
    isAdmin: boolean;
    stripeCustomerId: string | null;
    defaultAccountId: string | null;
  },
  options?: {
    forcedAccountId?: string;
    apiKeyId?: string;
    apiKeyName?: string;
    apiKeyPrefix?: string;
    apiKeyScope?: string;
    apiKeyMachineIds?: string[] | null;
    apiKeyPermissions?: string[];
    cacheKey?: string;
  },
) {
  const resolvedUser = await ensureAutoAdminUser(user);
  // NOTE: do NOT call ensureUserAccountGraph here — resolveAccountForUser
  // calls it internally. Calling it twice was doubling the backfill work.

  const requested = extractRequestedAccountId(c);

  if (options?.forcedAccountId && requested.id && requested.id !== options.forcedAccountId) {
    return c.json({ error: true, message: 'API key account mismatch', status: 403 }, 403);
  }

  const targetAccountId = options?.forcedAccountId ?? requested.id;
  const accountContext = await resolveAccountForUser(resolvedUser, targetAccountId);

  if (options?.forcedAccountId && accountContext.active.account.id !== options.forcedAccountId) {
    return c.json({ error: true, message: 'API key account access denied', status: 403 }, 403);
  }

  if (!options?.forcedAccountId && requested.id && accountContext.active.account.id !== requested.id) {
    // Stale __justavps_account cookie (from a prior login/session) — auto-heal
    // by clearing the cookie and proceeding with the user's resolved default
    // account. Explicit X-Account-Id headers are still rejected.
    if (requested.source === 'cookie') {
      clearStaleAccountCookie(c);
    } else {
      return c.json({ error: true, message: 'Account access denied', status: 403 }, 403);
    }
  }

  const context: CachedAuth['context'] = {
    userId: resolvedUser.id,
    accountId: accountContext.active.account.id,
    accountRole: accountContext.active.membership.role,
    isAccountOwner: isAccountOwner(accountContext.active.membership.role),
    isAccountAdmin: isAccountAdmin(accountContext.active.membership.role),
    isAdmin: resolvedUser.isAdmin,
    apiKeyId: options?.apiKeyId,
    apiKeyName: options?.apiKeyName,
    apiKeyPrefix: options?.apiKeyPrefix,
    apiKeyScope: options?.apiKeyScope,
    apiKeyMachineIds: options?.apiKeyMachineIds,
    apiKeyPermissions: options?.apiKeyPermissions,
  };

  applyCachedContext(c, context);

  if (options?.cacheKey) {
    authCacheSet(options.cacheKey, context);
  }

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
  const accountSelection = extractRequestedAccountId(c).id;

  if (authHeader?.startsWith('Bearer sk_live_')) {
    const key = authHeader.slice(7);
    try {
      const hash = sha256(key);

      // Fast path: cached auth context for this (api-key, account) pair
      const cacheKey = buildAuthCacheKey(`ak:${hash}`, accountSelection);
      const cached = authCacheGet(cacheKey);
      if (cached) {
        applyCachedContext(c, cached);
        return next();
      }

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
            emailVerified: users.emailVerified,
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
          apiKeyId: match.id,
          apiKeyName: match.name,
          apiKeyPrefix: match.keyPrefix,
          apiKeyScope: match.scope,
          apiKeyMachineIds: match.machineIds,
          apiKeyPermissions: match.permissions,
          cacheKey,
        });
        if (denied) return denied;
        return next();
      }

      // Prefix-filtered lookup — avoids scanning every bcrypt hash.
      const fallbackPrefix = buildApiKeyPrefix(key);
      const allKeys = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, fallbackPrefix)).limit(8);
      for (const candidate of allKeys) {
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
            emailVerified: users.emailVerified,
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
          apiKeyId: candidate.id,
          apiKeyName: candidate.name,
          apiKeyPrefix: candidate.keyPrefix,
          apiKeyScope: candidate.scope,
          apiKeyMachineIds: candidate.machineIds,
          apiKeyPermissions: candidate.permissions,
          cacheKey,
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
        // Fast path: cached auth context for this (session, account) pair.
        // We hash the opaque session token before using it as a key to
        // avoid holding the raw token in memory longer than needed.
        const sessionHash = sha256(session.value);
        const cacheKey = buildAuthCacheKey(`sess:${sessionHash}`, accountSelection);
        const cached = authCacheGet(cacheKey);
        if (cached) {
          applyCachedContext(c, cached);
          return next();
        }

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
              emailVerified: users.emailVerified,
              name: users.name,
              isAdmin: users.isAdmin,
              stripeCustomerId: users.stripeCustomerId,
              defaultAccountId: users.defaultAccountId,
            })
            .from(users)
            .where(eq(users.id, token.sub));

          if (user) {
            const denied = await setResolvedContext(c, user, { cacheKey });
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
          emailVerified: users.emailVerified,
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
