/**
 * POST /api/auth/check-verification — Check if a user needs email verification.
 *
 * Used by the login page: when credentials login fails, the client calls this
 * to determine whether the failure is because the email isn't verified yet
 * (vs wrong password).
 *
 * Returns { needsVerification: true, userId } if the account exists,
 * has a password, and emailVerified is null.
 *
 * Intentionally does NOT reveal whether the email exists if the password
 * isn't provided — to avoid user enumeration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/server/lib/crypto';
import { z } from 'zod';

const CheckSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CheckSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ needsVerification: false }, { status: 200 });
    }

    const { email, password } = parsed.data;

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, email));

    if (!user || !user.passwordHash) {
      return NextResponse.json({ needsVerification: false }, { status: 200 });
    }

    // Only reveal verification status if password is correct
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ needsVerification: false }, { status: 200 });
    }

    if (!user.emailVerified) {
      return NextResponse.json(
        { needsVerification: true, userId: user.id, email: user.email },
        { status: 200 },
      );
    }

    return NextResponse.json({ needsVerification: false }, { status: 200 });
  } catch {
    return NextResponse.json({ needsVerification: false }, { status: 200 });
  }
}
