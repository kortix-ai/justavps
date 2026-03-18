import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users, machines } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { stripeClient } from '../../lib/stripe';
import { config } from '../../lib/config';

export const accountApp = new Hono<{ Variables: AuthVariables }>();
accountApp.use('*', apiGuard);

accountApp.get('/', async (c) => {
  const userId = c.get('userId');

  try {
    const [userRow] = await db.select().from(users).where(eq(users.id, userId));
    if (!userRow) {
      return c.json({ error: true, message: 'User not found' }, 404);
    }

    const userMachines = await db.select().from(machines)
      .where(eq(machines.ownerId, userId))
      .then(rows => rows.filter(r => r.status !== 'deleted'));

    return c.json({
      id: userId,
      email: userRow.email,
      name: userRow.name,
      machines_count: userMachines.length,
      stripe_customer_id: userRow.stripeCustomerId ?? null,
      created_at: userRow.createdAt.toISOString(),
    });
  } catch (err) {
    console.error('[ACCOUNT] Error fetching account:', err);
    return c.json({ error: true, message: 'Failed to fetch account' }, 500);
  }
});

accountApp.get('/usage', async (c) => {
  const userId = c.get('userId');

  try {
    const userMachines = await db.select().from(machines)
      .where(eq(machines.ownerId, userId))
      .then(rows => rows.filter(r => r.status !== 'deleted'));

    const estimatedCost = userMachines.reduce((sum, m) => {
      return sum + (m.priceMonthly ?? 0);
    }, 0);

    return c.json({
      current_period: {
        machines: userMachines.map(m => ({
          id: m.id,
          slug: m.slug,
          server_type: m.serverType,
          status: m.status,
        })),
        total_machines: userMachines.length,
        estimated_cost: estimatedCost,
      },
    });
  } catch (err) {
    console.error('[ACCOUNT] Error fetching usage:', err);
    return c.json({ error: true, message: 'Failed to fetch usage' }, 500);
  }
});

/**
 * GET /account/billing — returns billing portal URL + payment method status.
 * The frontend uses `has_payment_method` to decide what UI to show.
 */
accountApp.get('/billing', async (c) => {
  const userId = c.get('userId');

  if (!stripeClient.isConfigured()) {
    return c.json({
      portal_url: null,
      has_payment_method: false,
      message: 'Stripe not configured',
    });
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));

    if (!user?.stripeCustomerId) {
      // Create Stripe customer proactively so we can offer setup checkout
      const customerId = await stripeClient.getOrCreateCustomer(userId, user?.email || '');
      if (user) {
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
      }

      return c.json({
        portal_url: null,
        has_payment_method: false,
        message: 'No payment method on file.',
      });
    }

    const hasPM = await stripeClient.hasPaymentMethod(user.stripeCustomerId);
    const returnUrl = `${config.APP_URL}/billing`;
    const portalUrl = await stripeClient.createPortalSession(user.stripeCustomerId, returnUrl);

    return c.json({
      portal_url: portalUrl,
      has_payment_method: hasPM,
    });
  } catch (err) {
    console.error('[BILLING] portal error:', err);
    return c.json({
      portal_url: null,
      has_payment_method: false,
      message: 'Failed to create billing portal session',
    });
  }
});

/**
 * POST /account/billing/setup — create a Stripe Checkout Session in setup mode.
 * Used from the billing page "Add payment method" button.
 * Returns a checkout URL the frontend redirects to.
 */
accountApp.post('/billing/setup', async (c) => {
  const userId = c.get('userId');

  if (!stripeClient.isConfigured()) {
    return c.json({ error: true, message: 'Stripe not configured' }, 503);
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return c.json({ error: true, message: 'User not found' }, 404);

    // Ensure Stripe customer exists
    const customerId = await stripeClient.getOrCreateCustomer(userId, user.email);
    if (!user.stripeCustomerId) {
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
    }

    const { url } = await stripeClient.createSetupCheckoutSession({
      customerId,
      successUrl: `${config.APP_URL}/billing`,
      cancelUrl: `${config.APP_URL}/billing`,
    });

    return c.json({ checkout_url: url });
  } catch (err) {
    console.error('[BILLING] setup checkout error:', err);
    return c.json({ error: true, message: 'Failed to create setup session' }, 500);
  }
});
