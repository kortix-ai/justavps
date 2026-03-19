import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users, machines } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { stripeClient } from '../../lib/stripe';
import { config } from '../../lib/config';
import {
  getAccountLimits,
  countActiveMachines,
  countActiveImages,
} from '../../lib/account-limits';
import {
  AccountResponseSchema,
  AccountUsageResponseSchema,
  AccountLimitsResponseSchema,
  BillingResponseSchema,
  BillingSetupResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const accountApp = new OpenAPIHono<{ Variables: AuthVariables }>();
accountApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

// ─── GET / — Get Account ────────────────────────────────────────────────────

const getAccountRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get account info',
  responses: {
    200: {
      description: 'Account details',
      content: { 'application/json': { schema: AccountResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-expect-error — handler returns multiple shapes (error + success); spec types are correctly declared above
accountApp.openapi(getAccountRoute, async (c) => {
  const userId = c.get('userId');

  try {
    const [userRow] = await db.select().from(users).where(eq(users.id, userId));
    if (!userRow) {
      return c.json({ error: true, message: 'User not found', status: 404 }, 404);
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
    return c.json({ error: true, message: 'Failed to fetch account', status: 500 }, 500);
  }
});

// ─── GET /usage — Get Usage Stats ──────────────────────────────────────────

const getAccountUsageRoute = createRoute({
  method: 'get',
  path: '/usage',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get usage stats',
  description: 'Returns current billing period usage including active machines and estimated cost.',
  responses: {
    200: {
      description: 'Usage statistics',
      content: { 'application/json': { schema: AccountUsageResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-expect-error — handler returns multiple shapes (error + success); spec types are correctly declared above
accountApp.openapi(getAccountUsageRoute, async (c) => {
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
    return c.json({ error: true, message: 'Failed to fetch usage', status: 500 }, 500);
  }
});

// ─── GET /billing — Get Billing Info ────────────────────────────────────────

const getBillingRoute = createRoute({
  method: 'get',
  path: '/billing',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get billing info',
  description: 'Returns Stripe billing portal URL and payment method status.',
  responses: {
    200: {
      description: 'Billing info',
      content: { 'application/json': { schema: BillingResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-expect-error — handler returns multiple shapes (error + success); spec types are correctly declared above
accountApp.openapi(getBillingRoute, async (c) => {
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

// ─── POST /billing/setup — Create Billing Setup Session ─────────────────────

const createBillingSetupRoute = createRoute({
  method: 'post',
  path: '/billing/setup',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Create billing setup session',
  description: 'Creates a Stripe Checkout Session in setup mode to add a payment method.',
  responses: {
    200: {
      description: 'Checkout URL',
      content: { 'application/json': { schema: BillingSetupResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    503: { description: 'Service Unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-expect-error — handler returns multiple shapes (error + success); spec types are correctly declared above
accountApp.openapi(createBillingSetupRoute, async (c) => {
  const userId = c.get('userId');

  if (!stripeClient.isConfigured()) {
    return c.json({ error: true, message: 'Stripe not configured', status: 503 }, 503);
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return c.json({ error: true, message: 'User not found', status: 404 }, 404);

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
    return c.json({ error: true, message: 'Failed to create setup session', status: 500 }, 500);
  }
});

// ─── GET /limits — Get Account Limits ───────────────────────────────────────

const getAccountLimitsRoute = createRoute({
  method: 'get',
  path: '/limits',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get account limits',
  description: 'Returns the resource limits and current usage for the authenticated user.',
  responses: {
    200: {
      description: 'Account limits and usage',
      content: { 'application/json': { schema: AccountLimitsResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-expect-error — handler returns multiple shapes (error + success); spec types are correctly declared above
accountApp.openapi(getAccountLimitsRoute, async (c) => {
  const userId = c.get('userId');

  try {
    const [limits, machineCount, imageCount] = await Promise.all([
      getAccountLimits(userId),
      countActiveMachines(userId),
      countActiveImages(userId),
    ]);

    return c.json({
      limits: {
        max_machines: limits.maxMachines,
        max_images: limits.maxImages,
      },
      usage: {
        machines: machineCount,
        images: imageCount,
      },
    });
  } catch (err) {
    console.error('[ACCOUNT] Error fetching limits:', err);
    return c.json({ error: true, message: 'Failed to fetch account limits', status: 500 }, 500);
  }
});
