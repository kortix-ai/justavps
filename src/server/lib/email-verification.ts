/**
 * Email verification — generate codes, verify them, manage tokens.
 *
 * Flow:
 *  1. On register → generateVerificationCode(userId, email)
 *  2. User receives 6-digit code via Mailtrap
 *  3. User submits code → verifyCode(userId, code)
 *  4. On success → user.emailVerified = now()
 */

import { randomInt, createHash } from 'crypto';
import { db } from '../db';
import { emailVerificationTokens, users } from '../db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';

const CODE_EXPIRY_MINUTES = 15;
const MAX_ACTIVE_TOKENS = 5; // rate-limit: max pending tokens per user

/**
 * Hash a verification code with SHA-256 for storage.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Generate a 6-digit numeric verification code.
 * Returns the plaintext code (to send via email) — only the hash is stored.
 */
export async function generateVerificationCode(
  userId: string,
  email: string,
): Promise<{ code: string; expiresAt: Date }> {
  // Rate-limit: count active (unused, unexpired) tokens for this user
  const active = await db
    .select({ id: emailVerificationTokens.id })
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        isNull(emailVerificationTokens.usedAt),
        gt(emailVerificationTokens.expiresAt, new Date()),
      ),
    );

  if (active.length >= MAX_ACTIVE_TOKENS) {
    throw new Error('Too many pending verification codes. Please wait before requesting another.');
  }

  // Generate 6-digit code (100000–999999)
  const code = String(randomInt(100000, 999999 + 1));
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(emailVerificationTokens).values({
    userId,
    email: email.toLowerCase().trim(),
    tokenHash: hashCode(code),
    expiresAt,
  });

  return { code, expiresAt };
}

/**
 * Verify a 6-digit code for a user.
 * On success: marks token as used, sets user.emailVerified = now().
 * Returns true if verified, false if invalid/expired.
 */
export async function verifyCode(
  userId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const codeHash = hashCode(code.trim());

  // Find a matching, unused, unexpired token
  const [token] = await db
    .select()
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        eq(emailVerificationTokens.tokenHash, codeHash),
        isNull(emailVerificationTokens.usedAt),
        gt(emailVerificationTokens.expiresAt, new Date()),
      ),
    );

  if (!token) {
    return { success: false, error: 'Invalid or expired verification code.' };
  }

  // Mark token as used
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokens.id, token.id));

  // Mark user email as verified
  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Check if a user's email is verified.
 */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId));

  return !!user?.emailVerified;
}
