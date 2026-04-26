import { decode, encode } from 'next-auth/jwt';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { ACCOUNT_COOKIE_NAME, resolveAccountForUser } from '@/server/auth/accounts';
import { consumeAuthToken, generateBindingValue, invalidateActiveTokens, issueAuthToken } from '@/server/auth/auth-tokens';
import { VERIFICATION_BINDING_COOKIE } from '@/server/auth/verification-binding';
import { signProxyToken, buildProxyCookieHeader } from '@/server/auth/proxy-token';
import { authConfig } from '@/shared/lib/auth-config';
import { backupSurcharge, resolvePlanForDisplay } from '@/shared/lib/plan-catalog';
import { CreateMachineSchema } from '@/shared/lib/schemas';
import { config } from '@/server/core/config';
import { hashPassword } from '@/server/core/crypto';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { resolveCheckoutUser } from '@/server/v1/services/checkout-users';
import { emailClient } from '@/server/v1/services/email';
import { stripeClient, type BillingInterval } from '@/server/v1/services/stripe';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const VERIFY_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

const emailField = z.string().email('Invalid email address').transform((value) => value.toLowerCase().trim());
const passwordField = z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX, 'Password is too long');
const tokenField = z.string().min(16, 'Invalid token').max(256, 'Invalid token');

const RegisterSchema = z.object({
  email: emailField,
  password: passwordField,
  name: z.string().min(1).max(128).optional(),
});

const VerifyEmailSchema = z.object({ token: tokenField });
const ResendVerificationSchema = z.object({ email: emailField });
const ForgotPasswordSchema = z.object({ email: emailField });
const ResetPasswordSchema = z.object({ token: tokenField, password: passwordField });

const GuestCheckoutSchema = z.object({
  plan: CreateMachineSchema.shape.server_type.optional(),
  server_type: CreateMachineSchema.shape.server_type.optional(),
  region: CreateMachineSchema.shape.region,
  billing_interval: CreateMachineSchema.shape.billing_interval.optional(),
  enable_backups: CreateMachineSchema.shape.enable_backups.optional(),
}).refine((value) => Boolean(value.plan || value.server_type), {
  message: 'Plan is required',
});

const AccessSchema = z.object({ session_id: z.string().min(1) });

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message || 'Invalid input';
}

function isSecureRequest(c: Context) {
  const forwardedProto = c.req.header('x-forwarded-proto');
  return forwardedProto === 'https' || c.req.url.startsWith('https://') || config.APP_URL.startsWith('https://');
}

function setVerificationBinding(c: Context, value: string) {
  setCookie(c, VERIFICATION_BINDING_COOKIE, value, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: VERIFY_COOKIE_MAX_AGE_SECONDS,
  });
}

