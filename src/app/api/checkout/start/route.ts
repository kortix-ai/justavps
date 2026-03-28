import { NextRequest, NextResponse } from 'next/server';
import { CreateMachineSchema } from '@/lib/schemas';
import { stripeClient, type BillingInterval } from '@/server/lib/stripe';
import { getProvider } from '@/server/lib/providers';
import { config } from '@/server/lib/config';
import { backupSurcharge } from '@/lib/hetzner-pricing';

const GuestCheckoutSchema = CreateMachineSchema.pick({
  provider: true,
  server_type: true,
  region: true,
  billing_interval: true,
  enable_backups: true,
});

// Temporary diagnostic — test raw Stripe connectivity from Vercel
export async function GET() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const results: Record<string, unknown> = { key_prefix: key.slice(0, 15) };

  // Test 1: Raw fetch
  try {
    const resp = await fetch('https://api.stripe.com/v1/customers?limit=1', {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    results.fetch_status = resp.status;
    results.fetch_ok = resp.ok;
    if (!resp.ok) {
      results.fetch_error = await resp.text();
    }
  } catch (e) {
    results.fetch_error = e instanceof Error ? e.message : String(e);
  }

  // Test 2: Stripe SDK (shared instance from stripe.ts)
  try {
    const ok = stripeClient.isConfigured();
    results.sdk_configured = ok;
  } catch (e) {
    results.sdk_configured_error = e instanceof Error ? e.message : String(e);
  }

  // Test 3: Stripe SDK call
  try {
    const Stripe = (await import('stripe')).default;
    const s = new Stripe(key, {
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 0,
      timeout: 15000,
    });
    const list = await s.customers.list({ limit: 1 });
    results.sdk_ok = true;
    results.sdk_count = list.data.length;
  } catch (e) {
    results.sdk_ok = false;
    results.sdk_error = e instanceof Error ? e.message : String(e);
    results.sdk_error_type = e instanceof Error ? e.constructor.name : typeof e;
  }

  const ok = results.fetch_ok === true && results.sdk_ok === true;
  return NextResponse.json({ ok, ...results }, { status: ok ? 200 : 500 });
}

export async function POST(req: NextRequest) {
  if (!stripeClient.isConfigured()) {
    return NextResponse.json({ error: true, message: 'Stripe not configured' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const parsed = GuestCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ error: true, message: issue?.message || 'Invalid checkout request' }, { status: 400 });
    }

    const input = parsed.data;
    const provider = getProvider(input.provider);
    const serverTypes = await provider.listServerTypes(input.region);
    const selected = serverTypes.find((serverType) => serverType.name === input.server_type);

    if (!selected) {
      return NextResponse.json({ error: true, message: `Server type ${input.server_type} is not available in ${input.region}` }, { status: 400 });
    }

    const billingInterval = (input.billing_interval ?? 'monthly') as BillingInterval;
    const wantBackups = input.enable_backups === true;
    const basePrice = selected.priceMonthly;
    const totalMonthly = wantBackups ? basePrice + backupSurcharge(basePrice) : basePrice;
    const { url } = await stripeClient.createCheckoutSession({
      machineConfig: {
        provider: input.provider,
        server_type: input.server_type,
        region: input.region,
        billing_interval: billingInterval,
        enable_backups: wantBackups,
        specs: {
          vcpus: selected.cores,
          ramGb: selected.memory,
          diskGb: selected.disk,
          cpuType: selected.cpuType,
        },
      },
      priceMonthlyUsd: totalMonthly,
      billingInterval,
      successUrl: `${config.APP_URL}/checkout/success`,
      cancelUrl: `${config.APP_URL}?checkout=cancelled`,
    });

    return NextResponse.json({ checkout_url: url });
  } catch (error) {
    console.error('[CHECKOUT_START] error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const keyPrefix = (process.env.STRIPE_SECRET_KEY || '').slice(0, 15) + '...';
    return NextResponse.json({ error: true, message: 'Failed to start checkout', detail, key_prefix: keyPrefix }, { status: 500 });
  }
}
