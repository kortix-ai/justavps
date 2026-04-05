import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { issueAuthToken } from '@/server/lib/auth-tokens';
import { emailClient } from '@/server/lib/email';
import { issueVerificationBinding } from '@/server/lib/verification-binding';
import { ResendVerificationSchema } from '../_schemas';
import { badRequest, firstZodError, serverError } from '../_responses';

export async function POST(req: NextRequest) {
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
