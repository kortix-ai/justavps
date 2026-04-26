import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { listCustomerVisibleProviders } from "@/server/platform/providers/index";
import { requireProvider, handleRouteError } from "@/server/core/route-helpers";
import {
  ServerTypeListResponseSchema,
  ProviderListResponseSchema,
  RegionListResponseSchema,
  ErrorResponseSchema,
} from '@/shared/lib/schemas';

export const serverTypesApp = new OpenAPIHono();

const listProvidersRoute = createRoute({
  method: 'get',
  path: '/providers',
  tags: ['Server Types'],
  summary: 'List providers',
  responses: {
    200: {
      description: 'Available providers',
      content: { 'application/json': { schema: ProviderListResponseSchema } },
    },
  },
});

serverTypesApp.openapi(listProvidersRoute, async (c) => c.json({ providers: listCustomerVisibleProviders() }));

const listServerTypesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Server Types'],
  summary: 'List server types',
  description: 'Returns available server types for a provider + region, with pricing.',
  request: {
    query: z.object({
      provider: z.string().default('cloud').openapi({ description: 'Cloud provider' }),
      region: z.string().openapi({ description: 'Region ID (e.g. eu, us)' }),
    }),
  },
  responses: {
    200: { description: 'Available server types', content: { 'application/json': { schema: ServerTypeListResponseSchema } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

serverTypesApp.openapi(listServerTypesRoute, (async (c: unknown) => {
  const ctx = c as {
    req: { valid: (target: 'query') => { provider: string; region: string } };
    json: (body: unknown) => Response;
  };
  const honoContext = c as Parameters<typeof requireProvider>[0];
  const { provider: providerName, region } = ctx.req.valid('query');
  const lookup = requireProvider(honoContext, providerName);
  if (lookup.response) return lookup.response as Response;
  try {
    const types = await lookup.provider.listServerTypes(region);
    return ctx.json({
      provider: providerName,
      region,
      server_types: types.map((t: Awaited<ReturnType<typeof lookup.provider.listServerTypes>>[number]) => ({
        name: t.name,
        description: t.description,
        vcpu: t.cores,
        ram_gb: t.memory,
        disk_gb: t.disk,
        cpu_type: t.cpuType as 'shared' | 'dedicated',
        architecture: t.architecture as 'x86' | 'arm',
        price_monthly: t.priceMonthly,
        provider_price_monthly: t.providerPriceMonthly,
        backup_price_monthly: t.backupPriceMonthly,
        available: true,
      })),
    });
  } catch (err) {
    return handleRouteError(honoContext, err, 'SERVER-TYPES') as Response;
  }
}) as never);

const listRegionsRoute = createRoute({
  method: 'get',
  path: '/regions',
  tags: ['Server Types'],
  summary: 'List regions',
  request: { query: z.object({ provider: z.string().default('cloud').openapi({ description: 'Cloud provider' }) }) },
  responses: {
    200: { description: 'Available regions', content: { 'application/json': { schema: RegionListResponseSchema } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

serverTypesApp.openapi(listRegionsRoute, (async (c: unknown) => {
  const ctx = c as {
    req: { valid: (target: 'query') => { provider: string } };
    json: (body: unknown) => Response;
  };
  const honoContext = c as Parameters<typeof requireProvider>[0];
  const { provider: providerName } = ctx.req.valid('query');
  const lookup = requireProvider(honoContext, providerName);
  if (lookup.response) return lookup.response as Response;
  try {
    const regions = await lookup.provider.listRegions();
    return ctx.json({ provider: providerName, regions });
  } catch (err) {
    return handleRouteError(honoContext, err, 'REGIONS') as Response;
  }
}) as never);
