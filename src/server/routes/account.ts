import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, machines } from '../db/schema';
import { authMiddleware, type AuthVariables } from '../lib/middleware';
import { stripeClient } from '../lib/stripe';

export const accountApp = new Hono<{ Variables: AuthVariables }>();
accountApp.use('*', authMiddleware);

accountApp.get('/', async (c) => {
  const userId = c.get('userId');
  let userRow;
  try {
    [userRow] = await db.select().from(users).where(eq(users.id, userId));
  } catch {}

  const userMachines = await db.select().from(machines)
    .where(eq(machines.ownerId, userId))
    .then(rows => rows.filter(r => r.status !== 'deleted'))
    .catch(() => [] as any[]);

  return c.json({
    id: userId,
    email: userRow?.email ?? 'user@example.com',
    name: userRow?.name ?? 'User',
    machines_count: userMachines.length,
    stripe_customer_id: userRow?.stripeCustomerId ?? null,
    created_at: userRow?.createdAt?.toISOString() ?? new Date().toISOString(),
  });
});

accountApp.get('/usage', async (c) => {
  const userId = c.get('userId');
  const userMachines = await db.select().from(machines)
    .where(eq(machines.ownerId, userId))
    .then(rows => rows.filter(r => r.status !== 'deleted'))
    .catch(() => [] as any[]);

  // Calculate estimated cost from machine count
  const estimatedCost = userMachines.reduce((sum, m) => {
    // Rough estimate — real cost comes from Stripe
    return sum + 9; // Minimum cost per machine
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

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100'}/settings`;
    const portalUrl = await stripeClient.createPortalSession(user.stripeCustomerId, returnUrl);

    return c.json({ portal_url: portalUrl });
  } catch (err) {
    console.error('[BILLING] portal error:', err);
    return c.json({ portal_url: null, message: 'Failed to create billing portal session' });
  }
});
