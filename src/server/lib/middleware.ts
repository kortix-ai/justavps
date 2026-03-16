/**
 * Hono middleware for authentication.
 * Supports API key (Bearer sk_live_xxx) and NextAuth session cookie.
 */

import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { apiKeys, users } from '../db/schema';
import { validateApiKey } from './crypto';
import { eq } from 'drizzle-orm';
import { decode } from 'next-auth/jwt';

export type AuthVariables = {
  userId: string;
};

/**
 * Auth middleware — resolves userId from:
 * 1. Authorization: Bearer sk_live_xxx  (API key)
 * 2. NextAuth session JWT cookie (authjs.session-token)
 * 3. Dev mode fallback (uses first user in DB when AUTH_SECRET not set)
 */
export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  // ── 1. API Key ─────────────────────────────────────────────────────────────
  if (authHeader?.startsWith('Bearer sk_live_')) {
    const key = authHeader.slice(7);
    try {
      const allKeys = await db.select().from(apiKeys);
      for (const k of allKeys) {
        if (await validateApiKey(key, k.keyHash)) {
          // Update last_used async
          db.update(apiKeys).set({ lastUsed: new Date() }).where(eq(apiKeys.id, k.id)).catch(() => {});
          c.set('userId', k.ownerId);
          return next();
        }
      }
    } catch (err) {
      console.error('[AUTH] DB error during API key validation:', err);
    }
    return c.json({ error: true, message: 'Invalid API key', status: 401 }, 401);
  }

  // ── 2. Reject other Bearer tokens ─────────────────────────────────────────
  if (authHeader?.startsWith('Bearer ')) {
    return c.json({ error: true, message: 'Invalid API key format', status: 401 }, 401);
  }

  // ── 3. NextAuth session cookie ────────────────────────────────────────────
  const authSecret = process.env.AUTH_SECRET;
  if (authSecret) {
    try {
      // NextAuth v5 uses 'authjs.session-token' cookie
      const cookieHeader = c.req.header('Cookie') || '';
      const cookieMatch = cookieHeader.match(/(?:authjs\.session-token|next-auth\.session-token)=([^;]+)/);
      if (cookieMatch) {
        const token = await decode({
          token: decodeURIComponent(cookieMatch[1]),
          secret: authSecret,
          salt: 'authjs.session-token',
        });
        if (token?.sub) {
          // Verify user exists in DB
          try {
            const [user] = await db.select().from(users).where(eq(users.id, token.sub));
            if (user) {
              c.set('userId', user.id);
              return next();
            }
          } catch {
            // DB error — still trust the token
            c.set('userId', token.sub);
            return next();
          }
        }
      }
    } catch (err) {
      // JWT decode failed — invalid/expired session
    }
  }

  // ── 4. Dev fallback (no AUTH_SECRET) ──────────────────────────────────────
  if (!authSecret) {
    try {
      const [firstUser] = await db.select().from(users).limit(1);
      if (firstUser) {
        c.set('userId', firstUser.id);
        return next();
      }
    } catch {}
    c.set('userId', 'dev-user-00000000-0000-0000-0000-000000000000');
    return next();
  }

  return c.json({ error: true, message: 'Authentication required', status: 401 }, 401);
});
