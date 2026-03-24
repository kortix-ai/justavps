/**
 * Proxy auth tokens — signed JWTs for authenticating requests through the CF Worker.
 *
 * Flow:
 *   1. User visits slug.kortix.cloud
 *   2. Worker: no cookie → redirect to justavps.com/api/proxy-auth
 *   3. Platform: validate session → sign JWT → set cookie on .kortix.cloud → redirect back
 *   4. Worker: verify JWT → check user owns machine → proxy through
 *
 * Token format (JWT, HS256):
 *   { sub: userId, account_id, iat, exp }
 *   Account-scoped — one token grants access to machines in the currently
 *   selected account. The Worker checks account ownership per-request via KV lookup.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from './config';

const TOKEN_EXPIRY = '24h';
const REFRESH_THRESHOLD_SECONDS = 6 * 60 * 60; // Refresh if < 6h remaining
const COOKIE_NAME = '__justavps_proxy';
const COOKIE_DOMAIN = `.${config.PROXY_DOMAIN}`; // .kortix.cloud

function getSecret(): Uint8Array {
  const secret = config.PROXY_AUTH_SECRET;
  if (!secret) throw new Error('PROXY_AUTH_SECRET not configured');
  return new TextEncoder().encode(secret);
}

export interface ProxyTokenPayload extends JWTPayload {
  sub: string; // userId
  account_id: string;
}

/**
 * Sign a proxy auth JWT for a user + active account.
 */
export async function signProxyToken(accountId: string, userId = accountId): Promise<string> {
  return new SignJWT({ sub: userId, account_id: accountId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getSecret());
}

/**
 * Verify a proxy auth JWT. Returns the payload or null if invalid/expired.
 */
export async function verifyProxyToken(token: string): Promise<ProxyTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || !payload.account_id) return null;
    return payload as ProxyTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Check if a token should be refreshed (< 6h remaining).
 */
export function shouldRefreshToken(payload: ProxyTokenPayload): boolean {
  const exp = payload.exp as number | undefined;
  if (!exp) return true;
  const remaining = exp - Math.floor(Date.now() / 1000);
  return remaining < REFRESH_THRESHOLD_SECONDS;
}

/**
 * Build the Set-Cookie header for the proxy auth cookie.
 */
export function buildProxyCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; Domain=${COOKIE_DOMAIN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
}

/**
 * Build a Set-Cookie header that clears the proxy auth cookie.
 */
export function buildProxyClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Domain=${COOKIE_DOMAIN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME, COOKIE_DOMAIN, REFRESH_THRESHOLD_SECONDS };