function extractCookieValue(cookieHeader: string, name: string): string | null {
  const regex = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]+)`);
  const match = cookieHeader.match(regex);
  return match ? decodeURIComponent(match[1]) : null;
}

function extractSessionCookie(cookieHeader: string): { value: string; salt: string } | null {
  const patterns = [
    { name: '__Secure-authjs.session-token', salt: '__Secure-authjs.session-token' },
    { name: 'authjs.session-token', salt: 'authjs.session-token' },
    { name: 'next-auth.session-token', salt: 'next-auth.session-token' },
  ];
  for (const { name, salt } of patterns) {
    const value = extractCookieValue(cookieHeader, name);
    if (value) return { value, salt };
  }
  return null;
}

async function readSessionUserId(c: Context) {
  if (!process.env.AUTH_SECRET) return null;
  const sessionCookie = extractSessionCookie(c.req.header('cookie') || '');
  if (!sessionCookie) return null;
  const token = await decode({
    token: sessionCookie.value,
    secret: process.env.AUTH_SECRET,
    salt: sessionCookie.salt,
  });
  return typeof token?.sub === 'string' ? token.sub : null;
}

function getSessionCookieConfig(c: Context) {
  const secure = isSecureRequest(c);
  return {
    name: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    salt: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    secure,
  };
}

export function registerWebApiRoutes(app: Hono) {
  app.post('/api/auth/register', async (c) => {
    try {
      const parsed = RegisterSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: true, message: firstZodError(parsed.error) }, 400);

      const { email, password, name } = parsed.data;
      const [existing] = await db.select().from(users).where(eq(users.email, email));
      if (existing) return c.json({ error: true, message: 'An account with this email already exists' }, 409);

      const passwordHash = await hashPassword(password);
      const [user] = await db.insert(users).values({
        email,
        passwordHash,
        name: name || email.split('@')[0],
      }).returning({ id: users.id, email: users.email, name: users.name });

      const binding = generateBindingValue();
      setVerificationBinding(c, binding);
      const { plaintext } = await issueAuthToken(user.id, 'email_verification', { binding });
      await emailClient.sendVerificationEmail({ email: user.email, name: user.name, token: plaintext });

      return c.json({ id: user.id, email: user.email, name: user.name, emailVerificationRequired: true }, 201);
    } catch (err) {
      console.error('[REGISTER] error:', err);
      return c.json({ error: true, message: 'Internal server error' }, 500);
    }
  });

  app.post('/api/auth/forgot-password', async (c) => {
    try {
      const parsed = ForgotPasswordSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: true, message: firstZodError(parsed.error) }, 400);

      const [user] = await db.select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, parsed.data.email));

      if (user && user.passwordHash) {
        const { plaintext } = await issueAuthToken(user.id, 'password_reset');
        await emailClient.sendPasswordResetEmail({ email: user.email, name: user.name, token: plaintext });
      }

      return c.json({ sent: true });
    } catch (err) {
      console.error('[FORGOT_PASSWORD] error:', err);
      return c.json({ error: true, message: 'Internal server error' }, 500);
    }
  });

  app.post('/api/auth/reset-password', async (c) => {
    try {
      const parsed = ResetPasswordSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: true, message: firstZodError(parsed.error) }, 400);

      const result = await consumeAuthToken(parsed.data.token, 'password_reset');
      if (result.status !== 'consumed') return c.json({ error: true, message: 'This reset link is invalid or has expired' }, 400);

      const passwordHash = await hashPassword(parsed.data.password);
      await db.update(users).set({ passwordHash, emailVerified: new Date() }).where(eq(users.id, result.userId));
      await invalidateActiveTokens(result.userId, 'password_reset');

      return c.json({ reset: true });
    } catch (err) {
      console.error('[RESET_PASSWORD] error:', err);
      return c.json({ error: true, message: 'Internal server error' }, 500);
    }
  });

  app.post('/api/auth/verify-email', async (c) => {
    try {
      const parsed = VerifyEmailSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: true, message: firstZodError(parsed.error) }, 400);

      const result = await consumeAuthToken(parsed.data.token, 'email_verification', { binding: getCookie(c, VERIFICATION_BINDING_COOKIE) ?? null });
      if (result.status === 'not_found' || result.status === 'expired') return c.json({ error: true, message: 'This verification link is invalid or has expired' }, 400);
      if (result.status === 'binding_mismatch') return c.json({ error: true, message: 'Open this link from the device you used to sign up' }, 400);
      if (result.status === 'consumed') await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, result.userId));

      return c.json({ verified: true });
    } catch (err) {
      console.error('[VERIFY_EMAIL] error:', err);
      return c.json({ error: true, message: 'Internal server error' }, 500);
    }
  });

  app.post('/api/auth/resend-verification', async (c) => {
    try {
      const parsed = ResendVerificationSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: true, message: firstZodError(parsed.error) }, 400);

      const [user] = await db.select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, parsed.data.email));

      if (user && !user.emailVerified) {
        const binding = generateBindingValue();
        setVerificationBinding(c, binding);
        const { plaintext } = await issueAuthToken(user.id, 'email_verification', { binding });
        await emailClient.sendVerificationEmail({ email: user.email, name: user.name, token: plaintext });
      }

      return c.json({ sent: true });
    } catch (err) {
      console.error('[RESEND_VERIFICATION] error:', err);
      return c.json({ error: true, message: 'Internal server error' }, 500);
    }
  });

  app.post('/api/checkout/start', async (c) => {
    if (!stripeClient.isConfigured()) return c.json({ error: true, message: 'Stripe not configured' }, 503);

    try {
      const parsed = GuestCheckoutSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: true, message: parsed.error.issues[0]?.message || 'Invalid checkout request' }, 400);

      const input = parsed.data;
      const selectedPlan = (input.plan ?? input.server_type) as string;
      const selected = resolvePlanForDisplay(selectedPlan);
      if (!selected) return c.json({ error: true, message: `Plan ${selectedPlan} is not available in ${input.region}` }, 400);

      const billingInterval = (input.billing_interval ?? 'monthly') as BillingInterval;
      const wantBackups = input.enable_backups === true;
      const basePrice = selected.priceMonthly;
      const totalMonthly = wantBackups ? basePrice + backupSurcharge(basePrice) : basePrice;
      const { url } = await stripeClient.createCheckoutSession({
        machineConfig: {
          provider: 'cloud',
          server_type: selectedPlan,
          region: input.region,
          billing_interval: billingInterval,
          enable_backups: wantBackups,
          specs: {
            vcpus: selected.vcpu,
            ramGb: selected.memory,
            diskGb: selected.disk,
            cpuType: 'shared',
          },
        },
        priceMonthlyUsd: totalMonthly,
        billingInterval,
        successUrl: `${config.APP_URL}/checkout/success`,
        cancelUrl: `${config.APP_URL}?checkout=cancelled`,
      });

      return c.json({ checkout_url: url });
    } catch (error) {
      console.error('[CHECKOUT_START] error:', error);
      return c.json({ error: true, message: 'Failed to start checkout' }, 500);
    }
  });

  app.post('/api/checkout/access', async (c) => {
    if (!stripeClient.isConfigured() || !process.env.AUTH_SECRET) return c.json({ error: true, message: 'Checkout access is not configured' }, 503);

    try {
      const parsed = AccessSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: true, message: parsed.error.issues[0]?.message || 'Invalid checkout session' }, 400);

      const session = await stripeClient.getCheckoutSession(parsed.data.session_id);
      if (session.metadata?.justavps_action !== 'create_machine') return c.json({ error: true, message: 'This checkout session is not valid for machine access' }, 400);
      if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status || '')) return c.json({ error: true, message: 'Checkout has not completed yet' }, 409);

      const email = session.metadata?.justavps_checkout_email || session.customer_details?.email || session.customer_email;
      if (!email) return c.json({ error: true, message: 'Checkout completed without a customer email' }, 400);

      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
      const resolved = await resolveCheckoutUser({ email, name: session.customer_details?.name || null, stripeCustomerId: customerId });

      if (customerId) {
        await stripeClient.linkCustomerToUser(customerId, resolved.user.id, email).catch((err: unknown) => console.warn('[CHECKOUT_ACCESS] Failed to link Stripe customer:', err));
        await stripeClient.linkCustomerToAccount(customerId, resolved.accountId, email).catch((err: unknown) => console.warn('[CHECKOUT_ACCESS] Failed to link Stripe account customer:', err));
      }

      const cookie = getSessionCookieConfig(c);
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

      setCookie(c, cookie.name, token, { httpOnly: true, sameSite: 'Lax', secure: cookie.secure, path: '/', maxAge });
      setCookie(c, ACCOUNT_COOKIE_NAME, resolved.accountId, { httpOnly: true, sameSite: 'Lax', secure: cookie.secure, path: '/', maxAge });

      return c.json({
        ok: true,
        redirect_to: resolved.requiresPasswordSetup ? '/welcome?checkout=success' : '/machines?checkout=success',
        requires_password_setup: resolved.requiresPasswordSetup,
      });
    } catch (error) {
      console.error('[CHECKOUT_ACCESS] error:', error);
      return c.json({ error: true, message: 'Failed to unlock checkout access' }, 500);
    }
  });

  app.get('/api/proxy-auth', async (c) => {
    try {
      const userId = await readSessionUserId(c);
      if (!userId) {
        const redirect = c.req.query('redirect') || '';
        const loginUrl = new URL('/login', new URL(c.req.url).origin);
        loginUrl.searchParams.set('callbackUrl', `/api/proxy-auth?redirect=${encodeURIComponent(redirect)}`);
        return c.redirect(loginUrl.toString());
      }

      const redirect = c.req.query('redirect');
      const escapedProxyDomain = config.PROXY_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const allowedRedirectPattern = new RegExp(`^https:\\/\\/(?:[0-9]+--)?[a-z0-9-]+\\.${escapedProxyDomain}(?:\\/.*)?$`);
      if (!redirect || !allowedRedirectPattern.test(redirect)) return c.json({ error: `Invalid or missing redirect URL. Must be https://<slug>.${config.PROXY_DOMAIN}/... or https://<port>--<slug>.${config.PROXY_DOMAIN}/...` }, 400);

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return c.json({ error: 'User not found' }, 404);

      const accountContext = await resolveAccountForUser(user, getCookie(c, ACCOUNT_COOKIE_NAME) || null);
      const token = await signProxyToken(accountContext.active.account.id, userId);
      const redirectUrl = new URL(redirect);
      redirectUrl.searchParams.set('__proxy_token', token);
      return c.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('[proxy-auth] Error:', error);
      return c.json({ error: 'Failed to issue proxy auth token', details: error instanceof Error ? error.message : 'Unknown error' }, 500);
    }
  });

  app.post('/api/proxy-auth', async (c) => {
    const userId = await readSessionUserId(c);
    if (!userId) return c.json({ error: 'Authentication required' }, 401);

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    const accountContext = await resolveAccountForUser(user, getCookie(c, ACCOUNT_COOKIE_NAME) || null);
    const token = await signProxyToken(accountContext.active.account.id, userId);

    return c.json({ token, expires_in: 86400, cookie_header: buildProxyCookieHeader(token) });
  });
}
