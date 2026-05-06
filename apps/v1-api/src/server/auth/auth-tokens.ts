import { createHash, randomBytes } from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db';
import { authTokens, type AuthTokenPurpose } from '../db/schema';

const TOKEN_BYTES = 32;
const BINDING_BYTES = 32;

const TOKEN_LIFETIME_MS: Record<AuthTokenPurpose, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateRandomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateBindingValue(): string {
  return generateRandomBase64Url(BINDING_BYTES);
}

type IssuedToken = {
  plaintext: string;
  expiresAt: Date;
};

export async function issueAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
  options?: { binding?: string },
): Promise<IssuedToken> {
  await invalidateActiveTokens(userId, purpose);

  const plaintext = generateRandomBase64Url(TOKEN_BYTES);
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS[purpose]);

  await db.insert(authTokens).values({
    userId,
    tokenSha256: sha256(plaintext),
    bindingSha256: options?.binding ? sha256(options.binding) : null,
    purpose,
    expiresAt,
  });

  return { plaintext, expiresAt };
}

type ConsumeTokenResult =
  | { status: 'consumed'; userId: string }
  | { status: 'already_used'; userId: string }
  | { status: 'binding_mismatch'; userId: string }
  | { status: 'not_found' }
  | { status: 'expired' };

export async function consumeAuthToken(
  plaintext: string,
  purpose: AuthTokenPurpose,
  options?: { binding?: string | null },
): Promise<ConsumeTokenResult> {
  const tokenHash = sha256(plaintext);
  const now = new Date();

  const [record] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenSha256, tokenHash), eq(authTokens.purpose, purpose)))
    .limit(1);

  if (!record) return { status: 'not_found' };
  if (record.usedAt) return { status: 'already_used', userId: record.userId };
  if (record.expiresAt.getTime() < now.getTime()) return { status: 'expired' };

  if (record.bindingSha256) {
    const providedBinding = options?.binding ? sha256(options.binding) : null;
    if (providedBinding !== record.bindingSha256) {
      return { status: 'binding_mismatch', userId: record.userId };
    }
  }

  const [consumed] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.id, record.id),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning({ userId: authTokens.userId });

  if (!consumed) {
    return { status: 'already_used', userId: record.userId };
  }

  return { status: 'consumed', userId: consumed.userId };
}

export async function invalidateActiveTokens(
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<void> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
      ),
    );
}
