import type { NextAuthConfig } from 'next-auth';
import {
  isProtectedRoute,
  isAuthOnlyRoute,
  DEFAULT_AUTHENTICATED_REDIRECT,
} from '@/lib/auth-routes';

export const authConfig = {
  trustHost: true,

  pages: {
    signIn: '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 15 * 60,
  },

  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      if (isProtectedRoute(pathname) && !isLoggedIn) {
        return false;
      }

      if (isAuthOnlyRoute(pathname) && isLoggedIn) {
        // Respect callbackUrl if present (e.g. proxy-auth redirect flow).
        // Only allow relative paths to prevent open redirect attacks.
        const callbackUrl = request.nextUrl.searchParams.get('callbackUrl');
        const redirectTo = callbackUrl?.startsWith('/') ? callbackUrl : DEFAULT_AUTHENTICATED_REDIRECT;
        return Response.redirect(
          new URL(redirectTo, request.nextUrl),
        );
      }

      return true;
    },

    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      if (token.email) {
        session.user.email = token.email as string;
      }
      if (token.name) {
        session.user.name = token.name as string;
      }
      return session;
    },

    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
  },
} satisfies Partial<NextAuthConfig>;
