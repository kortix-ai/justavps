import { config } from "@/server/core/config";
import {
  plansForRegion,
  resolveProviderSku,
  backupSurcharge,
} from '@/shared/lib/plan-catalog';
import type {
  ComputeProvider,
  CreateServerOpts,
  ServerResult,
  ServerTypeInfo,
  RegionInfo,
  SSHKeyResult,
  ProviderActionProgress,
} from "@/server/platform/providers/types";

const HETZNER_API = 'https://api.hetzner.cloud/v1';
const API_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 3_000;
const HETZNER_RATE_LIMIT_RETRIES = 4;
const HETZNER_RATE_LIMIT_BASE_DELAY_MS = 1_500;
const MANAGED_FIREWALL_CACHE_TTL_MS = 5 * 60_000;
const MANAGED_FIREWALL_RECONCILE_MIN_INTERVAL_MS = 15 * 60_000;
const HETZNER_CREATE_CONCURRENCY = Math.max(1, Number(process.env.HETZNER_CREATE_CONCURRENCY || '3'));
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];
const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

interface HetznerFirewall {
  id: number;
  name: string;
}

interface HetznerFirewallRule {
  direction: 'in' | 'out';
  protocol: 'tcp' | 'udp' | 'icmp';
  port?: string;
  source_ips?: string[];
  destination_ips?: string[];
  description?: string;
}

type ManagedFirewallCache = {
  id: number;
  rulesHash: string;
  cachedAt: number;
};

let managedFirewallCache: ManagedFirewallCache | null = null;
let managedFirewallPromise: Promise<number> | null = null;
let lastManagedFirewallReconcileAt = 0;
let activeHetznerCreates = 0;
const pendingHetznerCreates: Array<() => void> = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHetznerRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(' 429:') || error.message.includes('rate_limit_exceeded');
}

async function withHetznerRateLimitRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isHetznerRateLimitError(error) || attempt >= HETZNER_RATE_LIMIT_RETRIES - 1) {
        throw error;
      }

      const backoffMs = HETZNER_RATE_LIMIT_BASE_DELAY_MS * (2 ** attempt);
      console.warn(`[hetzner] ${label} rate-limited, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${HETZNER_RATE_LIMIT_RETRIES})`);
      attempt += 1;
      await delay(backoffMs);
    }
  }
}

function setManagedFirewallCache(id: number, rules: HetznerFirewallRule[]) {
  managedFirewallCache = {
    id,
    rulesHash: normalizeFirewallRules(rules),
    cachedAt: Date.now(),
  };
}

async function withCreateSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeHetznerCreates >= HETZNER_CREATE_CONCURRENCY) {
    await new Promise<void>((resolve) => pendingHetznerCreates.push(resolve));
  }

  activeHetznerCreates += 1;
  try {
    return await fn();
  } finally {
    activeHetznerCreates -= 1;
    pendingHetznerCreates.shift()?.();
  }
}

