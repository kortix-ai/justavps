import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from './crypto';
import { authConfig } from '@/lib/auth-config';

export { authConfig };

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    }),

    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string | undefined)
          ?.toLowerCase()
          .trim();
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email));

          if (!user || !user.passwordHash) {
            return null;
          }

          const valid = await verifyPassword(password, user.passwordHash);
          if (!valid) return null;

          return { id: user.id, email: user.email, name: user.name };
        } catch (err) {
          console.error('[AUTH] authorize error:', err);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, account, profile }) {
      if (account?.provider !== 'github') return true;

      const email = (user.email || profile?.email as string | undefined)?.toLowerCase().trim();
      const githubId = String(account.providerAccountId);
      const name = user.name || profile?.name as string | undefined || null;

      if (!email) return false;

      try {
        const [existingByGithub] = await db.select().from(users)
          .where(eq(users.githubId, githubId));

        if (existingByGithub) {
          if (name && name !== existingByGithub.name) {
            await db.update(users).set({ name }).where(eq(users.id, existingByGithub.id));
          }
          user.id = existingByGithub.id;
          return true;
        }

        const [existingByEmail] = await db.select().from(users)
          .where(eq(users.email, email));

        if (existingByEmail) {
          await db.update(users).set({
            githubId,
            ...(name && !existingByEmail.name ? { name } : {}),
          }).where(eq(users.id, existingByEmail.id));
          user.id = existingByEmail.id;
          return true;
        }

        const [newUser] = await db.insert(users).values({
          email,
          name,
          githubId,
        }).returning({ id: users.id });

        user.id = newUser.id;
        return true;
      } catch (err) {
        console.error('[AUTH] GitHub signIn error:', err);
        return false;
      }
    },

    async jwt({ token, user, account }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
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
  },
});
