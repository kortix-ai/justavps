import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { listPlanOfferings, listPublicRegions } from '../../lib/offerings';
import { handleRouteError } from '../../lib/route-helpers';

export const catalogV2App = new OpenAPIHono();

const PlanOfferingSchema = z.object({
  plan: z.string(),
  label: z.string(),
  tagline: z.string(),
  vcpu: z.number(),
  ram_gb: z.number(),
  disk_gb: z.number(),
  traffic: z.string(),
  price_monthly: z.number(),
  features: z.object({
    persistence: z.literal('persistent'),
    runtime: z.literal('agent-computer'),
    snapshots: z.boolean(),
    backups: z.boolean(),
  }),
});

const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  city: z.string(),
});

catalogV2App.openapi(createRoute({
  method: 'get',
  path: '/plans',
  tags: ['Catalog V2'],
  summary: 'List public plan offerings',
  request: {
    query: z.object({
      region: z.string().openapi({ description: 'Region id, e.g. fsn1' }),
    }),
  },
  responses: {
    200: {
      description: 'Public plan offerings',
      content: { 'application/json': { schema: z.object({ region: z.string(), plans: z.array(PlanOfferingSchema) }) } },
    },
  },
}), async (c) => {
  try {
    const { region } = c.req.valid('query');
    const plans = listPlanOfferings(region).map((plan) => ({
      plan: plan.plan,
      label: plan.label,
      tagline: plan.tagline,
      vcpu: plan.vcpu,
      ram_gb: plan.ramGb,
      disk_gb: plan.diskGb,
      traffic: plan.traffic,
      price_monthly: plan.priceMonthly,
      features: plan.features,
    }));
    return c.json({ region, plans });
  } catch (err) {
    return handleRouteError(c, err, 'CATALOG-V2');
  }
});

catalogV2App.openapi(createRoute({
  method: 'get',
  path: '/regions',
  tags: ['Catalog V2'],
  summary: 'List public regions',
  responses: {
    200: {
      description: 'Public regions',
      content: { 'application/json': { schema: z.object({ regions: z.array(RegionSchema) }) } },
    },
  },
}), async (c) => {
  try {
    return c.json({ regions: listPublicRegions() });
  } catch (err) {
    return handleRouteError(c, err, 'CATALOG-V2');
  }
});
