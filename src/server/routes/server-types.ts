import { OpenAPIHono } from '@hono/zod-openapi';
import { hetznerClient } from '../lib/hetzner';
import { ALLOWED_SERVER_TYPES, ALLOWED_REGIONS } from '@/lib/schemas';

export const serverTypesApp = new OpenAPIHono();

// GET / → List available server types (CPX shared + CCX dedicated) with pricing
serverTypesApp.get('/', async (c) => {
  const region = c.req.query('region') || 'hel1';

  // Validate region
  if (!ALLOWED_REGIONS.includes(region as any)) {
    return c.json({ error: true, message: `Invalid region: ${region}`, status: 400 }, 400);
  }

  try {
    const allTypes = await hetznerClient.listServerTypes(region);

    // Filter to allowed types (CPX shared + CCX dedicated)
    const ccxTypes = allTypes
      .filter((t) => (ALLOWED_SERVER_TYPES as readonly string[]).includes(t.name))
      .map((t) => {
        const backupCost = Math.ceil(t.priceMonthlyHetzner * 0.2 * 100) / 100;
        return {
          name: t.name,
          description: t.description,
          vcpu: t.cores,
          ram_gb: t.memory,
          disk_gb: t.disk,
          cpu_type: t.cpuType,
          architecture: t.architecture,
          price_monthly: t.priceMonthlyOurs,
          hetzner_price_monthly: t.priceMonthlyHetzner,
          backup_price_monthly: backupCost,
          available: true,
        };
      });

    return c.json({
      region,
      server_types: ccxTypes,
    });
  } catch (err) {
    console.error('[SERVER-TYPES] error:', err);
    return c.json({ error: true, message: 'Failed to fetch server types', status: 500 }, 500);
  }
});
