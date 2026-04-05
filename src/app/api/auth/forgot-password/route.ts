import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { issueAuthToken } from '@/server/lib/auth-tokens';
import { emailClient } from '@/server/lib/email';
import { ForgotPasswordSchema } from '../_schemas';
import { badRequest, firstZodError, serverError, success } from '../_responses';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ForgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(firstZodError(parsed.error));
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, parsed.data.email));

    if (user && user.passwordHash) {
      const { plaintext } = await issueAuthToken(user.id, 'password_reset');
      await emailClient.sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        token: plaintext,
      });
    }

    return success({ sent: true });
  } catch (err) {
    console.error('[FORGOT_PASSWORD] error:', err);
    return serverError();
  }
}
