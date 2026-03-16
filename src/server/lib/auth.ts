/**
 * NextAuth v5 — credentials-based auth with proper password verification.
 */

import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from './crypto';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        try {
          const [user] = await db.select().from(users).where(eq(users.email, email));

          if (!user) {
            // User doesn't exist — don't reveal this (return generic null)
            return null;
          }

          if (!user.passwordHash) {
            // Legacy user without password — deny login
            return null;
          }

          const valid = await verifyPassword(password, user.passwordHash);
          if (!valid) {
            return null;
          }

          return { id: user.id, email: user.email, name: user.name };
        } catch (err) {
          console.error('[AUTH] error:', err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
});
