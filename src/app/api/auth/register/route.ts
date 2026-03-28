/**
 * POST /api/auth/register — Create a new user account.
 *
 * After creation the user's email is NOT verified. A 6-digit verification
 * code is emailed via Mailtrap; the user must submit it at /verify-email
 * before they can sign in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/server/lib/crypto';
import { isAutoAdminEmail } from '@/server/lib/auto-admin';
import { ensureUserAccountGraph } from '@/server/lib/accounts';
import { generateVerificationCode } from '@/server/lib/email-verification';
import { emailClient } from '@/server/lib/email';
import { z } from 'zod';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address').transform((e) => e.toLowerCase().trim()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long'),
  name: z.string().min(1).max(128).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: true, message: firstError?.message || 'Invalid input' },
        { status: 400 },
      );
    }

    const { email, password, name } = parsed.data;

    // Check if user already exists
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      return NextResponse.json(
        { error: true, message: 'An account with this email already exists' },
        { status: 409 },
      );
    }

    // Hash password and create user (emailVerified = null)
    const passwordHash = await hashPassword(password);
    const isAdmin = isAutoAdminEmail(email);
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: name || email.split('@')[0],
        isAdmin,
      })
      .returning();

    await ensureUserAccountGraph(user);

    // Generate verification code and email it
    const { code } = await generateVerificationCode(user.id, email);
    const sent = await emailClient.sendVerificationEmail({
      email,
      name: user.name,
      code,
      expiresInMinutes: 15,
    });

    if (!sent) {
      // Mailtrap not configured — log code for dev use
      console.warn(`[REGISTER] Verification email not sent (Mailtrap not configured). Code: ${code}`);
    }

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        requiresVerification: true,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[REGISTER] error:', err);
    return NextResponse.json(
      { error: true, message: 'Internal server error' },
      { status: 500 },
    );
  }
}
