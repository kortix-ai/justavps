/**
 * Cloudflare client — broker DNS, route, and KV management.
 *
 * Architecture (wildcard Worker ingress + shared broker origin):
 *   - Public ingress is handled by fixed wildcard DNS + Worker routes
 *   - Broker traffic uses a fixed hostname that bypasses the Worker route
 *   - No per-machine DNS records should exist in steady state
 *   - Worker auth/routing metadata lives in KV under machine:{slug}
 */

import { config } from './config';

const CF_API = 'https://api.cloudflare.com/client/v4';
const MAX_CF_RETRIES = 5;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cfRequest(
  path: string,
  options: { method?: string; body?: unknown; contentType?: string } = {},
): Promise<Response> {
  let attempt = 0;

  while (true) {
    const res = await fetch(`${CF_API}${path}`, {
      method: options.method || 'GET',
      headers: {
        'X-Auth-Key': config.CLOUDFLARE_API_KEY,
        'X-Auth-Email': config.CLOUDFLARE_EMAIL,
        'Content-Type': options.contentType || 'application/json',
      },
      body: options.body
        ? (options.contentType === 'text/plain' ? String(options.body) : JSON.stringify(options.body))
        : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      return res;
    }

    const text = await res.text().catch(() => '');
    const shouldRetry = res.status === 429 || res.status >= 500;
    if (!shouldRetry || attempt >= MAX_CF_RETRIES - 1) {
      throw new Error(`Cloudflare API ${options.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }

    const retryAfter = Number.parseFloat(res.headers.get('retry-after') || '0');
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(15_000, 750 * (2 ** attempt));
    await sleep(delay);
    attempt += 1;
  }
}

async function cfFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; contentType?: string } = {},
): Promise<T> {
  const res = await cfRequest(path, options);
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export interface CloudflareDNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
}

export interface CloudflareWorkerRoute {
  id: string;
  pattern: string;
  script?: string;
}

export interface MachineRoutingKVRecord {
  machine_id: string;
  account_id: string;
  ip: string;
  origin_port?: number;
  origin_hostname?: string;
  status: string;
  server_type: string;
  platform_url?: string;
  updated_at?: string;
  routing_version?: number;
}

function machineHostnames(slug: string, domain: string) {
  const hostname = `${slug}.${domain}`;
  return {
    hostname,
    wildcardHostname: `*.${hostname}`,
    originHostname: `origin-${slug}.${domain}`,
    legacyOriginHostname: `origin.${hostname}`,
  };
}

async function listDNSRecordsForHostname(zid: string, hostname: string): Promise<CloudflareDNSRecord[]> {
  const lists = await Promise.all(
    ['CNAME', 'A', 'AAAA'].map((type) =>
      cfFetch<{ result: CloudflareDNSRecord[] }>(
        `/zones/${zid}/dns_records?name=${encodeURIComponent(hostname)}&type=${type}`,
      ).catch(() => ({ result: [] })),
    ),
  );

  return lists.flatMap((entry) => entry.result ?? []);
}

async function deleteAllDNSRecords(zid: string, hostname: string): Promise<void> {
  try {
    const existing = await listDNSRecordsForHostname(zid, hostname);
    for (const record of existing) {
      await cfFetch(`/zones/${zid}/dns_records/${record.id}`, { method: 'DELETE' });
    }
  } catch {
    /* best-effort cleanup */
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const cloudflareClient = {
  /**
   * Ensure a fixed DNS record exists.
   */
  async ensureDNSRecord(
    name: string,
    addresses: { ipv4?: string | null; ipv6?: string | null },
    proxied: boolean,
  ): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid } = config;
    if (!zid) return;

    await deleteAllDNSRecords(zid, name);

    const publish = async (type: 'A' | 'AAAA', content: string) => {
      await cfFetch(`/zones/${zid}/dns_records`, {
        method: 'POST',
        body: { type, name, content, proxied, ttl: 1 },
      });
    };

    if (addresses.ipv4) await publish('A', addresses.ipv4);
    if (addresses.ipv6) await publish('AAAA', addresses.ipv6);
  },

  /**
   * Ensure all traffic for broker host bypasses the Worker route.
   */
  async ensureWorkerBypassRoute(pattern: string): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid } = config;
    if (!zid) return;

    const routes = await cfFetch<{ result: CloudflareWorkerRoute[] }>(`/zones/${zid}/workers/routes`);
    if (routes.result.some((route) => route.pattern === pattern && !route.script)) {
      return;
    }

    await cfFetch(`/zones/${zid}/workers/routes`, {
      method: 'POST',
      body: { pattern },
    });
  },

  /**
   * List Worker routes in the current zone.
   */
  async listWorkerRoutes(): Promise<CloudflareWorkerRoute[]> {
    const { CLOUDFLARE_ZONE_ID: zid } = config;
    if (!zid) return [];
    const routes = await cfFetch<{ result: CloudflareWorkerRoute[] }>(`/zones/${zid}/workers/routes`);
    return routes.result ?? [];
  },

  /**
   * Per-machine DNS: in the broker architecture, HTTP traffic is handled by
   * the wildcard Cloudflare Worker route. But SSH requires a DIRECT (unproxied)
   * A record per machine so users never see the raw host IP.
   *
   * Creates an unproxied A/AAAA record at `origin-<slug>.<PROXY_DOMAIN>` that
   * points directly to the baremetal host. SSH NAT is handled by the Incus
   * proxy device on the host side.
   */
  async addMachineDNS(slug: string, addresses: { ipv4?: string | null; ipv6?: string | null }): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!zid) return;
    if (!addresses.ipv4 && !addresses.ipv6) return;

    const { originHostname } = machineHostnames(slug, domain);
    // Unproxied so SSH bypasses Cloudflare's HTTP-only proxy layer
    await this.ensureDNSRecord(originHostname, addresses, false);
  },

  /**
   * Remove all DNS records for a machine, including legacy public and origin artifacts.
   */
  async removeMachineDNS(slug: string): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!zid) return;

    const { hostname, wildcardHostname, originHostname, legacyOriginHostname } = machineHostnames(slug, domain);
    await deleteAllDNSRecords(zid, hostname);
    await deleteAllDNSRecords(zid, wildcardHostname);
    await deleteAllDNSRecords(zid, originHostname);
    await deleteAllDNSRecords(zid, legacyOriginHostname);
  },

  /**
   * Remove only legacy per-machine public DNS records for a machine.
   */
  async removeLegacyMachinePublicDNS(slug: string): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!zid) return;

    const { hostname, wildcardHostname, legacyOriginHostname, originHostname } = machineHostnames(slug, domain);
    await deleteAllDNSRecords(zid, hostname);
    await deleteAllDNSRecords(zid, wildcardHostname);
    await deleteAllDNSRecords(zid, legacyOriginHostname);
    await deleteAllDNSRecords(zid, originHostname);
  },

  /**
   * Inspect DNS routing artifacts for a machine.
   */
  async getMachineDNSState(slug: string): Promise<{
    hostname: string;
    wildcardHostname: string;
    originHostname: string;
    legacyOriginHostname: string;
    publicRecords: CloudflareDNSRecord[];
    wildcardRecords: CloudflareDNSRecord[];
    originRecords: CloudflareDNSRecord[];
    legacyOriginRecords: CloudflareDNSRecord[];
  }> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    const { hostname, wildcardHostname, originHostname, legacyOriginHostname } = machineHostnames(slug, domain);

    if (!zid) {
      return {
        hostname,
        wildcardHostname,
        originHostname,
        legacyOriginHostname,
        publicRecords: [],
        wildcardRecords: [],
        originRecords: [],
        legacyOriginRecords: [],
      };
    }

    const [publicRecords, wildcardRecords, originRecords, legacyOriginRecords] = await Promise.all([
      listDNSRecordsForHostname(zid, hostname),
      listDNSRecordsForHostname(zid, wildcardHostname),
      listDNSRecordsForHostname(zid, originHostname),
      listDNSRecordsForHostname(zid, legacyOriginHostname),
    ]);

    return {
      hostname,
      wildcardHostname,
      originHostname,
      legacyOriginHostname,
      publicRecords,
      wildcardRecords,
      originRecords,
      legacyOriginRecords,
    };
  },

  /**
   * List all DNS records in the proxy domain.
   */
  async listProxyDomainDNSRecords(): Promise<CloudflareDNSRecord[]> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!zid) return [];

    const records: CloudflareDNSRecord[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const result = await cfFetch<{
        result: CloudflareDNSRecord[];
        result_info?: { total_pages?: number };
      }>(`/zones/${zid}/dns_records?page=${page}&per_page=1000`);
      records.push(...(result.result ?? []).filter((record) => record.name.endsWith(domain)));
      totalPages = result.result_info?.total_pages ?? 1;
      page += 1;
    } while (page <= totalPages);

    return records;
  },

  /**
   * Write machine info to KV for Worker auth lookups.
   */
  async writeKVMachine(slug: string, data: MachineRoutingKVRecord): Promise<void> {
    const kvNs = process.env.CF_KV_NAMESPACE_ID;
    if (!config.CLOUDFLARE_ACCOUNT_ID || !kvNs) return;
    await cfFetch(
      `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNs}/values/machine:${slug}`,
      {
        method: 'PUT',
        contentType: 'application/json',
        body: {
          ...data,
          updated_at: data.updated_at ?? new Date().toISOString(),
          routing_version: data.routing_version ?? 3,
        },
      },
    );
    console.log(`[CF KV] machine:${slug} -> ${data.ip}`);
  },

  /**
   * List KV keys for machine routing records.
   */
  async listKVMachineKeys(): Promise<string[]> {
    const kvNs = process.env.CF_KV_NAMESPACE_ID;
    if (!config.CLOUDFLARE_ACCOUNT_ID || !kvNs) return [];

    const keys: string[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const result = await cfFetch<{
        result: Array<{ name: string }>;
        result_info?: { total_pages?: number };
      }>(
        `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNs}/keys?prefix=${encodeURIComponent('machine:')}&page=${page}&per_page=1000`,
      );
      keys.push(...(result.result ?? []).map((entry) => entry.name));
      totalPages = result.result_info?.total_pages ?? 1;
      page += 1;
    } while (page <= totalPages);

    return keys;
  },

  /**
   * Delete an arbitrary KV key.
   */
  async deleteKVKey(key: string): Promise<void> {
    const kvNs = process.env.CF_KV_NAMESPACE_ID;
    if (!config.CLOUDFLARE_ACCOUNT_ID || !kvNs) return;
    await cfFetch(
      `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNs}/values/${key}`,
      { method: 'DELETE' },
    ).catch(() => {});
  },

  /**
   * Delete machine from KV.
   */
  async deleteKVMachine(slug: string): Promise<void> {
    await this.deleteKVKey(`machine:${slug}`);
  },
};