function firewallNameForDomain(domain: string): string {
  return `justavps-managed-${domain.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
}

function managedFirewallRules(): HetznerFirewallRule[] {
  const brokerSourceIPs = config.brokerSourceIPs();
  return [
    {
      direction: 'in',
      protocol: 'tcp',
      port: '22',
      source_ips: ['0.0.0.0/0', '::/0'],
      description: 'SSH access',
    },
    {
      direction: 'in',
      protocol: 'tcp',
      port: '80',
      source_ips: [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES, ...brokerSourceIPs],
      description: brokerSourceIPs.length > 0 ? 'Cloudflare + broker ingress' : 'Cloudflare proxy ingress',
    },
  ];
}

function normalizeFirewallRules(rules: HetznerFirewallRule[]) {
  return JSON.stringify(rules.map((rule) => ({
    direction: rule.direction,
    protocol: rule.protocol,
    port: rule.port ?? '',
    description: rule.description ?? '',
    source_ips: [...(rule.source_ips ?? [])].sort(),
    destination_ips: [...(rule.destination_ips ?? [])].sort(),
  })).sort((a, b) => `${a.direction}:${a.protocol}:${a.port}`.localeCompare(`${b.direction}:${b.protocol}:${b.port}`)));
}

async function getOrCreateManagedFirewall(): Promise<number> {
  if (managedFirewallCache && Date.now() - managedFirewallCache.cachedAt < MANAGED_FIREWALL_CACHE_TTL_MS) {
    return managedFirewallCache.id;
  }

  if (managedFirewallPromise) {
    return managedFirewallPromise;
  }

  managedFirewallPromise = (async () => {
  const firewallName = firewallNameForDomain(config.PROXY_DOMAIN);
  const desiredRules = managedFirewallRules();
    const desiredRulesHash = normalizeFirewallRules(desiredRules);
    const existing = await withHetznerRateLimitRetry(
      'fetch managed firewall',
      () => hetznerFetch<{ firewalls: Array<HetznerFirewall & { rules?: HetznerFirewallRule[] }> }>('/firewalls?per_page=50'),
    );
    const matched = existing.firewalls.find((firewall) => firewall.name === firewallName);
    if (matched) {
      const matchedRules = matched.rules ?? [];
      setManagedFirewallCache(matched.id, matchedRules);

      if (normalizeFirewallRules(matchedRules) !== desiredRulesHash) {
        const now = Date.now();
        if (now - lastManagedFirewallReconcileAt >= MANAGED_FIREWALL_RECONCILE_MIN_INTERVAL_MS) {
          lastManagedFirewallReconcileAt = now;
          void withHetznerRateLimitRetry(
            'reconcile managed firewall',
            () => hetznerFetch(`/firewalls/${matched.id}`, {
              method: 'PUT',
              body: {
                name: firewallName,
                rules: desiredRules,
              },
            }),
          ).then(() => {
            setManagedFirewallCache(matched.id, desiredRules);
            console.log(`[hetzner] Reconciled managed firewall ${matched.id}`);
          }).catch((error) => {
            console.warn(`[hetzner] Managed firewall ${matched.id} reconciliation deferred:`, error);
          });
        } else {
          console.log(`[hetzner] Managed firewall ${matched.id} is stale, but reconcile is rate-limited; proceeding with existing rules`);
        }
      }

      return matched.id;
    }

    const created = await withHetznerRateLimitRetry(
      'create managed firewall',
      () => hetznerFetch<{ firewall: HetznerFirewall }>('/firewalls', {
        method: 'POST',
        body: {
          name: firewallName,
          rules: desiredRules,
        },
      }),
    );

    setManagedFirewallCache(created.firewall.id, desiredRules);
    return created.firewall.id;
  })();

  try {
    return await managedFirewallPromise;
  } finally {
    managedFirewallPromise = null;
  }
}

interface HetznerServer {
  id: number;
  name: string;
  status: string;
  public_net: {
    ipv4: { ip: string };
    ipv6: { ip: string };
  };
  server_type: { name: string };
  labels: Record<string, string>;
}

interface HetznerAction {
  id: number;
  status: string;
  progress: number;
}

interface HetznerImage {
  id: number;
  description: string | null;
  status: string;
  created?: string;
  architecture: 'x86' | 'arm' | string;
  disk_size: number;
}

const HETZNER_REGIONS: RegionInfo[] = [
  { id: 'hel1', name: 'EU', country: 'EU', city: 'EU' },
  { id: 'hil', name: 'US', country: 'US', city: 'US' },
];

async function hetznerFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${config.HETZNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hetzner API ${options.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

async function waitForServerStatus(serverId: number, target: string, timeoutMs = PROVISION_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
    if (data.server.status === target) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[hetzner] Server ${serverId} did not reach '${target}' within ${timeoutMs / 1000}s`);
}

async function waitForImageReady(imageId: number, timeoutMs = PROVISION_TIMEOUT_MS) {
  const start = Date.now();
  let consecutiveErrors = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const data = await hetznerFetch<{ image: HetznerImage }>(`/images/${imageId}`);
      consecutiveErrors = 0;
      if (data.image.status === 'available') return;
      // Hetzner doesn't have a 'failed' status for snapshots — they stay
      // 'creating' until done or are silently deleted on failure. If the
      // image disappears (404), the fetch will throw and we'll retry.
    } catch (err) {
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      // A few transient 5xx or network errors are fine during snapshot
      // creation — Hetzner's API can be flaky. Only give up after 5
      // consecutive failures (15+ seconds of no successful poll).
      if (consecutiveErrors >= 5) {
        throw new Error(`[hetzner] Image ${imageId} poll failed after ${consecutiveErrors} consecutive errors: ${msg}`);
      }
      console.warn(`[hetzner] Transient error polling image ${imageId} (attempt ${consecutiveErrors}/5): ${msg}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[hetzner] Image ${imageId} did not become available within ${Math.floor(timeoutMs / 1000)}s`);
}

