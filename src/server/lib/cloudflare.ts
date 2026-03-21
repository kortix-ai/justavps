/**
 * Cloudflare client — DNS AAAA records and KV management.
 *
 * Architecture (direct IP proxy — no tunnels):
 *   - Per-machine AAAA records: slug.kortix.cloud → VPS_IPv6 (proxied, orange-cloud)
 *   - Per-machine wildcard AAAA: *.slug.kortix.cloud → VPS_IPv6 (proxied, for port subdomains)
 *   - CF Worker route intercepts all requests, authenticates, proxies to VPS IP
 *   - KV stores machine info for Worker auth lookups
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

/**
 * Delete all DNS records for a hostname (any type).
 */
async function deleteAllDNSRecords(zid: string, hostname: string): Promise<void> {
  for (const type of ['CNAME', 'A', 'AAAA']) {
    try {
      const existing = await cfFetch<{ result: Array<{ id: string }> }>(
        `/zones/${zid}/dns_records?name=${hostname}&type=${type}`,
      );
      for (const r of existing.result) {
        await cfFetch(`/zones/${zid}/dns_records/${r.id}`, { method: 'DELETE' });
      }
    } catch { /* best-effort cleanup */ }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const cloudflareClient = {
  /**
   * Add DNS records for a machine: AAAA record + wildcard AAAA for port subdomains.
   *
   * Creates:
   *   slug.kortix.cloud         → AAAA → VPS_IPv6 (proxied) — triggers Worker route
   *   origin-slug.kortix.cloud  → AAAA → VPS_IPv6 (DNS-only) — Worker fetches this
   *
   * No wildcard AAAA record needed — the Worker route *.kortix.cloud/* handles
   * port subdomains (3000.slug.kortix.cloud). A wildcard AAAA would conflict with
   * the DNS-only origin record.
   *
   * The origin record uses "origin-slug" (single level) not "origin.slug" (two levels)
   * to avoid wildcard DNS precedence conflicts.
   */
  async addMachineDNS(slug: string, ip: string): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!zid) {
      console.warn(`[CF] Zone not configured — skipping DNS for ${slug}`);
      return;
    }

    const hostname = `${slug}.${domain}`;
    const origin = `origin-${slug}.${domain}`;

    // Clean up stale records (any type)
    await deleteAllDNSRecords(zid, hostname);
    await deleteAllDNSRecords(zid, `*.${hostname}`);
    await deleteAllDNSRecords(zid, origin);
    // Also clean old architecture artifacts
    await deleteAllDNSRecords(zid, `origin.${hostname}`);

    // Create AAAA record: slug.kortix.cloud → VPS_IPv6 (proxied — triggers Worker route)
    await cfFetch(`/zones/${zid}/dns_records`, {
      method: 'POST',
      body: { type: 'AAAA', name: hostname, content: ip, proxied: true, ttl: 1 },
    });
    console.log(`[CF DNS] AAAA record: ${hostname} → ${ip}`);

    // Create wildcard AAAA: *.slug.kortix.cloud → VPS_IPv6 (proxied)
    // Enables port-based subdomains: 3000.slug.kortix.cloud
    // (requires CF Worker route *.kortix.cloud/* to match — single-level wildcard)
    await cfFetch(`/zones/${zid}/dns_records`, {
      method: 'POST',
      body: { type: 'AAAA', name: `*.${hostname}`, content: ip, proxied: true, ttl: 1 },
    });
    console.log(`[CF DNS] Wildcard AAAA: *.${hostname} → ${ip}`);

    // Create origin AAAA: origin-slug.kortix.cloud → VPS_IPv6 (DNS-only, NOT proxied)
    // The CF Worker fetches this hostname to reach the VPS — bypasses CF proxy layer.
    // Workers cannot fetch raw IPs that are on CF's network (error 1003).
    await cfFetch(`/zones/${zid}/dns_records`, {
      method: 'POST',
      body: { type: 'AAAA', name: origin, content: ip, proxied: false, ttl: 1 },
    });
    console.log(`[CF DNS] Origin AAAA (DNS-only): ${origin} → ${ip}`);
  },

  /**
   * Remove all DNS records for a machine.
   */
  async removeMachineDNS(slug: string): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!zid) return;

    const hostname = `${slug}.${domain}`;
    await deleteAllDNSRecords(zid, hostname);
    await deleteAllDNSRecords(zid, `*.${hostname}`);
    await deleteAllDNSRecords(zid, `origin-${slug}.${domain}`);
    // Clean old architecture artifacts
    await deleteAllDNSRecords(zid, `origin.${hostname}`);
  },

  /**
   * Write machine info to KV for Worker auth lookups.
   */
  async writeKVMachine(slug: string, data: {
    owner_id: string;
    ip: string;
    origin_hostname: string;
    status: string;
    server_type: string;
  }): Promise<void> {
    const kvNs = process.env.CF_KV_NAMESPACE_ID;
    if (!config.CLOUDFLARE_ACCOUNT_ID || !kvNs) return;
    await cfFetch(
      `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNs}/values/machine:${slug}`,
      { method: 'PUT', body: data },
    );
    console.log(`[CF KV] machine:${slug} → ${data.ip}`);
  },

  /**
   * Delete machine from KV.
   */
  async deleteKVMachine(slug: string): Promise<void> {
    const kvNs = process.env.CF_KV_NAMESPACE_ID;
    if (!config.CLOUDFLARE_ACCOUNT_ID || !kvNs) return;
    await cfFetch(
      `/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNs}/values/machine:${slug}`,
      { method: 'DELETE' },
    ).catch(() => {});
  },
};
