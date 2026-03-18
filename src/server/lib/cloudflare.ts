/**
 * Cloudflare client — KV operations for the proxy Worker.
 *
 * DNS is handled by a single wildcard record (*.kortix.cloud → proxied).
 * The CF Worker reads machine:{slug} from KV to route requests to the correct VPS IP.
 * No per-machine DNS records are created — only KV entries.
 */

import { config } from './config';

const CF_API = 'https://api.cloudflare.com/client/v4';

async function cfFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'X-Auth-Key': config.CLOUDFLARE_API_KEY,
      'X-Auth-Email': config.CLOUDFLARE_EMAIL,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cloudflare API ${options.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

export const cloudflareClient = {
  /**
   * Create DNS records for a machine.
   * Two records per machine:
   *   - slug.kortix.cloud → VPS IP (grey cloud) — Worker route intercepts for auth
   *   - origin.slug.kortix.cloud → VPS IP (grey cloud) — Worker fetches this for origin access
   */
  async createDNSRecords(slug: string, ip: string): Promise<void> {
    const zoneId = config.CLOUDFLARE_ZONE_ID;
    const domain = config.PROXY_DOMAIN;

    // slug.kortix.cloud → proxied (orange cloud) — Worker route intercepts, CF handles TLS
    // origin.slug.kortix.cloud → NOT proxied (grey cloud) — Worker fetches this for origin access
    const records = [
      { name: `${slug}.${domain}`, proxied: true },
      { name: `origin.${slug}.${domain}`, proxied: false },
    ];

    for (const rec of records) {
      // Delete existing first (prevents stale records)
      try {
        const existing = await cfFetch<{ result: Array<{ id: string }> }>(
          `/zones/${zoneId}/dns_records?name=${rec.name}&type=A`,
        );
        for (const record of existing.result) {
          await cfFetch(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
        }
      } catch {}

      await cfFetch(`/zones/${zoneId}/dns_records`, {
        method: 'POST',
        body: { type: 'A', name: rec.name, content: ip, proxied: rec.proxied, ttl: 1 },
      });
    }

    console.log(`[CF DNS] Created ${slug}.${domain} + origin.${slug}.${domain} → ${ip}`);
  },

  /**
   * Delete DNS records for a machine.
   */
  async deleteDNSRecords(slug: string): Promise<void> {
    const zoneId = config.CLOUDFLARE_ZONE_ID;
    const domain = config.PROXY_DOMAIN;

    for (const name of [`${slug}.${domain}`, `origin.${slug}.${domain}`]) {
      try {
        const existing = await cfFetch<{ result: Array<{ id: string }> }>(
          `/zones/${zoneId}/dns_records?name=${name}&type=A`,
        );
        for (const record of existing.result) {
          await cfFetch(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
        }
      } catch {}
    }

    console.log(`[CF DNS] Deleted DNS for ${slug}`);
  },

  /**
   * Write machine info to CF KV — used by the proxy Worker for routing + auth.
   * KV key: machine:{slug} → { owner_id, ip, status, server_type }
   *
   * The Worker reads this to:
   *   1. Validate machine ownership
   *   2. Check machine status
   */
  async writeKVMachine(slug: string, data: {
    owner_id: string;
    ip: string;
    status: string;
    server_type: string;
  }): Promise<void> {
    if (!config.CLOUDFLARE_ACCOUNT_ID) return;
    const kvNamespaceId = process.env.CF_KV_NAMESPACE_ID;
    if (!kvNamespaceId) return;

    await cfFetch(
      `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/machine:${slug}`,
      { method: 'PUT', body: data },
    );
    console.log(`[CF KV] Wrote machine:${slug} → ${data.ip}`);
  },

  /**
   * Update machine status in KV (e.g. provisioning → ready).
   */
  async updateKVMachineStatus(slug: string, status: string): Promise<void> {
    if (!config.CLOUDFLARE_ACCOUNT_ID) return;
    const kvNamespaceId = process.env.CF_KV_NAMESPACE_ID;
    if (!kvNamespaceId) return;

    // Read current, update status, write back
    try {
      const current = await cfFetch<string>(
        `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/machine:${slug}`,
      );
      const data = typeof current === 'string' ? JSON.parse(current) : current;
      data.status = status;
      await cfFetch(
        `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/machine:${slug}`,
        { method: 'PUT', body: data },
      );
      console.log(`[CF KV] Updated machine:${slug} status → ${status}`);
    } catch (err) {
      console.warn(`[CF KV] Failed to update status for machine:${slug}:`, err);
    }
  },

  /**
   * Delete machine from CF KV on destroy.
   */
  async deleteKVMachine(slug: string): Promise<void> {
    if (!config.CLOUDFLARE_ACCOUNT_ID) return;
    const kvNamespaceId = process.env.CF_KV_NAMESPACE_ID;
    if (!kvNamespaceId) return;

    await cfFetch(
      `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/machine:${slug}`,
      { method: 'DELETE' },
    ).catch(() => {});
    console.log(`[CF KV] Deleted machine:${slug}`);
  },
};
