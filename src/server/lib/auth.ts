import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { verifyPassword } from './crypto';
import { ensureAutoAdminUser } from './auto-admin';
import { ensureUserAccountGraph } from './accounts';
import { consumeAuthToken } from './auth-tokens';
import { VERIFICATION_BINDING_COOKIE } from './verification-binding';
import { authConfig } from '@/lib/auth-config';

export { authConfig };

export const EMAIL_NOT_VERIFIED_ERROR = 'EMAIL_NOT_VERIFIED';

type GithubSignInInput = {
  email: string;
  githubId: string;
  name: string | null;
};

async function applyAccountGraphSafely(user: Parameters<typeof ensureUserAccountGraph>[0]): Promise<void> {
  try {
    await ensureUserAccountGraph(user);
  } catch (err) {
    console.warn('[AUTH] ensureUserAccountGraph failed (non-fatal):', err);
  }
}

async function authorizeCredentials(emailInput: string, passwordInput: string) {
  const email = emailInput.toLowerCase().trim();
  if (!email || !passwordInput) return null;

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !user.passwordHash) return null;

  const validPassword = await verifyPassword(passwordInput, user.passwordHash);
  if (!validPassword) return null;

  if (!user.emailVerified) {
    throw new Error(EMAIL_NOT_VERIFIED_ERROR);
  }

  const resolvedUser = await ensureAutoAdminUser(user);
  await applyAccountGraphSafely(resolvedUser);

  return {
    id: resolvedUser.id,
    email: resolvedUser.email,
    name: resolvedUser.name,
  };
}

async function authorizeVerificationLink(tokenInput: string, bindingInput: string | null) {
  if (!tokenInput) return null;

  const result = await consumeAuthToken(tokenInput, 'email_verification', {
    binding: bindingInput,
  });

  if (result.status !== 'consumed') {
    console.warn(`[AUTH] verification-link rejected: status=${result.status}`);
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, result.userId));
  if (!user) return null;

  if (!user.emailVerified) {
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id));
    user.emailVerified = new Date();
  }

  const resolvedUser = await ensureAutoAdminUser(user);
  await applyAccountGraphSafely(resolvedUser);

  console.log(`[AUTH] verification-link sign-in: user=${resolvedUser.id}`);

  return {
    id: resolvedUser.id,
    email: resolvedUser.email,
    name: resolvedUser.name,
  };
}

async function upsertGithubUser({ email, githubId, name }: GithubSignInInput): Promise<string | null> {
  const [byGithub] = await db.select().from(users).where(eq(users.githubId, githubId));

  if (byGithub) {
    const updates: Record<string, unknown> = {};
    if (name && name !== byGithub.name) updates.name = name;
    if (!byGithub.emailVerified) updates.emailVerified = new Date();
    if (Object.keys(updates).length) {
      await db.update(users).set(updates).where(eq(users.id, byGithub.id));
    }
    await applyAccountGraphSafely({
      id: byGithub.id,
      email: byGithub.email,
      name: name ?? byGithub.name,
      stripeCustomerId: byGithub.stripeCustomerId,
      defaultAccountId: byGithub.defaultAccountId,
    });
    return byGithub.id;
  }

  const [byEmail] = await db.select().from(users).where(eq(users.email, email));

  if (byEmail) {
    const updates: Record<string, unknown> = { githubId };
    if (name && !byEmail.name) updates.name = name;
    if (!byEmail.emailVerified) updates.emailVerified = new Date();
    await db.update(users).set(updates).where(eq(users.id, byEmail.id));
    await applyAccountGraphSafely({
      id: byEmail.id,
      email: byEmail.email,
      name: byEmail.name ?? name,
      stripeCustomerId: byEmail.stripeCustomerId,
      defaultAccountId: byEmail.defaultAccountId,
    });
    return byEmail.id;
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      name,
      githubId,
      emailVerified: new Date(),
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      stripeCustomerId: users.stripeCustomerId,
      defaultAccountId: users.defaultAccountId,
    });

  await applyAccountGraphSafely(created);
  return created.id;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
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
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        try {
          return await authorizeCredentials(email, password);
        } catch (err) {
          if (err instanceof Error && err.message === EMAIL_NOT_VERIFIED_ERROR) {
            throw err;
          }
          console.error('[AUTH] authorize error:', err);
          return null;
        }
      },
    }),

    CredentialsProvider({
      id: 'verification-link',
      name: 'verification-link',
      credentials: {
        token: { label: 'Token', type: 'text' },
      },
      async authorize(credentials) {
        const token = credentials?.token as string | undefined;
        if (!token) return null;

        try {
          const cookieStore = await cookies();
          const binding = cookieStore.get(VERIFICATION_BINDING_COOKIE)?.value ?? null;
          return await authorizeVerificationLink(token, binding);
        } catch (err) {
          console.error('[AUTH] verification-link authorize error:', err);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, account, profile }) {
      if (account?.provider !== 'github') return true;

      const email = (user.email || (profile?.email as string | undefined))?.toLowerCase().trim();
      const githubId = String(account.providerAccountId);
      const name = user.name || (profile?.name as string | undefined) || null;

      if (!email) return false;

      try {
        const resolvedUserId = await upsertGithubUser({ email, githubId, name });
        if (!resolvedUserId) return false;
        user.id = resolvedUserId;
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
      if (token.sub) session.user.id = token.sub;
      if (token.email) session.user.email = token.email as string;
      if (token.name) session.user.name = token.name as string;
      return session;
    },
  },
});
