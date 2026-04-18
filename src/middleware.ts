import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/shared/lib/auth-config';

const FEATURE_V2_ENABLED =
  (process.env.NEXT_PUBLIC_FEATURE_V2_ENABLED ??
    process.env.FEATURE_V2_ENABLED ??
    (process.env.NODE_ENV === 'production' ? 'false' : 'true'))
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
  // Fall through to NextAuth's default behavior (applies authConfig callbacks).
  return undefined;
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api|v1).*)',
  ],
};