/**
 * Hetzner returns a /64 subnet like "2a01:4f8:c17:e4c4::/64".
 * The server itself uses the first host in that subnet, i.e. "::1".
 */
function extractIPv6(raw: string): string {
  const stripped = raw.replace(/\/\d+$/, '');
  if (raw.includes('/') && stripped.endsWith('::')) {
    return `${stripped}1`;
  }
  return stripped;
}

function extractIpv4(raw?: string | null): string | null {
  return raw && raw.trim() ? raw : null;
}

export class HetznerProvider implements ComputeProvider {
  readonly name = 'cloud' as const;
  readonly displayName = 'JustAVPS Cloud';
  readonly capabilities = {
    backups: true,
    images: true,
    bareMetal: false,
  } as const;

  async validateImage(imageId: string): Promise<boolean> {
    if (isNaN(Number(imageId))) return true;

    try {
      await hetznerFetch<{ image: HetznerImage }>(`/images/${imageId}`);
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        return false;
      }
      throw err;
    }
  }

  async createImage(serverId: string, description: string): Promise<{ imageId: string; diskSize: number; architecture: string }> {
    const numericServerId = Number(serverId);
    const resp = await hetznerFetch<{ image: HetznerImage }>(
      `/servers/${numericServerId}/actions/create_image`,
      { method: 'POST', body: { type: 'snapshot', description } },
    );
    const imageId = resp.image.id;
    console.log(`[hetzner] Snapshot creation started: imageId=${imageId} serverId=${numericServerId}`);

    // Snapshots of large disks can take 10-15 min. Use a dedicated timeout
    // (15 min) instead of the generic PROVISION_TIMEOUT_MS (10 min).
    const IMAGE_TIMEOUT_MS = 15 * 60 * 1000;
    await waitForImageReady(imageId, IMAGE_TIMEOUT_MS);

    const final = await hetznerFetch<{ image: HetznerImage }>(`/images/${imageId}`);
    console.log(`[hetzner] Snapshot ready: imageId=${imageId} diskSize=${final.image.disk_size}GB`);
    return {
      imageId: String(imageId),
      diskSize: final.image.disk_size,
      architecture: final.image.architecture,
    };
  }

  async deleteImage(imageId: string): Promise<void> {
    try {
      await hetznerFetch(`/images/${imageId}`, { method: 'DELETE' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        console.log(`[hetzner] Image ${imageId} already deleted on Hetzner`);
        return;
      }
      throw err;
    }
    console.log(`[hetzner] Deleted image ${imageId}`);
  }

  async createServer(opts: CreateServerOpts): Promise<ServerResult> {
    return withCreateSlot(async () => {
      // Resolve plan ID (e.g. "pro") or legacy SKU (e.g. "cpx42") → provider SKU
      const providerSku = resolveProviderSku(opts.serverType, opts.region) || opts.serverType;
      const firewallId = await getOrCreateManagedFirewall();
      const body: Record<string, unknown> = {
        name: opts.name,
        server_type: providerSku,
        image: isNaN(Number(opts.image)) ? opts.image : parseInt(opts.image, 10),
        location: opts.region,
        start_after_create: true,
        user_data: opts.userData,
        labels: opts.labels,
        automount: false,
        public_net: { enable_ipv4: true, enable_ipv6: true },
        firewalls: [{ firewall: firewallId }],
      };

      // Note: Hetzner's POST /servers does NOT accept an `enable_backup` field.
      // Backups must be enabled via a separate action endpoint after the server
      // exists (see below, after createServer succeeds).
      if (opts.sshKeyIds.length > 0) body.ssh_keys = opts.sshKeyIds.map(Number);

      const result = await hetznerFetch<{ server: HetznerServer; action?: HetznerAction }>('/servers', {
        method: 'POST',
        body,
      });

      const serverId = result.server.id;
      const publicIpv4 = extractIpv4(result.server.public_net.ipv4?.ip);
      const publicIpv6 = extractIPv6(result.server.public_net.ipv6.ip);
      const publicIp = publicIpv4 ?? publicIpv6;

      if (!publicIp) {
        // Fallback: poll briefly for IP assignment (shouldn't be needed)
        for (let i = 0; i < 5; i++) {
          await delay(3000);
          const info = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
          const polledIpv4 = extractIpv4(info.server.public_net.ipv4?.ip);
          const polledIpv6 = extractIPv6(info.server.public_net.ipv6.ip);
          const polledIp = polledIpv4 ?? polledIpv6;
          if (polledIp) {
            console.log(`[hetzner] Created server ${opts.name} (ID: ${serverId}, IPv4: ${polledIpv4 ?? '-'}, IPv6: ${polledIpv6 ?? '-'})`);
            return {
              serverId: String(serverId),
              publicIp: polledIp,
              publicIpv4: polledIpv4,
              publicIpv6: polledIpv6,
              createActionId: result.action ? String(result.action.id) : null,
            };
          }
        }
        throw new Error(`[hetzner] Server ${serverId} created but no IP assigned`);
      }

      console.log(`[hetzner] Created server ${opts.name} (ID: ${serverId}, IPv4: ${publicIpv4 ?? '-'}, IPv6: ${publicIpv6 ?? '-'})`);

      // Enable delete + rebuild protection (fire-and-forget — don't block provisioning)
      hetznerFetch(`/servers/${serverId}/actions/change_protection`, {
        method: 'POST',
        body: { delete: true, rebuild: true },
      }).then(() => {
        console.log(`[hetzner] Enabled delete/rebuild protection for server ${serverId}`);
      }).catch((err) => {
        console.warn(`[hetzner] Failed to enable protection for server ${serverId}:`, err);
      });

      // Enable backups if requested (Hetzner requires a separate action — see note above).
      // Fire-and-forget: the action queues and takes effect once the server is available.
      if (opts.enableBackups) {
        hetznerFetch(`/servers/${serverId}/actions/enable_backup`, { method: 'POST' })
          .then(() => console.log(`[hetzner] Enabled backups for server ${serverId}`))
          .catch((err) => console.error(`[hetzner] Failed to enable backups for server ${serverId}:`, err));
      }

      return {
        serverId: String(serverId),
        publicIp,
        publicIpv4,
        publicIpv6,
        createActionId: result.action ? String(result.action.id) : null,
      };
    });
  }

  async getActionProgress(actionId: string): Promise<ProviderActionProgress> {
    const result = await hetznerFetch<{ action: HetznerAction }>(`/servers/actions/${actionId}`);
    return {
      status: result.action.status,
      progress: typeof result.action.progress === 'number' ? result.action.progress : null,
    };
  }

  async getServerNetwork(serverId: string) {
    const result = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
    return {
      publicIpv4: extractIpv4(result.server.public_net.ipv4?.ip),
      publicIpv6: extractIPv6(result.server.public_net.ipv6.ip),
    };
  }

  async deleteServer(serverId: string): Promise<void> {
    // Disable protection before deletion (protection was enabled at creation)
    try {
      await hetznerFetch(`/servers/${serverId}/actions/change_protection`, {
        method: 'POST',
        body: { delete: false, rebuild: false },
      });
    } catch {
      // Protection may not be enabled or server may already be gone — continue
    }

    try {
      await hetznerFetch(`/servers/${serverId}`, { method: 'DELETE' });
    } catch (err) {
      // 404 = already deleted on Hetzner — that's fine, proceed with DB cleanup
      if (err instanceof Error && err.message.includes('404')) {
        console.log(`[hetzner] Server ${serverId} already deleted on Hetzner`);
        return;
      }
      throw err;
    }
    console.log(`[hetzner] Deleted server ${serverId}`);
  }

  async startServer(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/poweron`, { method: 'POST' });
  }

  async stopServer(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/poweroff`, { method: 'POST' });
  }

  async rebootServer(serverId: string): Promise<void> {
    try {
      await hetznerFetch(`/servers/${serverId}/actions/reboot`, { method: 'POST' });
    } catch {
      // Soft reboot can fail if no network interface — fall back to hard reset
      await hetznerFetch(`/servers/${serverId}/actions/reset`, { method: 'POST' });
    }
    console.log(`[hetzner] Rebooted server ${serverId}`);
  }

  /**
   * Resize a server: stop → change_type → start.
   *
   * Hetzner requires the server to be stopped for shared CPU types before
   * changing type. We power off, wait for the server to reach 'off' status,
   * issue the change_type, then power it back on and wait for 'running'.
   *
   * `upgrade_disk: true` — disk is permanently enlarged (irreversible).
   */
  async resizeServer(serverId: string, serverType: string, region?: string): Promise<void> {
    // Resolve plan ID (e.g. "power") → provider SKU. For resize the region
    // of the existing machine should be passed; fall back to default EU.
    const providerSku = resolveProviderSku(serverType, region || config.HETZNER_DEFAULT_LOCATION) || serverType;

    // 1. Check current status — only stop if running
    const currentStatus = await this.getServerStatus(serverId);
    if (currentStatus === 'running') {
      console.log(`[hetzner] Stopping server ${serverId} before resize...`);
      await this.stopServer(serverId);
      await waitForServerStatus(Number(serverId), 'off', 120_000);
      console.log(`[hetzner] Server ${serverId} stopped`);
    }

    // 2. Change type
    await hetznerFetch(`/servers/${serverId}/actions/change_type`, {
      method: 'POST',
      body: { server_type: providerSku, upgrade_disk: true },
    });
    console.log(`[hetzner] Server ${serverId} type changed to ${providerSku}`);

    // 3. Start the server back up
    console.log(`[hetzner] Starting server ${serverId} after resize...`);
    await this.startServer(serverId);
    await waitForServerStatus(Number(serverId), 'running', 120_000);
    console.log(`[hetzner] Server ${serverId} resized to ${providerSku} and running`);
  }

  async getServerStatus(serverId: string): Promise<string> {
    const data = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
    return data.server.status;
  }

  async uploadSSHKey(name: string, publicKey: string): Promise<SSHKeyResult> {
    const result = await hetznerFetch<{ ssh_key: { id: number } }>('/ssh_keys', {
      method: 'POST',
      body: { name, public_key: publicKey },
    });
    return { keyId: String(result.ssh_key.id) };
  }

  async deleteSSHKey(keyId: string): Promise<void> {
    try {
      await hetznerFetch(`/ssh_keys/${keyId}`, { method: 'DELETE' });
    } catch (err) {
      // 404 = already deleted — that's fine
      if (err instanceof Error && err.message.includes('404')) return;
      throw err;
    }
  }

  /**
   * List all SSH keys in the Hetzner project.
   * Used by GC to prune orphaned keys.
   */
  async listSSHKeys(): Promise<Array<{ id: number; name: string }>> {
    const keys: Array<{ id: number; name: string }> = [];
    let page = 1;
    while (true) {
      const data = await hetznerFetch<{
        ssh_keys: Array<{ id: number; name: string }>;
        meta: { pagination: { next_page: number | null } };
      }>(`/ssh_keys?per_page=50&page=${page}`);
      keys.push(...data.ssh_keys);
      if (!data.meta.pagination.next_page) break;
      page = data.meta.pagination.next_page;
    }
    return keys;
  }

  async findSSHKeyByPublicKey(publicKey: string): Promise<string | null> {
    let page = 1;
    while (true) {
      const data = await hetznerFetch<{
        ssh_keys: Array<{ id: number; public_key?: string | null }>;
        meta: { pagination: { next_page: number | null } };
      }>(`/ssh_keys?per_page=50&page=${page}`);

      const match = data.ssh_keys.find((key) => key.public_key === publicKey);
      if (match) return String(match.id);
      if (!data.meta.pagination.next_page) break;
      page = data.meta.pagination.next_page;
    }
    return null;
  }

  /**
   * Garbage-collect orphaned SSH keys.
   *
   * Hetzner has a limit of ~100 SSH keys per project. We upload one per machine
   * and historically never cleaned them up. This function:
   * 1. Lists all SSH keys in the project
   * 2. Lists all active (non-deleted) servers
   * 3. Deletes any `justavps-*` SSH key whose slug doesn't match an active server
   *
   * Returns the number of keys deleted.
   */
  async gcSSHKeys(): Promise<{ deleted: number; kept: number; total: number }> {
    const [allKeys, serversData] = await Promise.all([
      this.listSSHKeys(),
      hetznerFetch<{ servers: HetznerServer[] }>('/servers?per_page=50&label_selector=justavps%3Dtrue'),
    ]);

    // Build set of active server slugs from server names (format: justavps-{slug})
    const activeSlugs = new Set<string>();
    for (const server of serversData.servers) {
      const slug = server.name.replace(/^justavps-/, '');
      activeSlugs.add(slug);
    }

    // Only GC keys that match our naming convention
    const justavpsKeys = allKeys.filter((k) => k.name.startsWith('justavps-'));
    let deleted = 0;

    for (const key of justavpsKeys) {
      // Extract slug from key name: "justavps-{slug}" or "justavps-{slug}-{timestamp}"
      const slug = key.name.replace(/^justavps-/, '').replace(/-\d+$/, '');
      if (!activeSlugs.has(slug)) {
        try {
          await this.deleteSSHKey(String(key.id));
          deleted++;
        } catch (err) {
          console.warn(`[HETZNER GC] Failed to delete SSH key ${key.id} (${key.name}):`, err);
        }
      }
    }

    console.log(`[HETZNER GC] SSH keys: ${deleted} deleted, ${justavpsKeys.length - deleted} kept, ${allKeys.length} total in project`);
    return { deleted, kept: justavpsKeys.length - deleted, total: allKeys.length };
  }

  async listServerTypes(region: string): Promise<ServerTypeInfo[]> {
    const loc = region || config.HETZNER_DEFAULT_LOCATION;

    return plansForRegion(loc).map((plan) => ({
      name: plan.id,
      description: `${plan.vcpu} vCPU / ${plan.memory} GB RAM / ${plan.disk} GB SSD / ${plan.traffic}`,
      cores: plan.vcpu,
      memory: plan.memory,
      disk: plan.disk,
      cpuType: 'shared' as const,
      architecture: 'x86' as const,
      providerPriceMonthly: plan.providerCostMonthly,
      priceMonthly: plan.priceMonthly,
      backupPriceMonthly: backupSurcharge(plan.priceMonthly),
      region: loc,
    }));
  }

  async listRegions(): Promise<RegionInfo[]> {
    return HETZNER_REGIONS;
  }

  // ─── Backups ──────────────────────────────────────────────────────────────

  async listBackups(serverId: string): Promise<BackupInfo[]> {
    const [backups, snapshots] = await Promise.all([
      hetznerFetch<{ images: HetznerBackup[] }>(`/images?type=backup&sort=created:desc&per_page=25`),
      hetznerFetch<{ images: HetznerBackup[] }>(`/images?type=snapshot&sort=created:desc&per_page=25`),
    ]);

    const allImages = [...backups.images, ...snapshots.images]
      .filter((img) => img.created_from?.id === Number(serverId))
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return allImages.map((img) => ({
      id: String(img.id),
      description: img.description || `Backup ${img.id}`,
      created: img.created,
      size: img.image_size ?? 0,
      status: img.status,
    }));
  }

  async createBackup(serverId: string, description?: string): Promise<{ id: string }> {
    const defaultDesc = `Backup ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`;
    const requestedDescription = description || defaultDesc;

    try {
      const result = await hetznerFetch<{ image: { id: number } }>(`/servers/${serverId}/actions/create_image`, {
        method: 'POST',
        body: { type: 'backup', description: requestedDescription },
      });
      console.log(`[hetzner] Created backup for server ${serverId}: image ${result.image.id}`);
      return { id: String(result.image.id) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isLocked = message.includes('423') || message.includes('resource is locked') || message.includes('"code": "locked"');
      if (!isLocked) throw err;

      console.warn(`[hetzner] Backup create locked for server ${serverId}; checking for an in-progress backup`);
      const backups = await this.listBackups(serverId);
      const now = Date.now();
      const recent = backups.find((backup) => {
        const createdAt = Date.parse(backup.created);
        const isRecent = !Number.isNaN(createdAt) && now - createdAt < 30 * 60 * 1000;
        const statusOk = backup.status === 'creating' || backup.status === 'available';
        const descriptionMatches = backup.description === requestedDescription;
        return statusOk && (descriptionMatches || isRecent);
      });

      if (recent) {
        console.warn(`[hetzner] Reusing recent backup ${recent.id} for server ${serverId} after lock (${recent.status})`);
        return { id: recent.id };
      }

      throw err;
    }
  }

  async enableBackups(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/enable_backup`, { method: 'POST' });
    console.log(`[hetzner] Enabled backups for server ${serverId}`);
  }

  async disableBackups(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/disable_backup`, { method: 'POST' });
    console.log(`[hetzner] Disabled backups for server ${serverId}`);
  }

  async restoreBackup(serverId: string, backupId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/rebuild`, {
      method: 'POST',
      body: { image: Number(backupId) },
    });
    console.log(`[hetzner] Restoring server ${serverId} from backup ${backupId}`);
  }

  async deleteBackup(backupId: string): Promise<void> {
    await hetznerFetch(`/images/${backupId}`, { method: 'DELETE' });
    console.log(`[hetzner] Deleted backup image ${backupId}`);
  }
}

interface HetznerBackup {
  id: number;
  description: string | null;
  status: string;
  created: string;
  image_size: number | null;
  created_from: { id: number; name: string } | null;
}

interface BackupInfo {
  id: string;
  description: string;
  created: string;
  size: number;
  status: string;
}
