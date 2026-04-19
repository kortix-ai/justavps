import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { consumeAuthToken } from '@/server/auth/auth-tokens';
import { readVerificationBinding } from '@/server/auth/verification-binding';
import { VerifyEmailSchema } from '../_schemas';
import { badRequest, firstZodError, serverError, success } from '../_responses';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = VerifyEmailSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(firstZodError(parsed.error));
    }

    const binding = readVerificationBinding(req);
    const result = await consumeAuthToken(parsed.data.token, 'email_verification', { binding });

    if (result.status === 'not_found' || result.status === 'expired') {
      return badRequest('This verification link is invalid or has expired');
    }

    if (result.status === 'binding_mismatch') {
      return badRequest('Open this link from the device you used to sign up');
    }

    if (result.status === 'consumed') {
      await db
        .update(users)
        .set({ emailVerified: new Date() })
        .where(eq(users.id, result.userId));
    }

    return success({ verified: true });
  } catch (err) {
    console.error('[VERIFY_EMAIL] error:', err);
    return serverError();
  }
}
