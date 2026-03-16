/**
 * Cloudflare API client — DNS record management + KV operations.
 */

import { config } from './config';

const CF_API = 'https://api.cloudflare.com/client/v4';

async function cfFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const cfEmail = process.env.CLOUDFLARE_EMAIL || '';
  const res = await fetch(`${CF_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'X-Auth-Key': config.CLOUDFLARE_API_KEY,
      'X-Auth-Email': cfEmail,
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

// DNS record ID cache: slug → record_id
const dnsRecordCache = new Map<string, string>();

export const cloudflareClient = {
  /**
   * Create a DNS A record for a machine: {slug}.kortix.cloud → VPS IP
   * Proxied through Cloudflare (orange cloud).
   */
  async createDNSRecord(slug: string, ip: string): Promise<void> {
    const zoneId = config.CLOUDFLARE_ZONE_ID;
    const domain = config.PROXY_DOMAIN;

    const result = await cfFetch<{ result: { id: string } }>(
      `/zones/${zoneId}/dns_records`,
      {
        method: 'POST',
        body: {
          type: 'A',
          name: `${slug}.${domain}`,
          content: ip,
          proxied: false, // direct A record — no CF proxy for v1
          ttl: 1, // auto
        },
      },
    );

    dnsRecordCache.set(slug, result.result.id);
    console.log(`[CF] Created DNS: ${slug}.${domain} → ${ip}`);
  },

  /**
   * Create a wildcard DNS record for port proxying: *.{slug}.kortix.cloud → VPS IP
   */
  async createWildcardDNSRecord(slug: string, ip: string): Promise<void> {
    const zoneId = config.CLOUDFLARE_ZONE_ID;
    const domain = config.PROXY_DOMAIN;

    await cfFetch(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: {
        type: 'A',
        name: `*.${slug}.${domain}`,
        content: ip,
        proxied: false,
        ttl: 1,
      },
    });

    console.log(`[CF] Created wildcard DNS: *.${slug}.${domain} → ${ip}`);
  },

  /**
   * Delete DNS records for a machine slug.
   */
  async deleteDNSRecord(slug: string): Promise<void> {
    const zoneId = config.CLOUDFLARE_ZONE_ID;
    const domain = config.PROXY_DOMAIN;

    // Find records matching this slug
    const result = await cfFetch<{ result: Array<{ id: string; name: string }> }>(
      `/zones/${zoneId}/dns_records?name=${slug}.${domain}`,
    );

    for (const record of result.result) {
      await cfFetch(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
      console.log(`[CF] Deleted DNS: ${record.name}`);
    }

    // Also delete wildcard
    const wildcardResult = await cfFetch<{ result: Array<{ id: string; name: string }> }>(
      `/zones/${zoneId}/dns_records?name=*.${slug}.${domain}`,
    );

    for (const record of wildcardResult.result) {
      await cfFetch(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
      console.log(`[CF] Deleted wildcard DNS: ${record.name}`);
    }

    dnsRecordCache.delete(slug);
  },

  /**
   * Update a DNS record's IP (e.g. after resize).
   */
  async updateDNSRecord(slug: string, ip: string): Promise<void> {
    const zoneId = config.CLOUDFLARE_ZONE_ID;
    const domain = config.PROXY_DOMAIN;
    const result = await cfFetch<{ result: Array<{ id: string }> }>(
      `/zones/${zoneId}/dns_records?name=${slug}.${domain}`,
    );
    if (result.result.length > 0) {
      await cfFetch(`/zones/${zoneId}/dns_records/${result.result[0].id}`, {
        method: 'PATCH',
        body: { content: ip },
      });
      console.log(`[CF] Updated DNS: ${slug}.${domain} → ${ip}`);
    }
  },

  /**
   * Write machine info to CF KV — used by the proxy Worker for auth/routing.
   * KV key: machine:{slug} → { owner_id, ip, status, server_type }
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
      { method: 'PUT', body: JSON.stringify(data) },
    );
    console.log(`[CF KV] Wrote machine:${slug}`);
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
