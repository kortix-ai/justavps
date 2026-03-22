import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { machines } from '../../db/schema';
import { cloudflareClient } from '../../lib/cloudflare';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { config } from '../../lib/config';
import { errorResponse } from '../../lib/route-helpers';

export const adminRoutingApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminRoutingApp.use('*', apiGuard);

type MachineRow = typeof machines.$inferSelect;

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
}

function readProviderMeta(machine: MachineRow): Record<string, unknown> {
  return (machine.providerMeta ?? {}) as Record<string, unknown>;
}

function inferAddresses(machine: MachineRow): { ipv4?: string | null; ipv6?: string | null } {
  const meta = readProviderMeta(machine);
  const metaIpv4 = typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null;
  const metaIpv6 = typeof meta.public_ipv6 === 'string' ? meta.public_ipv6 : null;

  if (metaIpv4 || metaIpv6) {
    return { ipv4: metaIpv4, ipv6: metaIpv6 };
  }

  if (!machine.ip) return {};
  return machine.ip.includes(':') ? { ipv6: machine.ip } : { ipv4: machine.ip };
}

function primaryIp(machine: MachineRow, addresses: { ipv4?: string | null; ipv6?: string | null }): string | null {
  return machine.ip ?? addresses.ipv4 ?? addresses.ipv6 ?? null;
}

function buildMachineKV(machine: MachineRow, ip: string) {
  return {
    machine_id: machine.id,
    owner_id: machine.ownerId,
    ip,
    status: machine.status,
    server_type: machine.serverType,
  };
}

function extractMachineSlug(recordName: string): string | null {
  const domain = config.PROXY_DOMAIN;
  let hostname = recordName;
  if (hostname.startsWith('*.')) hostname = hostname.slice(2);
  if (!hostname.endsWith(`.${domain}`)) return null;
  if (config.BROKER_HOST && hostname === config.BROKER_HOST) return null;
  if (hostname === `broker-origin.${domain}`) return null;
  let slug = hostname.slice(0, -(domain.length + 1));
  if (slug === 'broker-origin') return null;
  if (slug.startsWith('origin-')) slug = slug.slice('origin-'.length);
  if (slug.startsWith('origin.')) slug = slug.slice('origin.'.length);
  if (!slug || slug === '*' || slug === domain || slug === 'broker') return null;
  return slug;
}

async function listAllMachines() {
  return db.select().from(machines);
}

