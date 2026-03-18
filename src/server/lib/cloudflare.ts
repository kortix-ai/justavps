/**
 * Cloudflare client — Tunnel ingress, DNS CNAME records, and KV management.
 *
 * Architecture:
 *   - One shared tunnel ("justavps-production") with many connectors (one per VPS)
 *   - Each VPS runs cloudflared → connects outbound to Cloudflare
 *   - DNS: CNAME slug.kortix.cloud → {tunnel-id}.cfargotunnel.com (proxied)
 *   - Tunnel ingress config maps hostname → localhost:80 on the connector
 *   - Worker handles auth, then passes through to the tunnel
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

// ─── Tunnel Ingress ─────────────────────────────────────────────────────────

interface TunnelIngress {
  hostname?: string;
  service: string;
  originRequest?: Record<string, unknown>;
}

async function getTunnelIngress(): Promise<TunnelIngress[]> {
  const { CLOUDFLARE_ACCOUNT_ID: acct, CLOUDFLARE_TUNNEL_ID: tid } = config;
  if (!acct || !tid) return [];
  const result = await cfFetch<{ result: { config: { ingress: TunnelIngress[] } } }>(
    `/accounts/${acct}/cfd_tunnel/${tid}/configurations`,
  );
  return result.result?.config?.ingress || [{ service: 'http_status:404' }];
}

async function setTunnelIngress(ingress: TunnelIngress[]): Promise<void> {
  const { CLOUDFLARE_ACCOUNT_ID: acct, CLOUDFLARE_TUNNEL_ID: tid } = config;
  if (!acct || !tid) return;
  const rules = ingress.filter(r => r.hostname);
  await cfFetch(`/accounts/${acct}/cfd_tunnel/${tid}/configurations`, {
    method: 'PUT',
    body: { config: { ingress: [...rules, { service: 'http_status:404' }] } },
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const cloudflareClient = {
  /**
   * Add a machine to the tunnel: ingress rule + CNAME DNS.
   */
  async addMachineToTunnel(slug: string): Promise<void> {
    const { CLOUDFLARE_TUNNEL_ID: tid, CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!tid || !zid) {
      console.warn(`[CF] Tunnel not configured — skipping for ${slug}`);
      return;
    }

    const hostname = `${slug}.${domain}`;

    // Add ingress rule
    const ingress = await getTunnelIngress();
    if (!ingress.find(r => r.hostname === hostname)) {
      ingress.push({ hostname, service: 'http://localhost:7777', originRequest: {} });
      await setTunnelIngress(ingress);
      console.log(`[CF Tunnel] Added ingress: ${hostname}`);
    }

    // Delete any stale DNS records (A or CNAME)
    for (const type of ['CNAME', 'A']) {
      try {
        const existing = await cfFetch<{ result: Array<{ id: string }> }>(
          `/zones/${zid}/dns_records?name=${hostname}&type=${type}`,
        );
        for (const r of existing.result) {
          await cfFetch(`/zones/${zid}/dns_records/${r.id}`, { method: 'DELETE' });
        }
      } catch {}
    }
    // Also clean origin.slug records from old architecture
    try {
      const old = await cfFetch<{ result: Array<{ id: string }> }>(
        `/zones/${zid}/dns_records?name=origin.${hostname}`,
      );
      for (const r of old.result) {
        await cfFetch(`/zones/${zid}/dns_records/${r.id}`, { method: 'DELETE' });
      }
    } catch {}

    // Create CNAME → tunnel
    await cfFetch(`/zones/${zid}/dns_records`, {
      method: 'POST',
      body: {
        type: 'CNAME',
        name: hostname,
        content: `${tid}.cfargotunnel.com`,
        proxied: true,
        ttl: 1,
      },
    });
    console.log(`[CF DNS] CNAME: ${hostname} → ${tid}.cfargotunnel.com`);
  },

  /**
   * Remove a machine from the tunnel: ingress rule + DNS.
   */
  async removeMachineFromTunnel(slug: string): Promise<void> {
    const { CLOUDFLARE_TUNNEL_ID: tid, CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!tid || !zid) return;
    const hostname = `${slug}.${domain}`;

    // Remove ingress
    try {
      const ingress = await getTunnelIngress();
      const filtered = ingress.filter(r => r.hostname !== hostname);
      if (filtered.length !== ingress.length) {
        await setTunnelIngress(filtered);
        console.log(`[CF Tunnel] Removed ingress: ${hostname}`);
      }
    } catch (err) {
      console.warn(`[CF Tunnel] Failed to remove ingress for ${hostname}:`, err);
    }

    // Delete DNS
    try {
      for (const pattern of [hostname, `origin.${hostname}`]) {
        const records = await cfFetch<{ result: Array<{ id: string }> }>(
          `/zones/${zid}/dns_records?name=${pattern}`,
        );
        for (const r of records.result) {
          await cfFetch(`/zones/${zid}/dns_records/${r.id}`, { method: 'DELETE' });
        }
      }
    } catch {}
  },

  /**
   * Write machine to KV (Worker auth).
   */
  async writeKVMachine(slug: string, data: {
    owner_id: string;
    ip: string;
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
