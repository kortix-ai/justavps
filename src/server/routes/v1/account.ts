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

accountApp.get('/billing', async (c) => {
  const userId = c.get('userId');

  if (!stripeClient.isConfigured()) {
    return c.json({ portal_url: null, message: 'Stripe not configured' });
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.stripeCustomerId) {
      return c.json({ portal_url: null, message: 'No billing account yet. Create a machine to start.' });
    }

    const returnUrl = `${config.APP_URL}/settings`;
    const portalUrl = await stripeClient.createPortalSession(user.stripeCustomerId, returnUrl);

    return c.json({ portal_url: portalUrl });
  } catch (err) {
    console.error('[BILLING] portal error:', err);
    return c.json({ portal_url: null, message: 'Failed to create billing portal session' });
  }
});
