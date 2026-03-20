import { NextRequest, NextResponse } from 'next/server';
import { CreateMachineSchema } from '@/lib/schemas';
import { stripeClient, type BillingInterval } from '@/server/lib/stripe';
import { getProvider } from '@/server/lib/providers';
import { config } from '@/server/lib/config';

const GuestCheckoutSchema = CreateMachineSchema.pick({
  provider: true,
  server_type: true,
  region: true,
  billing_interval: true,
});

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
    const { url } = await stripeClient.createCheckoutSession({
      machineConfig: {
        provider: input.provider,
        server_type: input.server_type,
        region: input.region,
        billing_interval: billingInterval,
        specs: {
          vcpus: selected.cores,
          ramGb: selected.memory,
          diskGb: selected.disk,
          cpuType: selected.cpuType,
        },
      },
      priceMonthlyUsd: selected.priceMonthly,
      billingInterval,
      successUrl: `${config.APP_URL}/checkout/success`,
      cancelUrl: `${config.APP_URL}?checkout=cancelled`,
    });

    return NextResponse.json({ checkout_url: url });
  } catch (error) {
    console.error('[CHECKOUT_START] error:', error);
    return NextResponse.json({ error: true, message: 'Failed to start checkout' }, { status: 500 });
  }
}