async function scanRoutingState() {
  const rows = await listAllMachines();
  const kvKeys = await cloudflareClient.listKVMachineKeys();
  const allProxyDnsRecords = await cloudflareClient.listProxyDomainDNSRecords();
  const workerRoutes = await cloudflareClient.listWorkerRoutes();
  const kvKeySet = new Set(kvKeys);
  const activeSlugs = new Set(rows.filter((row) => row.status !== 'deleted').map((row) => row.slug));
  const knownSlugs = new Set(rows.map((row) => row.slug));
  const dnsByName = new Map<string, typeof allProxyDnsRecords>();

  for (const record of allProxyDnsRecords) {
    const list = dnsByName.get(record.name) ?? [];
    list.push(record);
    dnsByName.set(record.name, list);
  }

  const machineStates = rows.map((machine) => {
    const addresses = inferAddresses(machine);
    const ip = primaryIp(machine, addresses);
    const hostname = `${machine.slug}.${config.PROXY_DOMAIN}`;
    const wildcardHostname = `*.${hostname}`;
    const originHostname = `origin-${machine.slug}.${config.PROXY_DOMAIN}`;
    const legacyOriginHostname = `origin.${hostname}`;
    const publicRecords = dnsByName.get(hostname) ?? [];
    const wildcardRecords = dnsByName.get(wildcardHostname) ?? [];
    const originRecords = dnsByName.get(originHostname) ?? [];
    const legacyOriginRecords = dnsByName.get(legacyOriginHostname) ?? [];
    const kvPresent = kvKeySet.has(`machine:${machine.slug}`);
    const machineDnsCount = originRecords.length + publicRecords.length + wildcardRecords.length + legacyOriginRecords.length;
    const drift: string[] = [];

    if (machine.status !== 'deleted') {
      if (!kvPresent) drift.push('missing_kv');
      if (machineDnsCount) drift.push('legacy_machine_dns_present');
      if (!ip) drift.push('missing_ip');
    } else {
      if (kvPresent) drift.push('deleted_machine_kv_present');
      if (machineDnsCount) drift.push('deleted_machine_dns_present');
    }

    return {
      id: machine.id,
      slug: machine.slug,
      status: machine.status,
      owner_id: machine.ownerId,
      ip,
      kv_present: kvPresent,
      machine_dns_count: machineDnsCount,
      public_record_names: publicRecords.map((record) => record.name),
      wildcard_record_names: wildcardRecords.map((record) => record.name),
      origin_record_names: originRecords.map((record) => record.name),
      legacy_origin_record_names: legacyOriginRecords.map((record) => record.name),
      drift,
    };
  });

  const staleKv = kvKeys
    .filter((key) => {
      const slug = key.replace(/^machine:/, '');
      return !activeSlugs.has(slug);
    })
    .map((key) => ({ key, slug: key.replace(/^machine:/, ''), reason: 'missing_or_deleted_machine' }));

  const stalePublicDns = Array.from(new Set(
    allProxyDnsRecords
      .map((record) => extractMachineSlug(record.name))
      .filter((slug): slug is string => !!slug && !knownSlugs.has(slug)),
  )).map((slug) => ({ slug, reason: 'missing_machine_record' }));

  const brokerHost = config.BROKER_HOST;
  const brokerDNSPresent = brokerHost ? (dnsByName.get(brokerHost)?.length ?? 0) > 0 : false;
  const brokerBypassPattern = brokerHost ? `${brokerHost}/*` : '';
  const brokerBypassRoutePresent = brokerBypassPattern
    ? workerRoutes.some((route) => route.pattern === brokerBypassPattern && !route.script)
    : false;

  return {
    summary: {
      total: machineStates.length,
      active: machineStates.filter((machine) => machine.status !== 'deleted').length,
      deleted: machineStates.filter((machine) => machine.status === 'deleted').length,
      drifted: machineStates.filter((machine) => machine.drift.length > 0).length,
      missing_kv: machineStates.filter((machine) => machine.drift.includes('missing_kv')).length,
      legacy_machine_dns: machineStates.filter((machine) => machine.drift.includes('legacy_machine_dns_present')).length,
      stale_kv_keys: staleKv.length,
      stale_public_dns: stalePublicDns.length,
      broker_dns_present: brokerDNSPresent,
      broker_bypass_route_present: brokerBypassRoutePresent,
    },
    machines: machineStates,
    stale_kv: staleKv,
    stale_public_dns: stalePublicDns,
    broker: {
      host: brokerHost,
      dns_present: brokerDNSPresent,
      bypass_route_present: brokerBypassRoutePresent,
      bypass_pattern: brokerBypassPattern,
    },
  };
}

async function repairMachineRouting(machine: MachineRow) {
  const addresses = inferAddresses(machine);
  const ip = primaryIp(machine, addresses);
  const actions: string[] = [];
  const warnings: string[] = [];

  if (machine.status === 'deleted') {
    await cloudflareClient.removeMachineDNS(machine.slug);
    await cloudflareClient.deleteKVMachine(machine.slug);
    actions.push('removed_machine_dns', 'removed_machine_kv');
    return { slug: machine.slug, status: machine.status, actions, warnings };
  }

  if (ip) {
    await cloudflareClient.writeKVMachine(machine.slug, buildMachineKV(machine, ip));
    actions.push('synced_machine_kv');
  } else {
    warnings.push('missing_ip_for_machine_kv');
  }

  await cloudflareClient.removeMachineDNS(machine.slug);
  actions.push('removed_machine_dns');

  return { slug: machine.slug, status: machine.status, actions, warnings };
}

