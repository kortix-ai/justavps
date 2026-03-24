import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from './crypto';
import { ensureAutoAdminUser, isAutoAdminEmail } from './auto-admin';
import { authConfig } from '@/lib/auth-config';
import { ensureUserAccountGraph } from './accounts';

export { authConfig };

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    // GitHub OAuth — only enabled when credentials are configured
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [GitHubProvider({
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        })]
      : []),

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

          const resolvedUser = await ensureAutoAdminUser(user);

          // Non-fatal: account graph is also ensured lazily via api-guard on first API call.
          try {
            await ensureUserAccountGraph(resolvedUser);
          } catch (graphErr) {
            console.warn('[AUTH] ensureUserAccountGraph failed (non-fatal):', graphErr);
          }

          return { id: resolvedUser.id, email: resolvedUser.email, name: resolvedUser.name };
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

      const isKortixEmail = isAutoAdminEmail(email);

      try {
        const [existingByGithub] = await db.select().from(users)
          .where(eq(users.githubId, githubId));

        if (existingByGithub) {
          const updates: Record<string, unknown> = {};
          if (name && name !== existingByGithub.name) updates.name = name;
          if (isKortixEmail && !existingByGithub.isAdmin) updates.isAdmin = true;
          if (Object.keys(updates).length) {
            await db.update(users).set(updates).where(eq(users.id, existingByGithub.id));
          }
          await ensureUserAccountGraph({
            id: existingByGithub.id,
            email: existingByGithub.email,
            name: name ?? existingByGithub.name,
            stripeCustomerId: existingByGithub.stripeCustomerId,
            defaultAccountId: existingByGithub.defaultAccountId,
          });
          user.id = existingByGithub.id;
          return true;
        }

        const [existingByEmail] = await db.select().from(users)
          .where(eq(users.email, email));

        if (existingByEmail) {
          const updates: Record<string, unknown> = { githubId };
          if (name && !existingByEmail.name) updates.name = name;
          if (isKortixEmail && !existingByEmail.isAdmin) updates.isAdmin = true;
          await db.update(users).set(updates).where(eq(users.id, existingByEmail.id));
          await ensureUserAccountGraph({
            id: existingByEmail.id,
            email: existingByEmail.email,
            name: existingByEmail.name ?? name,
            stripeCustomerId: existingByEmail.stripeCustomerId,
            defaultAccountId: existingByEmail.defaultAccountId,
          });
          user.id = existingByEmail.id;
          return true;
        }

        const [newUser] = await db.insert(users).values({
          email,
          name,
          githubId,
          isAdmin: isKortixEmail,
        }).returning({
          id: users.id,
          email: users.email,
          name: users.name,
          stripeCustomerId: users.stripeCustomerId,
          defaultAccountId: users.defaultAccountId,
        });

        await ensureUserAccountGraph(newUser);

        user.id = newUser.id;
        return true;
      } catch (err) {
        console.error('[AUTH] GitHub signIn error:', err);
        return false;
      }
    },

    async jwt({ token, user }) {
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
