/**
 * Server types + provider discovery routes.
 * Provider-agnostic — fetches types/regions from whichever provider is requested.
 */

import { Hono } from 'hono';
import { listProviders } from '../../lib/providers';
import { requireProvider, handleRouteError } from '../../lib/route-helpers';

export const serverTypesApp = new Hono();

// ─── GET /providers — List available providers ─────────────────────────────

serverTypesApp.get('/providers', async (c) => {
  return c.json({ providers: listProviders() });
});

// ─── GET / — List server types for a provider + region ─────────────────────

serverTypesApp.get('/', async (c) => {
  const providerName = c.req.query('provider') || 'hetzner';
  const region = c.req.query('region');

  const lookup = requireProvider(c, providerName);
  if (lookup.response) return lookup.response;

  if (!region) {
    return c.json({ error: true, message: 'region query param is required', status: 400 }, 400);
  }

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
        cpu_type: t.cpuType,
        architecture: t.architecture,
        price_monthly: t.priceMonthly,
        provider_price_monthly: t.providerPriceMonthly,
        available: true,
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'SERVER-TYPES');
  }
});

// ─── GET /regions — List regions for a provider ────────────────────────────

serverTypesApp.get('/regions', async (c) => {
  const providerName = c.req.query('provider') || 'hetzner';

  const lookup = requireProvider(c, providerName);
  if (lookup.response) return lookup.response;

  try {
    const regions = await lookup.provider.listRegions();
    return c.json({ provider: providerName, regions });
  } catch (err) {
    return handleRouteError(c, err, 'REGIONS');
  }
});