async function parseBatchLimit(c: Context<{ Variables: AuthVariables }>, fallback: number): Promise<number> {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ limit: z.number().int().min(1).max(100).optional() }).safeParse(body);
  return parsed.success ? (parsed.data.limit ?? fallback) : fallback;
}

adminRoutingApp.get('/scan', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const result = await scanRoutingState();
  return c.json(result);
});

adminRoutingApp.post('/backfill', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const limit = await parseBatchLimit(c, 10);
  const rows = (await listAllMachines()).filter((machine) => machine.status !== 'deleted');
  const batch = rows.slice(0, limit);
  const results = [];
  for (const machine of batch) {
    results.push(await repairMachineRouting(machine));
  }

  return c.json({ ok: true, count: results.length, remaining: Math.max(0, rows.length - batch.length), results });
});

adminRoutingApp.post('/cleanup-legacy-dns', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const limit = await parseBatchLimit(c, 25);
  const rows = (await listAllMachines()).filter((machine) => machine.status !== 'deleted');
  const batch = rows.slice(0, limit);
  const results = [];
  for (const machine of batch) {
    await cloudflareClient.removeLegacyMachinePublicDNS(machine.slug);
    results.push({ slug: machine.slug, actions: ['removed_legacy_public_dns'] });
  }

  return c.json({ ok: true, count: results.length, remaining: Math.max(0, rows.length - batch.length), results });
});

adminRoutingApp.post('/prune-stale-kv', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const limit = await parseBatchLimit(c, 100);
  const rows = await listAllMachines();
  const liveSlugs = new Set(rows.filter((machine) => machine.status !== 'deleted').map((machine) => machine.slug));
  const kvKeys = await cloudflareClient.listKVMachineKeys();
  const stale = kvKeys.filter((key) => !liveSlugs.has(key.replace(/^machine:/, '')));
  const batch = stale.slice(0, limit);

  for (const key of batch) {
    await cloudflareClient.deleteKVKey(key);
  }

  return c.json({
    ok: true,
    count: batch.length,
    remaining: Math.max(0, stale.length - batch.length),
    results: batch.map((key) => ({ key, slug: key.replace(/^machine:/, ''), action: 'deleted_kv_key' })),
  });
});

adminRoutingApp.post('/cleanup-stale-public-dns', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const limit = await parseBatchLimit(c, 25);
  const rows = await listAllMachines();
  const knownSlugs = new Set(rows.map((machine) => machine.slug));
  const allProxyDnsRecords = await cloudflareClient.listProxyDomainDNSRecords();
  const staleSlugs = Array.from(new Set(
    allProxyDnsRecords
      .map((record) => extractMachineSlug(record.name))
      .filter((slug): slug is string => !!slug && !knownSlugs.has(slug)),
  ));
  const batch = staleSlugs.slice(0, limit);

  for (const slug of batch) {
    await cloudflareClient.removeLegacyMachinePublicDNS(slug);
  }

  return c.json({
    ok: true,
    count: batch.length,
    remaining: Math.max(0, staleSlugs.length - batch.length),
    results: batch.map((slug) => ({ slug, action: 'removed_stale_public_dns' })),
  });
});

adminRoutingApp.post('/repair-machine', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ slug: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, 'slug is required');
  }

  const [machine] = await db.select().from(machines).where(eq(machines.slug, parsed.data.slug)).limit(1);
  if (!machine) {
    return errorResponse(c, 404, 'Machine not found');
  }

  const result = await repairMachineRouting(machine);
  return c.json({ ok: true, result });
});

adminRoutingApp.post('/remove-machine-legacy-dns', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ slug: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, 'slug is required');
  }

  const [machine] = await db.select({ slug: machines.slug }).from(machines).where(eq(machines.slug, parsed.data.slug)).limit(1);
  if (!machine) {
    return errorResponse(c, 404, 'Machine not found');
  }

  await cloudflareClient.removeLegacyMachinePublicDNS(machine.slug);
  return c.json({ ok: true, result: { slug: machine.slug, action: 'removed_legacy_public_dns' } });
});
