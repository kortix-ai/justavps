/**
 * Cloudflare client — dual-stack DNS and KV management.
 *
 * Architecture (direct IP proxy — no tunnels):
 *   - Per-machine A/AAAA records: slug.kortix.cloud → VPS public IPs (proxied, orange-cloud)
 *   - Per-machine wildcard A/AAAA: *.slug.kortix.cloud → VPS public IPs (proxied, for port subdomains)
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
   * Add DNS records for a machine.
   *
   * Creates:
   *   slug.kortix.cloud         → A/AAAA → VPS public IPs (proxied) — triggers Worker route
   *   origin-slug.kortix.cloud  → A/AAAA → VPS public IPs (DNS-only) — Worker fetches this
   *
   * No wildcard-only special case — the Worker route *.kortix.cloud/* handles
   * port subdomains (3000.slug.kortix.cloud). A wildcard origin record would conflict with
   * the DNS-only origin record.
   *
   * The origin record uses "origin-slug" (single level) not "origin.slug" (two levels)
   * to avoid wildcard DNS precedence conflicts.
   */
  async addMachineDNS(slug: string, addresses: { ipv4?: string | null; ipv6?: string | null }): Promise<void> {
    const { CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!zid) {
      console.warn(`[CF] Zone not configured — skipping DNS for ${slug}`);
      return;
    }
    if (!addresses.ipv4 && !addresses.ipv6) {
      console.warn(`[CF] No public IPs available — skipping DNS for ${slug}`);
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

    const publish = async (type: 'A' | 'AAAA', content: string) => {
      const createRecord = async (name: string, proxied: boolean) => {
        try {
          await cfFetch(`/zones/${zid}/dns_records`, {
            method: 'POST',
            body: { type, name, content, proxied, ttl: 1 },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes('81058')) throw err;
        }
      };

      await createRecord(hostname, true);
      console.log(`[CF DNS] ${type} record: ${hostname} → ${content}`);

      await createRecord(`*.${hostname}`, true);
      console.log(`[CF DNS] Wildcard ${type}: *.${hostname} → ${content}`);

      await createRecord(origin, false);
      console.log(`[CF DNS] Origin ${type} (DNS-only): ${origin} → ${content}`);
    };

    if (addresses.ipv4) await publish('A', addresses.ipv4);
    if (addresses.ipv6) await publish('AAAA', addresses.ipv6);
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
