import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { hashPassword } from '@/server/core/crypto';
import { consumeAuthToken, invalidateActiveTokens } from '@/server/auth/auth-tokens';
import { ResetPasswordSchema } from '../_schemas';
import { badRequest, firstZodError, serverError, success } from '../_responses';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ResetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(firstZodError(parsed.error));
    }

    const result = await consumeAuthToken(parsed.data.token, 'password_reset');
    if (result.status !== 'consumed') {
      return badRequest('This reset link is invalid or has expired');
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await db
      .update(users)
      .set({
        passwordHash,
        emailVerified: new Date(),
      })
      .where(eq(users.id, result.userId));

    await invalidateActiveTokens(result.userId, 'password_reset');

    return success({ reset: true });
  } catch (err) {
    console.error('[RESET_PASSWORD] error:', err);
    return serverError();
  }
}
