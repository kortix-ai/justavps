/**
 * Routes that REQUIRE authentication.
 * Unauthenticated users get redirected to /login.
 * Matched as prefixes (e.g. '/machines' matches '/machines/new').
 */
export const PROTECTED_ROUTES: string[] = [
  '/machines',
  '/snapshots',
  '/keys',
  '/webhooks',
  '/billing',
  '/settings',
  '/docs',
];

/**
 * Routes that are ONLY for unauthenticated users.
 * Authenticated users get redirected to DEFAULT_AUTHENTICATED_REDIRECT.
 * Matched as exact paths.
 */
export const AUTH_ONLY_ROUTES: string[] = [
  '/login',
];

/**
 * Where to send authenticated users when they hit an auth-only route.
 */
export const DEFAULT_AUTHENTICATED_REDIRECT = '/machines';

/**
 * Public API prefixes — skipped by Next.js middleware entirely.
 * These routes handle their own auth (Hono middleware, NextAuth handlers).
 */
export const PUBLIC_API_PREFIXES: string[] = [
  '/api',
];

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isAuthOnlyRoute(pathname: string): boolean {
  return AUTH_ONLY_ROUTES.includes(pathname);
}

export function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
