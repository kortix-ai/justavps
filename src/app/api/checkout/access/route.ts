import { NextRequest, NextResponse } from 'next/server';
import { encode } from 'next-auth/jwt';
import { z } from 'zod';
import { stripeClient } from '@/server/lib/stripe';
import { resolveCheckoutUser } from '@/server/lib/checkout-users';
import { authConfig } from '@/lib/auth-config';
import { config } from '@/server/lib/config';
import { ACCOUNT_COOKIE_NAME } from '@/server/lib/accounts';

const AccessSchema = z.object({
  session_id: z.string().min(1),
});

function getSessionCookieConfig(req: NextRequest) {
  const secure = req.nextUrl.protocol === 'https:' || config.APP_URL.startsWith('https://');
  return {
    name: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    salt: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    secure,
  };
}

export async function POST(req: NextRequest) {
  if (!stripeClient.isConfigured() || !process.env.AUTH_SECRET) {
    return NextResponse.json({ error: true, message: 'Checkout access is not configured' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const parsed = AccessSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ error: true, message: issue?.message || 'Invalid checkout session' }, { status: 400 });
    }

    const session = await stripeClient.getCheckoutSession(parsed.data.session_id);
    if (session.metadata?.justavps_action !== 'create_machine') {
      return NextResponse.json({ error: true, message: 'This checkout session is not valid for machine access' }, { status: 400 });
    }
    if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status || '')) {
      return NextResponse.json({ error: true, message: 'Checkout has not completed yet' }, { status: 409 });
    }

    const email = session.metadata?.justavps_checkout_email || session.customer_details?.email || session.customer_email;
    if (!email) {
      return NextResponse.json({ error: true, message: 'Checkout completed without a customer email' }, { status: 400 });
    }

    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id || null;

    const resolved = await resolveCheckoutUser({
      email,
      name: session.customer_details?.name || null,
      stripeCustomerId: customerId,
    });

    if (customerId) {
      await stripeClient.linkCustomerToUser(customerId, resolved.user.id, email)
        .catch((err: unknown) => console.warn('[CHECKOUT_ACCESS] Failed to link Stripe customer:', err));
      await stripeClient.linkCustomerToAccount(customerId, resolved.accountId, email)
        .catch((err: unknown) => console.warn('[CHECKOUT_ACCESS] Failed to link Stripe account customer:', err));
    }

    const cookie = getSessionCookieConfig(req);
    const maxAge = authConfig.session?.maxAge ?? 30 * 24 * 60 * 60;
    const token = await encode({
      secret: process.env.AUTH_SECRET,
      salt: cookie.salt,
      maxAge,
      token: {
        sub: resolved.user.id,
        email: resolved.user.email,
        name: resolved.user.name,
      },
    });

    const redirectTo = resolved.requiresPasswordSetup
      ? '/welcome?checkout=success'
      : '/machines?checkout=success';

    const res = NextResponse.json({
      ok: true,
      redirect_to: redirectTo,
      requires_password_setup: resolved.requiresPasswordSetup,
    });
    res.cookies.set(cookie.name, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookie.secure,
      path: '/',
      maxAge,
    });
    res.cookies.set(ACCOUNT_COOKIE_NAME, resolved.accountId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookie.secure,
      path: '/',
      maxAge,
    });
    return res;
  } catch (error) {
    console.error('[CHECKOUT_ACCESS] error:', error);
    return NextResponse.json({ error: true, message: 'Failed to unlock checkout access' }, { status: 500 });
  }
}
