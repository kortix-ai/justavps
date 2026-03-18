/**
 * Cloudflare client — Tunnel ingress, DNS CNAME records, and KV management.
 *
 * Architecture:
 *   - One shared tunnel ("justavps-production") with many connectors (one per VPS)
 *   - Each VPS runs cloudflared → connects outbound to Cloudflare
 *   - DNS: CNAME slug.kortix.cloud → {tunnel-id}.cfargotunnel.com (proxied)
 *   - Tunnel ingress config maps hostname → localhost:7777 (daemon)
 */

import { config } from './config';
import { execSync } from 'child_process';

const CF_API = 'https://api.cloudflare.com/client/v4';
const DNS_VERIFY_ATTEMPTS = 3;
const DNS_VERIFY_WAIT_MS = 8000;

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Verify DNS resolves via Cloudflare's own nameservers.
 * Returns true if the hostname returns any result from dig.
 */
function verifyDNS(hostname: string): boolean {
  try {
    const result = execSync(`dig @1.1.1.1 +short ${hostname}`, { encoding: 'utf8', timeout: 5000 }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
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
    } catch {}
  }
}

/**
 * Create a proxied CNAME record pointing to the tunnel.
 */
async function createTunnelCNAME(zid: string, hostname: string, tunnelId: string): Promise<void> {
  await cfFetch(`/zones/${zid}/dns_records`, {
    method: 'POST',
    body: {
      type: 'CNAME',
      name: hostname,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
    },
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const cloudflareClient = {
  /**
   * Add a machine to the tunnel: ingress rule + CNAME DNS with verification.
   *
   * DNS CNAME propagation on Cloudflare is unreliable — newly created records
   * sometimes don't resolve for 30-60s. This function creates the CNAME, verifies
   * it resolves via dig, and if not, deletes + recreates up to 3 times.
   */
  async addMachineToTunnel(slug: string): Promise<void> {
    const { CLOUDFLARE_TUNNEL_ID: tid, CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!tid || !zid) {
      console.warn(`[CF] Tunnel not configured — skipping for ${slug}`);
      return;
    }

    const hostname = `${slug}.${domain}`;

    // 1. Add ingress rule to tunnel config
    const ingress = await getTunnelIngress();
    if (!ingress.find(r => r.hostname === hostname)) {
      ingress.push({ hostname, service: 'http://localhost:7777', originRequest: {} });
      await setTunnelIngress(ingress);
      console.log(`[CF Tunnel] Added ingress: ${hostname}`);
    }

    // 2. Create CNAME with verification loop
    // Delete any stale records first
    await deleteAllDNSRecords(zid, hostname);
    // Also clean origin.slug records from old architecture
    await deleteAllDNSRecords(zid, `origin.${hostname}`);

    for (let attempt = 1; attempt <= DNS_VERIFY_ATTEMPTS; attempt++) {
      // Wait after deletion before creating
      await sleep(3000);

      // Create the CNAME
      await createTunnelCNAME(zid, hostname, tid);
      console.log(`[CF DNS] Created CNAME (attempt ${attempt}): ${hostname} → ${tid}.cfargotunnel.com`);

      // Verify it resolves
      await sleep(DNS_VERIFY_WAIT_MS);
      if (verifyDNS(hostname)) {
        console.log(`[CF DNS] ✓ Verified: ${hostname} resolves`);
        return;
      }

      console.warn(`[CF DNS] ✗ ${hostname} not resolving after ${DNS_VERIFY_WAIT_MS / 1000}s (attempt ${attempt}/${DNS_VERIFY_ATTEMPTS})`);

      // Delete and retry
      if (attempt < DNS_VERIFY_ATTEMPTS) {
        await deleteAllDNSRecords(zid, hostname);
        console.log(`[CF DNS] Deleted for retry`);
      }
    }

    // Final check — sometimes it resolves right after the last attempt
    await sleep(5000);
    if (verifyDNS(hostname)) {
      console.log(`[CF DNS] ✓ Verified on final check: ${hostname}`);
    } else {
      console.error(`[CF DNS] ✗ FAILED: ${hostname} did not resolve after ${DNS_VERIFY_ATTEMPTS} attempts. DNS may propagate later.`);
    }
  },

  /**
   * Remove a machine from the tunnel: ingress rule + DNS.
   */
  async removeMachineFromTunnel(slug: string): Promise<void> {
    const { CLOUDFLARE_TUNNEL_ID: tid, CLOUDFLARE_ZONE_ID: zid, PROXY_DOMAIN: domain } = config;
    if (!tid || !zid) return;
    const hostname = `${slug}.${domain}`;

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

    await deleteAllDNSRecords(zid, hostname);
    await deleteAllDNSRecords(zid, `origin.${hostname}`);
  },

  /**
   * Write machine to KV (for Worker/daemon auth if needed).
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
