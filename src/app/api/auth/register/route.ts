import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { hashPassword } from '@/server/core/crypto';
import { issueAuthToken } from '@/server/auth/auth-tokens';
import { emailClient } from '@/server/v1/services/email';
import { issueVerificationBinding } from '@/server/auth/verification-binding';
import { RegisterSchema } from '../_schemas';
import { badRequest, conflict, firstZodError, serverError } from '../_responses';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(firstZodError(parsed.error));
    }

    const { email, password, name } = parsed.data;

    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      return conflict('An account with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: name || email.split('@')[0],
      })
      .returning({ id: users.id, email: users.email, name: users.name });

    const response = NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerificationRequired: true,
      },
      { status: 201 },
    );

    const binding = issueVerificationBinding(response);
    const { plaintext } = await issueAuthToken(user.id, 'email_verification', { binding });
    await emailClient.sendVerificationEmail({
      email: user.email,
      name: user.name,
      token: plaintext,
    });

    return response;
  } catch (err) {
    console.error('[REGISTER] error:', err);
    return serverError();
  }
}
