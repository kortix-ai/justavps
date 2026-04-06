/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { handleRouteError } from '../../lib/route-helpers';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { db } from '../../db';
import { baremetalHosts } from '../../db/schema';
import { regionDisplay } from '@/lib/utils';
import { RESOURCE_RATES, RECOMMENDATIONS, RESOURCE_LIMITS, computeMonthlyPrice } from '@/lib/v2-pricing';
import { listPublicRegions } from '../../lib/offerings';

export const catalogV2App = new OpenAPIHono<{ Variables: AuthVariables }>();

// ── Pricing rates ──────────────────────────────────────────────────────────

// @ts-expect-error mixed response typing
catalogV2App.openapi(createRoute({
  method: 'get',
  path: '/pricing',
  tags: ['Catalog V2'],
  summary: 'Resource pricing rates',
  description: 'Returns per-resource monthly rates. Use these to compute the price for any custom configuration.',
  responses: {
    200: {
      description: 'Pricing rates and resource limits',
      content: { 'application/json': { schema: z.object({
        rates: z.object({
          vcpu_monthly: z.number(),
          ram_gb_monthly: z.number(),
          disk_gb_monthly: z.number(),
        }),
        limits: z.object({
          vcpu: z.object({ min: z.number(), max: z.number(), step: z.number() }),
          ram_gb: z.object({ min: z.number(), max: z.number(), step: z.number() }),
          disk_gb: z.object({ min: z.number(), max: z.number(), step: z.number() }),
        }),
      }) } },
    },
  },
}), async (c) => {
  return c.json({ rates: RESOURCE_RATES, limits: RESOURCE_LIMITS });
});

// ── Recommendations (UI shortcuts, not backend entities) ───────────────────

// @ts-expect-error mixed response typing
catalogV2App.openapi(createRoute({
  method: 'get',
  path: '/recommendations',
  tags: ['Catalog V2'],
  summary: 'Preset machine size recommendations',
  description: 'UI-only size presets that pre-fill resource sliders. Not required for machine creation.',
  responses: {
    200: {
      description: 'Recommendations with computed prices',
      content: { 'application/json': { schema: z.object({
        recommendations: z.array(z.object({
          label: z.string(),
          tagline: z.string(),
          vcpu: z.number(),
          ram_gb: z.number(),
          disk_gb: z.number(),
          price_monthly: z.number(),
          popular: z.boolean().optional(),
        })),
      }) } },
    },
  },
}), async (c) => {
  const recs = RECOMMENDATIONS.map((r) => ({
    ...r,
    price_monthly: computeMonthlyPrice(r.vcpu, r.ram_gb, r.disk_gb),
  }));
  return c.json({ recommendations: recs });
});

// ── Regions ────────────────────────────────────────────────────────────────

// @ts-expect-error mixed response typing
catalogV2App.openapi(createRoute({
  method: 'get',
  path: '/regions',
  tags: ['Catalog V2'],
  summary: 'List public regions',
  responses: {
    200: {
      description: 'Public regions',
      content: { 'application/json': { schema: z.object({ regions: z.array(z.object({
        id: z.string(),
        name: z.string(),
        country: z.string(),
        city: z.string(),
      })) }) } },
    },
  },
}), async (c) => {
  try {
    return c.json({ regions: listPublicRegions() });
  } catch (err) {
    return handleRouteError(c, err, 'CATALOG-V2') as Response;
  }
});

// ── Available hosts with live capacity ─────────────────────────────────────

catalogV2App.use('/hosts', apiGuard);

// @ts-expect-error mixed response typing
catalogV2App.openapi(createRoute({
  method: 'get',
  path: '/hosts',
  tags: ['Catalog V2'],
  security: [{ Bearer: [] }],
  summary: 'List available hosts with free capacity',
  description: 'Returns active baremetal hosts with real-time free capacity for the resource sliders.',
  responses: {
    200: {
      description: 'Available hosts',
      content: { 'application/json': { schema: z.object({ hosts: z.array(z.object({
        id: z.string(),
        name: z.string(),
        region: z.string(),
        location: z.string(),
        location_label: z.string(),
        public_ipv4: z.string().nullable(),
        status: z.string(),
        capacity: z.object({
          total_vcpu: z.number(),
          used_vcpu: z.number(),
          free_vcpu: z.number(),
          total_memory_gb: z.number(),
          used_memory_gb: z.number(),
          free_memory_gb: z.number(),
          total_disk_gb: z.number(),
          used_disk_gb: z.number(),
          free_disk_gb: z.number(),
        }),
      })) }) } },
    },
  },
}), async (c) => {
  try {
    const rows = await db.select().from(baremetalHosts);
    const hosts = rows
      .filter((row) => row.status === 'active')
      .map((row) => {
        const totalVcpu = row.totalVcpu ?? 0;
        const totalMem = row.totalMemoryGb ?? 0;
        const totalDisk = row.totalDiskGb ?? 0;
        const usedVcpu = row.usedVcpu ?? 0;
        const usedMem = row.usedMemoryGb ?? 0;
        const usedDisk = row.usedDiskGb ?? 0;
        const rd = regionDisplay(row.region);
        return {
          id: row.id,
          name: row.name,
          region: row.region,
          location: row.location ?? row.region.toUpperCase(),
          location_label: rd.label,
          public_ipv4: row.publicIpv4,
          status: row.status,
          capacity: {
            total_vcpu: totalVcpu,
            used_vcpu: usedVcpu,
            free_vcpu: totalVcpu - usedVcpu,
            total_memory_gb: totalMem,
            used_memory_gb: usedMem,
            free_memory_gb: totalMem - usedMem,
            total_disk_gb: totalDisk,
            used_disk_gb: usedDisk,
            free_disk_gb: totalDisk - usedDisk,
          },
        };
      });
    return c.json({ hosts });
  } catch (err) {
    return handleRouteError(c, err, 'CATALOG-V2') as Response;
  }
});
