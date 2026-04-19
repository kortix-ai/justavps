#!/usr/bin/env npx tsx
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../../src/server/db';
import { users } from '../../src/server/db/schema';

const BASE = process.env.BASE_URL || 'http://localhost:4100';
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';

if (!STRIPE_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

const stripe = new Stripe(STRIPE_KEY);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const email = `guest-checkout-${Date.now()}@test.justavps.com`;
  const password = 'TestPass123!';

  const health = await fetch(BASE);
  assert(health.ok, `app not reachable at ${BASE}`);

  const startRes = await fetch(`${BASE}/api/checkout/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'cloud',
      server_type: 'pro',
      region: 'hel1',
    }),
  });
  const startData = await startRes.json() as { checkout_url?: string; message?: string };
  assert(startRes.ok, `checkout start failed: ${startData.message || startRes.status}`);
  assert(startData.checkout_url?.includes('checkout.stripe.com'), 'checkout_url missing from start response');

  const machineConfig = JSON.stringify({
    provider: 'cloud',
    server_type: 'pro',
    region: 'hel1',
    name: 'direct-checkout-e2e',
  });
  execFileSync('stripe', [
    'trigger',
    'checkout.session.completed',
    '--api-key',
    STRIPE_KEY,
    '--override',
    `checkout_session:metadata.justavps_checkout_email=${email}`,
    '--override',
    'checkout_session:metadata.justavps_action=create_machine',
    '--override',
    'checkout_session:metadata.price_monthly=39',
    '--override',
    `checkout_session:metadata.machine_config=${machineConfig}`,
  ], { stdio: 'pipe' });

  let completedSession: Stripe.Checkout.Session | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const sessions = await stripe.checkout.sessions.list({ limit: 20 });
    completedSession = sessions.data.find((session) => (
      session.metadata?.justavps_checkout_email === email
      && session.status === 'complete'
      && session.metadata?.machine_config === machineConfig
    )) || null;

    if (completedSession) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  assert(completedSession?.id, 'could not find completed checkout session for direct checkout test');

  const accessRes = await fetch(`${BASE}/api/checkout/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: completedSession.id }),
  });
  const accessData = await accessRes.json() as { redirect_to?: string; requires_password_setup?: boolean; message?: string };
  assert(accessRes.ok, `checkout access failed: ${accessData.message || accessRes.status}`);
  assert(accessData.redirect_to === '/welcome?checkout=success', `unexpected redirect: ${accessData.redirect_to}`);
  assert(accessData.requires_password_setup === true, 'new direct-checkout account should require password setup');

  const rawCookie = accessRes.headers.get('set-cookie') || '';
  assert(rawCookie.includes('authjs.session-token') || rawCookie.includes('__Secure-authjs.session-token'), 'session cookie missing from checkout access');
  const cookie = rawCookie.split(';')[0];

  const accountRes = await fetch(`${BASE}/api/v1/account`, {
    headers: { Cookie: cookie },
  });
  const accountData = await accountRes.json() as { email: string; has_password: boolean };
  assert(accountRes.ok, 'account fetch failed after checkout access');
  assert(accountData.email === email, 'direct checkout account email mismatch');
  assert(accountData.has_password === false, 'new direct-checkout user should start passwordless');

  const passwordRes = await fetch(`${BASE}/api/v1/account/password`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert(passwordRes.ok, 'password setup failed');

  const accountAfterPasswordRes = await fetch(`${BASE}/api/v1/account`, {
    headers: { Cookie: cookie },
  });
  const accountAfterPassword = await accountAfterPasswordRes.json() as { has_password: boolean };
  assert(accountAfterPasswordRes.ok, 'account refetch failed after password setup');
  assert(accountAfterPassword.has_password === true, 'password flag did not update');

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrf = await csrfRes.json() as { csrfToken: string };
  const csrfCookie = (csrfRes.headers.get('set-cookie') || '').split(';')[0];

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookie,
    },
    body: new URLSearchParams({
      email,
      password,
      csrfToken: csrf.csrfToken,
    }),
    redirect: 'manual',
  });
  assert([200, 302].includes(loginRes.status), `credential login failed after direct checkout: ${loginRes.status}`);

  const [user] = await db.select().from(users).where(eq(users.email, email));
  assert(user, 'checkout-created user missing from DB');
  await db.delete(users).where(eq(users.email, email));

  console.log('direct checkout e2e ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
