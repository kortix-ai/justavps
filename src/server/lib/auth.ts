import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from './crypto';
import { authConfig } from '@/lib/auth-config';

export { authConfig };

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
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
});
