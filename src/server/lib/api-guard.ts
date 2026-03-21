import { createMiddleware } from 'hono/factory';
import { createHash } from 'crypto';
import { db } from '../db';
import { apiKeys, users } from '../db/schema';
import { validateApiKey } from './crypto';
import { eq } from 'drizzle-orm';
import { decode } from 'next-auth/jwt';
import { ensureAutoAdminUser } from './auto-admin';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}


export type AuthVariables = {
  userId: string;
  isAdmin: boolean;
};

function extractSessionCookie(cookieHeader: string): { value: string; salt: string } | null {
  const patterns: { name: string; salt: string }[] = [
    { name: '__Secure-authjs.session-token', salt: '__Secure-authjs.session-token' },
    { name: 'authjs.session-token', salt: 'authjs.session-token' },
    { name: 'next-auth.session-token', salt: 'next-auth.session-token' },
  ];

  for (const { name, salt } of patterns) {
    const regex = new RegExp(`(?:^|;\\s*)${name.replace(/\./g, '\\.')}=([^;]+)`);
    const match = cookieHeader.match(regex);
    if (match) {
      return { value: decodeURIComponent(match[1]), salt };
    }
  }

  return null;
}

export const apiGuard = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (authHeader?.startsWith('Bearer sk_live_')) {
      const key = authHeader.slice(7);
      try {
        const hash = sha256(key);

        // Fast path: O(1) DB lookup by SHA-256 hash
        const [match] = await db.select().from(apiKeys).where(eq(apiKeys.keySha256, hash)).limit(1);
        if (match) {
          db.update(apiKeys)
            .set({ lastUsed: new Date() })
            .where(eq(apiKeys.id, match.id))
            .catch(() => {});

          const [user] = await db
            .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
            .from(users)
            .where(eq(users.id, match.ownerId));

          const resolvedUser = user ? await ensureAutoAdminUser(user) : null;
          const ownerId = resolvedUser?.id ?? match.ownerId;
          const isAdmin = resolvedUser?.isAdmin ?? false;

          c.set('userId', ownerId);
          c.set('isAdmin', isAdmin);
          return next();
        }

        // Slow fallback: bcrypt scan for old keys without keySha256, then backfill
        const allKeys = await db.select().from(apiKeys);
        for (const k of allKeys) {
          if (await validateApiKey(key, k.keyHash)) {
            db.update(apiKeys)
              .set({ keySha256: hash, lastUsed: new Date() })
              .where(eq(apiKeys.id, k.id))
              .catch(() => {});

            const [user] = await db
              .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
              .from(users)
              .where(eq(users.id, k.ownerId));

            const resolvedUser = user ? await ensureAutoAdminUser(user) : null;
            const ownerId = resolvedUser?.id ?? k.ownerId;
            const isAdmin = resolvedUser?.isAdmin ?? false;
            authCache.set(hash, { ownerId, keyId: k.id, isAdmin, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
            c.set('userId', ownerId);
            c.set('isAdmin', isAdmin);
            return next();
          }
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
              .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
              .from(users)
              .where(eq(users.id, token.sub));

            if (user) {
              const resolvedUser = await ensureAutoAdminUser(user);
              c.set('userId', resolvedUser.id);
              c.set('isAdmin', resolvedUser.isAdmin);
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
          .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
          .from(users)
          .limit(1);
        if (firstUser) {
          const resolvedUser = await ensureAutoAdminUser(firstUser);
          c.set('userId', resolvedUser.id);
          c.set('isAdmin', resolvedUser.isAdmin);
          return next();
        }
      } catch (err) {
        console.error('[API_GUARD] Dev fallback DB error:', err);
      }
      c.set('userId', 'dev-user-00000000-0000-0000-0000-000000000000');
      c.set('isAdmin', false);
      return next();
    }

    return c.json({ error: true, message: 'Authentication required', status: 401 }, 401);
  },
);
