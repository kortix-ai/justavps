/**
 * Setup Stripe Customer Portal configuration.
 *
 * Ensures the portal allows:
 * - Subscription cancellation (cancel at period end)
 * - Payment method updates
 * - Invoice history viewing
 *
 * Run: npx tsx scripts/setup-stripe-portal.ts
 *
 * This is idempotent — it creates or updates the default portal configuration.
 * Requires STRIPE_SECRET_KEY in .env.
 */

import 'dotenv/config';
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is required in .env');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

async function setupPortal() {
  console.log('[PORTAL SETUP] Checking existing portal configurations...');

  // List existing configurations
  const existing = await stripe.billingPortal.configurations.list({ limit: 10 });
  const defaultConfig = existing.data.find(c => c.is_default);

  const portalFeatures = {
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end' as const,
      cancellation_reason: {
        enabled: true,
        options: [
          'too_expensive' as const,
          'missing_features' as const,
          'switched_service' as const,
          'unused' as const,
          'other' as const,
        ],
      },
    },
    payment_method_update: {
      enabled: true,
    },
    invoice_history: {
      enabled: true,
    },
    customer_update: {
      enabled: true,
      allowed_updates: ['email' as const],
    },
  };

  if (defaultConfig) {
    console.log(`[PORTAL SETUP] Updating existing default configuration: ${defaultConfig.id}`);
    await stripe.billingPortal.configurations.update(defaultConfig.id, {
      features: portalFeatures,
      business_profile: {
        headline: 'Manage your JustAVPS subscription',
      },
    });
    console.log(`[PORTAL SETUP] ✅ Updated configuration ${defaultConfig.id}`);
  } else {
    console.log('[PORTAL SETUP] Creating new default portal configuration...');
    const config = await stripe.billingPortal.configurations.create({
      features: portalFeatures,
      business_profile: {
        headline: 'Manage your JustAVPS subscription',
      },
    });
    console.log(`[PORTAL SETUP] ✅ Created configuration ${config.id}`);
  }

  console.log('[PORTAL SETUP] Portal configuration:');
  console.log('  - Subscription cancellation: ENABLED (at period end)');
  console.log('  - Cancellation reasons: ENABLED');
  console.log('  - Payment method updates: ENABLED');
  console.log('  - Invoice history: ENABLED');
  console.log('  - Customer email update: ENABLED');
}

setupPortal().catch((err) => {
  console.error('[PORTAL SETUP] Failed:', err);
  process.exit(1);
});
