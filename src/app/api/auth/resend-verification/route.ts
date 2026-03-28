/**
 * POST /api/auth/resend-verification — Resend a verification code to the user's email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateVerificationCode } from '@/server/lib/email-verification';
import { emailClient } from '@/server/lib/email';
import { z } from 'zod';

const ResendSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ResendSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: true, message: firstError?.message || 'Invalid input' },
        { status: 400 },
      );
    }

    const { userId } = parsed.data;

    // Look up the user
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return NextResponse.json(
        { error: true, message: 'User not found' },
        { status: 404 },
      );
    }

    if (user.emailVerified) {
      return NextResponse.json(
        { error: true, message: 'Email is already verified' },
        { status: 400 },
      );
    }

    // Generate new code
    const { code } = await generateVerificationCode(userId, user.email);

    // Send via email
    const sent = await emailClient.sendVerificationEmail({
      email: user.email,
      name: user.name,
      code,
      expiresInMinutes: 15,
    });

    if (!sent) {
      console.warn('[RESEND] Email not sent (Mailtrap not configured?) — code:', code);
    }

    return NextResponse.json({ sent: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    // Rate limit message from generateVerificationCode
    if (message.includes('Too many pending')) {
      return NextResponse.json({ error: true, message }, { status: 429 });
    }
    console.error('[RESEND-VERIFICATION] error:', err);
    return NextResponse.json(
      { error: true, message: 'Internal server error' },
      { status: 500 },
    );
  }
}
