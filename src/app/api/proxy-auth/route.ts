/**
 * GET /api/proxy-auth — Issue a proxy auth cookie for accessing machines via CF Worker.
 *
 * Flow:
 *   1. CF Worker redirects unauthenticated browser requests here
 *   2. This route validates the user's NextAuth session
 *   3. Signs a JWT (user-scoped, 24h expiry)
 *   4. Sets `__justavps_proxy` cookie on `.kortix.cloud`
 *   5. Redirects back to the original machine URL
 *
 * Query params:
 *   - redirect: URL to redirect back to (required, must be *.kortix.cloud)
 *
 * Also supports POST for programmatic token issuance (returns JWT in body).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/server/lib/auth';
import { signProxyToken, buildProxyCookieHeader } from '@/server/lib/proxy-token';
import { config } from '@/server/lib/config';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { ACCOUNT_COOKIE_NAME, resolveAccountForUser } from '@/server/lib/accounts';

const escapedProxyDomain = config.PROXY_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALLOWED_REDIRECT_PATTERN = new RegExp(`^https:\\/\\/(?:[0-9]+--)?[a-z0-9-]+\\.${escapedProxyDomain}(?:\\/.*)?$`);

export async function GET(request: NextRequest) {
  try {
    // 1. Validate session
    const session = await auth();
    if (!session?.user?.id) {
      // Not logged in — redirect to login page with the proxy redirect chained
      const redirect = request.nextUrl.searchParams.get('redirect') || '';
      const loginUrl = new URL('/login', request.nextUrl.origin);
      loginUrl.searchParams.set('callbackUrl', `/api/proxy-auth?redirect=${encodeURIComponent(redirect)}`);
      return NextResponse.redirect(loginUrl);
    }

    // 2. Validate redirect URL (must be *.kortix.cloud)
    const redirect = request.nextUrl.searchParams.get('redirect');
    if (!redirect || !ALLOWED_REDIRECT_PATTERN.test(redirect)) {
      return NextResponse.json(
        { error: `Invalid or missing redirect URL. Must be https://<slug>.${config.PROXY_DOMAIN}/... or https://<port>--<slug>.${config.PROXY_DOMAIN}/...` },
        { status: 400 },
      );
    }

    const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const requestedAccountId = request.cookies.get(ACCOUNT_COOKIE_NAME)?.value || null;
    const accountContext = await resolveAccountForUser(user, requestedAccountId);

    // 3. Sign proxy JWT (account-scoped)
    const token = await signProxyToken(accountContext.active.account.id, session.user.id);

    // 4. Redirect back to the machine URL with token in query param.
    // The CF Worker will read the token, verify it, set the cookie on .kortix.cloud
    // (justavps.com CANNOT set cookies on .kortix.cloud — different origin).
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set('__proxy_token', token);
    return NextResponse.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('[proxy-auth] Error:', error);
    return NextResponse.json(
      { error: 'Failed to issue proxy auth token', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/proxy-auth — Programmatic token issuance.
 * Requires Authorization header (API key or session).
 * Returns the JWT in the response body (for WebSocket connections, iframes, etc.)
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const requestedAccountId = request.cookies.get(ACCOUNT_COOKIE_NAME)?.value || null;
  const accountContext = await resolveAccountForUser(user, requestedAccountId);
  const token = await signProxyToken(accountContext.active.account.id, session.user.id);

  return NextResponse.json({
    token,
    expires_in: 86400,
    cookie_header: buildProxyCookieHeader(token),
  });
}
