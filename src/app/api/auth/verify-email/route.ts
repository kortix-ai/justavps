/**
 * POST /api/auth/verify-email — Verify a 6-digit email verification code.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCode } from '@/server/lib/email-verification';
import { z } from 'zod';

const VerifySchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  code: z.string().length(6, 'Code must be 6 digits').regex(/^\d{6}$/, 'Code must be numeric'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = VerifySchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: true, message: firstError?.message || 'Invalid input' },
        { status: 400 },
      );
    }

    const { userId, code } = parsed.data;
    const result = await verifyCode(userId, code);

    if (!result.success) {
      return NextResponse.json(
        { error: true, message: result.error || 'Verification failed' },
        { status: 400 },
      );
    }

    return NextResponse.json({ verified: true }, { status: 200 });
  } catch (err) {
    console.error('[VERIFY-EMAIL] error:', err);
    return NextResponse.json(
      { error: true, message: 'Internal server error' },
      { status: 500 },
    );
  }
}
