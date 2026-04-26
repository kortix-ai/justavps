import NextAuth from 'next-auth';
import { authConfig } from '@/shared/lib/auth-config';

const { auth } = NextAuth({
  ...authConfig,
  providers: [],
});

export default auth((req) => {
  // Fall through to NextAuth's default behavior (applies authConfig callbacks).
  void req;
  return undefined;
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api|v1).*)',
  ],
};
