import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
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

    // Google OAuth — only enabled when credentials are configured
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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

          // Block unverified email accounts
          if (!user.emailVerified) {
            // Throw with a special message so the frontend can detect it
            throw new Error('EMAIL_NOT_VERIFIED');
          }

          const resolvedUser = await ensureAutoAdminUser(user);

          // Non-fatal: account graph is also ensured lazily via api-guard on first API call.
          try {
            await ensureUserAccountGraph(resolvedUser);
          } catch (graphErr) {
            console.warn('[AUTH] ensureUserAccountGraph failed (non-fatal):', graphErr);
          }

          return { id: resolvedUser.id, email: resolvedUser.email, name: resolvedUser.name };
        } catch (err) {
          // Re-throw EMAIL_NOT_VERIFIED so NextAuth surfaces it
          if (err instanceof Error && err.message === 'EMAIL_NOT_VERIFIED') {
            throw err;
          }
          console.error('[AUTH] authorize error:', err);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, account, profile }) {
      // Handle OAuth sign-ins (GitHub + Google)
      if (account?.provider !== 'github' && account?.provider !== 'google') return true;

      const email = (user.email || profile?.email as string | undefined)?.toLowerCase().trim();
      if (!email) return false;

      const isKortixEmail = isAutoAdminEmail(email);

      try {
        if (account.provider === 'github') {
          return await handleGitHubSignIn(user, account, profile, email, isKortixEmail);
        }
        if (account.provider === 'google') {
          return await handleGoogleSignIn(user, account, profile, email, isKortixEmail);
        }
        return true;
      } catch (err) {
        console.error(`[AUTH] ${account.provider} signIn error:`, err);
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

// ─── OAuth provider handlers ────────────────────────────────────────────────

async function handleGitHubSignIn(
  user: { id?: string; email?: string | null; name?: string | null },
  account: { providerAccountId: string },
  profile: { name?: string | null } | undefined,
  email: string,
  isKortixEmail: boolean,
): Promise<boolean> {
  const githubId = String(account.providerAccountId);
  const name = user.name || profile?.name as string | undefined || null;

  const [existingByGithub] = await db.select().from(users)
    .where(eq(users.githubId, githubId));

  if (existingByGithub) {
    const updates: Record<string, unknown> = {};
    if (name && name !== existingByGithub.name) updates.name = name;
    if (isKortixEmail && !existingByGithub.isAdmin) updates.isAdmin = true;
    // Auto-verify email for OAuth users
    if (!existingByGithub.emailVerified) updates.emailVerified = new Date();
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
    if (!existingByEmail.emailVerified) updates.emailVerified = new Date();
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
    emailVerified: new Date(), // OAuth = trusted email
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
}

async function handleGoogleSignIn(
  user: { id?: string; email?: string | null; name?: string | null },
  account: { providerAccountId: string },
  profile: { name?: string | null; sub?: string } | undefined,
  email: string,
  isKortixEmail: boolean,
): Promise<boolean> {
  const googleId = String(account.providerAccountId);
  const name = user.name || profile?.name as string | undefined || null;

  // Check by Google ID first
  const [existingByGoogle] = await db.select().from(users)
    .where(eq(users.googleId, googleId));

  if (existingByGoogle) {
    const updates: Record<string, unknown> = {};
    if (name && name !== existingByGoogle.name) updates.name = name;
    if (isKortixEmail && !existingByGoogle.isAdmin) updates.isAdmin = true;
    if (!existingByGoogle.emailVerified) updates.emailVerified = new Date();
    if (Object.keys(updates).length) {
      await db.update(users).set(updates).where(eq(users.id, existingByGoogle.id));
    }
    await ensureUserAccountGraph({
      id: existingByGoogle.id,
      email: existingByGoogle.email,
      name: name ?? existingByGoogle.name,
      stripeCustomerId: existingByGoogle.stripeCustomerId,
      defaultAccountId: existingByGoogle.defaultAccountId,
    });
    user.id = existingByGoogle.id;
    return true;
  }

  // Check by email (link Google to existing account)
  const [existingByEmail] = await db.select().from(users)
    .where(eq(users.email, email));

  if (existingByEmail) {
    const updates: Record<string, unknown> = { googleId };
    if (name && !existingByEmail.name) updates.name = name;
    if (isKortixEmail && !existingByEmail.isAdmin) updates.isAdmin = true;
    if (!existingByEmail.emailVerified) updates.emailVerified = new Date();
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

  // Create new user
  const [newUser] = await db.insert(users).values({
    email,
    name,
    googleId,
    emailVerified: new Date(), // OAuth = trusted email
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
}
