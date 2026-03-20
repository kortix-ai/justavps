/**
 * POST /api/auth/register — Create a new user account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/server/lib/crypto';
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

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const isAdmin = email.endsWith('@kortix.ai') || email.endsWith('@kortix.com');
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: name || email.split('@')[0],
        isAdmin,
      })
      .returning();

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
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
