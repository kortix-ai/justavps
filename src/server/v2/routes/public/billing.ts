import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { getBillingComparisonV2, getBillingOverviewV2 } from "@/server/v2/services/billing";
import { handleRouteError } from "@/server/core/route-helpers";

export const billingV2App = new OpenAPIHono<{ Variables: AuthVariables }>();
billingV2App.use('*', apiGuard);

billingV2App.openapi(createRoute({
  method: 'get',
  path: '/overview',
  tags: ['Billing V2'],
  summary: 'Get billing overview',
  responses: {
    200: { description: 'Billing overview', content: { 'application/json': { schema: z.object({
      modes: z.array(z.object({ id: z.string(), available: z.boolean(), default: z.boolean(), description: z.string() })),
      current_period: z.object({ machines: z.number(), estimated_cost: z.number() }),
      usage: z.object({ compute_seconds: z.number(), storage_gb_seconds: z.number() }),
      plans: z.array(z.object({ id: z.string(), price_monthly: z.number() })),
    }) } } },
  },
}), (async (c: unknown) => {
  const ctx = c as { get: (key: string) => string; json: (body: unknown) => Response };
  try {
    return ctx.json(await getBillingOverviewV2({ accountId: ctx.get('accountId') }));
  } catch (err) {
    return handleRouteError(c as never, err, 'BILLING-V2') as Response;
  }
}) as never);

billingV2App.openapi(createRoute({
  method: 'get',
  path: '/compare',
  tags: ['Billing V2'],
  summary: 'Compare JustAVPS monthly pricing to competitor monthly equivalents',
  request: { query: z.object({ plan: z.string(), hours_per_day: z.coerce.number().min(0).max(24).default(24) }) },
  responses: {
    200: { description: 'Comparison', content: { 'application/json': { schema: z.object({
      plan: z.string(),
      monthly_price: z.number(),
      hours_per_day: z.number(),
      competitors: z.object({ e2b_monthly_equivalent: z.number(), daytona_monthly_equivalent: z.number() }),
    }) } } },
  },
}), (async (c: unknown) => {
  const ctx = c as { req: { valid: (target: 'query') => { plan: string; hours_per_day: number } }; json: (body: unknown) => Response };
  try {
    const { plan, hours_per_day } = ctx.req.valid('query');
    return ctx.json(await getBillingComparisonV2({ plan, hoursPerDay: hours_per_day }));
  } catch (err) {
    return handleRouteError(c as never, err, 'BILLING-V2') as Response;
  }
}) as never);
