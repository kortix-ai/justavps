/**
 * POST /api/auth/apikey — Authenticate via API key.
 *
 * Validates an API key against the database and, depending on the callbackUrl:
 *   - If callbackUrl points to /api/proxy-auth?redirect=..., issues a proxy token
 *     and returns the final redirect URL (bypasses session-based proxy-auth entirely).
 *   - Otherwise, returns success so the client can redirect to the dashboard.
 *
 * This endpoint does NOT create a NextAuth session — it handles the specific
 * auth flow inline (API key → proxy token → redirect).
 */

import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { apiKeys } from '@/server/db/schema';
import { validateApiKey } from '@/server/lib/crypto';
import { signProxyToken } from '@/server/lib/proxy-token';
import { eq } from 'drizzle-orm';

const ALLOWED_REDIRECT_PATTERN = /^https:\/\/[a-z0-9-]+\.kortix\.cloud(\/.*)?$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { apiKey, callbackUrl } = body as { apiKey?: string; callbackUrl?: string };

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { error: true, message: 'API key is required.' },
        { status: 400 },
      );
    }

    // Validate the API key format
    if (!apiKey.startsWith('sk_live_')) {
      return NextResponse.json(
        { error: true, message: 'Invalid API key format. Keys start with sk_live_.' },
        { status: 400 },
      );
    }

    // Find matching key in DB
    const allKeys = await db.select().from(apiKeys);
    let ownerId: string | null = null;
    let matchedKeyId: string | null = null;

    for (const k of allKeys) {
      if (await validateApiKey(apiKey, k.keyHash)) {
        ownerId = k.ownerId;
        matchedKeyId = k.id;
        break;
      }
    }

    if (!ownerId || !matchedKeyId) {
      return NextResponse.json(
        { error: true, message: 'Invalid API key.' },
        { status: 401 },
      );
    }

    // Update lastUsed timestamp (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsed: new Date() })
      .where(eq(apiKeys.id, matchedKeyId))
      .catch((err) => console.error('[APIKEY_AUTH] Failed to update lastUsed:', err));

    // Check if the callbackUrl is a proxy-auth flow
    // e.g. /api/proxy-auth?redirect=https%3A%2F%2Fslug.kortix.cloud%2F...
    if (callbackUrl && callbackUrl.startsWith('/api/proxy-auth')) {
      try {
        const callbackParsed = new URL(callbackUrl, 'http://localhost');
        const redirect = callbackParsed.searchParams.get('redirect');

        if (redirect && ALLOWED_REDIRECT_PATTERN.test(redirect)) {
          // Issue a proxy token directly — skip the session-based proxy-auth route
          const token = await signProxyToken(ownerId);
          const redirectUrl = new URL(redirect);
          redirectUrl.searchParams.set('__proxy_token', token);

          return NextResponse.json({
            ok: true,
            redirectUrl: redirectUrl.toString(),
          });
        }
      } catch {
        // Failed to parse callbackUrl — fall through to default response
      }
    }

    // Default: no proxy redirect, just confirm auth succeeded
    return NextResponse.json({
      ok: true,
      next: '/machines',
    });
  } catch (error) {
    console.error('[APIKEY_AUTH] Error:', error);
    return NextResponse.json(
      { error: true, message: 'Authentication failed.' },
      { status: 500 },
    );
  }
}
