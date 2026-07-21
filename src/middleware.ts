import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/shared/lib/auth-config';
import { SUNSET_ENABLED } from '@/shared/lib/sunset';

// Auth flows sunset alongside sign-in/checkout — send visitors to the
// transition notice on /login instead of dead forms.
const SUNSET_AUTH_PAGES = [
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/welcome',
  '/invite',
  '/checkout',
];

// Default OFF in every environment — must be explicitly opted in via
// NEXT_PUBLIC_FEATURE_V2_ENABLED=true (or FEATURE_V2_ENABLED=true). Mirrors
// the fail-closed default in src/server/core/config.ts.
const FEATURE_V2_ENABLED =
  (process.env.NEXT_PUBLIC_FEATURE_V2_ENABLED ??
    process.env.FEATURE_V2_ENABLED ??
    'false')
    .trim().toLowerCase() === 'true';

const { auth } = NextAuth({
  ...authConfig,
  providers: [],
});

// Gate v2 pages behind FEATURE_V2_ENABLED — prod runs v1-only by default.
// API routes (/api/v2/*) are gated server-side in src/server/app.ts.
export default auth((req) => {
  if (!FEATURE_V2_ENABLED && req.nextUrl.pathname.startsWith('/v2')) {
    return new NextResponse(null, { status: 404 });
  }
  if (
    SUNSET_ENABLED &&
    SUNSET_AUTH_PAGES.some((p) => req.nextUrl.pathname.startsWith(p))
  ) {
    return NextResponse.redirect(new URL('/login', req.nextUrl));
  }
  // Fall through to NextAuth's default behavior (applies authConfig callbacks).
  return undefined;
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api|v1).*)',
  ],
};
