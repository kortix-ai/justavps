import { NextRequest, NextResponse } from 'next/server';
import { z } from '@hono/zod-openapi';
import { CreateMachineSchema } from '@/lib/schemas';
import { stripeClient, type BillingInterval } from '@/server/lib/stripe';
import { config } from '@/server/lib/config';
import { backupSurcharge } from '@/lib/hetzner-pricing';
import { resolvePlanForDisplay } from '@/lib/plan-catalog';

const GuestCheckoutSchema = z.object({
  plan: CreateMachineSchema.shape.server_type.optional(),
  server_type: CreateMachineSchema.shape.server_type.optional(),
  region: CreateMachineSchema.shape.region,
  billing_interval: CreateMachineSchema.shape.billing_interval.optional(),
  enable_backups: CreateMachineSchema.shape.enable_backups.optional(),
}).refine((value) => Boolean(value.plan || value.server_type), {
  message: 'Plan is required',
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
    const selectedPlan = (input.plan ?? input.server_type) as string;
    const selected = resolvePlanForDisplay(selectedPlan);

    if (!selected) {
      return NextResponse.json({ error: true, message: `Plan ${selectedPlan} is not available in ${input.region}` }, { status: 400 });
    }

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

    return NextResponse.json({ checkout_url: url });
  } catch (error) {
    console.error('[CHECKOUT_START] error:', error);
    return NextResponse.json({ error: true, message: 'Failed to start checkout' }, { status: 500 });
  }
}
