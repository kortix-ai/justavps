import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { issueAuthToken } from '@/server/auth/auth-tokens';
import { emailClient } from '@/server/v1/services/email';
import { issueVerificationBinding } from '@/server/auth/verification-binding';
import { ResendVerificationSchema } from '../_schemas';
import { badRequest, firstZodError, serverError } from '../_responses';
import { SUNSET_ENABLED, SUNSET_API_MESSAGE } from '@/shared/lib/sunset';

export async function POST(req: NextRequest) {
  if (SUNSET_ENABLED) {
    return Response.json({ error: true, message: SUNSET_API_MESSAGE }, { status: 410 });
  }
  try {
    const body = await req.json();
    const parsed = ResendVerificationSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(firstZodError(parsed.error));
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, parsed.data.email));

    const response = NextResponse.json({ sent: true }, { status: 200 });

    if (user && !user.emailVerified) {
      const binding = issueVerificationBinding(response);
      const { plaintext } = await issueAuthToken(user.id, 'email_verification', { binding });
      await emailClient.sendVerificationEmail({
        email: user.email,
        name: user.name,
        token: plaintext,
      });
    }

    return response;
  } catch (err) {
    console.error('[RESEND_VERIFICATION] error:', err);
    return serverError();
  }
}
