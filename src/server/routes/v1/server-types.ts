/**
 * Server types + provider discovery routes.
 * Uses @hono/zod-openapi: routes declare schemas inline → spec auto-generated.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { listProviders } from '../../lib/providers';
import { requireProvider, handleRouteError } from '../../lib/route-helpers';
import {
  ServerTypeListResponseSchema,
  ProviderListResponseSchema,
  RegionListResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const serverTypesApp = new OpenAPIHono();

// ─── GET /providers — List available providers ─────────────────────────────

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

serverTypesApp.openapi(listProvidersRoute, async (c) => {
  return c.json({ providers: listProviders() });
});

// ─── GET / — List server types ──────────────────────────────────────────────

const listServerTypesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Server Types'],
  summary: 'List server types',
  description: 'Returns available server types for a provider + region, with pricing.',
  request: {
    query: z.object({
      provider: z.string().default('cloud').openapi({ description: 'Cloud provider' }),
      region: z.string().openapi({ description: 'Region ID (e.g. hel1)' }),
    }),
  },
  responses: {
    200: {
      description: 'Available server types',
      content: { 'application/json': { schema: ServerTypeListResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

serverTypesApp.openapi(listServerTypesRoute, async (c) => {
  const { provider: providerName, region } = c.req.valid('query');

  const lookup = requireProvider(c, providerName);
  if (lookup.response) return lookup.response as any;

  try {
    const types = await lookup.provider.listServerTypes(region);

    return c.json({
      provider: providerName,
      region,
      server_types: types.map((t) => ({
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
    return handleRouteError(c, err, 'SERVER-TYPES') as any;
  }
});

// ─── GET /regions — List regions ────────────────────────────────────────────

const listRegionsRoute = createRoute({
  method: 'get',
  path: '/regions',
  tags: ['Server Types'],
  summary: 'List regions',
  request: {
    query: z.object({
      provider: z.string().default('cloud').openapi({ description: 'Cloud provider' }),
    }),
  },
  responses: {
    200: {
      description: 'Available regions',
      content: { 'application/json': { schema: RegionListResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

serverTypesApp.openapi(listRegionsRoute, async (c) => {
  const { provider: providerName } = c.req.valid('query');

  const lookup = requireProvider(c, providerName);
  if (lookup.response) return lookup.response as any;

  try {
    const regions = await lookup.provider.listRegions();
    return c.json({ provider: providerName, regions });
  } catch (err) {
    return handleRouteError(c, err, 'REGIONS') as any;
  }
});
