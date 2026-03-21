import { config } from '../config';
import { getPlanBySku, getPlansForRegion, HETZNER_PLAN_TIERS, backupSurcharge } from '@/lib/hetzner-pricing';
import type {
  ComputeProvider,
  CreateServerOpts,
  ServerResult,
  ServerTypeInfo,
  RegionInfo,
  SSHKeyResult,
  ProviderActionProgress,
} from './types';

const HETZNER_API = 'https://api.hetzner.cloud/v1';
const API_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 3_000;
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

function firewallNameForDomain(domain: string): string {
  return `justavps-managed-${domain.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
}

async function getOrCreateManagedFirewall(): Promise<number> {
  const firewallName = firewallNameForDomain(config.PROXY_DOMAIN);
  const existing = await hetznerFetch<{ firewalls: HetznerFirewall[] }>('/firewalls?per_page=50');
  const matched = existing.firewalls.find((firewall) => firewall.name === firewallName);
  if (matched) return matched.id;

  const created = await hetznerFetch<{ firewall: HetznerFirewall }>('/firewalls', {
    method: 'POST',
    body: {
      name: firewallName,
      rules: [
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
          source_ips: [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES],
          description: 'Cloudflare proxy ingress',
        },
      ],
    },
  });

  return created.firewall.id;
}

/**
 * Get the plan tier index for a given SKU across any region.
 * Returns -1 if not found.
 */
export function getPlanTierIndex(sku: string): number {
  return HETZNER_PLAN_TIERS.findIndex((tier) => tier.regions.eu.sku === sku || tier.regions.us.sku === sku);
}

/**
 * Get the plan tier for a given SKU.
 */
export function getPlanTier(sku: string) {
  return getPlanBySku(sku);
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
  while (Date.now() - start < timeoutMs) {
    const data = await hetznerFetch<{ image: HetznerImage }>(`/images/${imageId}`);
    if (data.image.status === 'available') return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[hetzner] Image ${imageId} did not become available within ${timeoutMs / 1000}s`);
}

/**
 * Extract a usable IPv6 address from Hetzner's response.
 * Hetzner returns a /64 subnet like "2a01:4f8:c17:e4c4::/64".
 * The server itself uses the first host in that subnet, i.e. "::1".
 * Also handles already-normalized bare addresses gracefully.
 */
function extractIPv6(raw: string): string {
  const stripped = raw.replace(/\/\d+$/, '');
  if (raw.includes('/') && stripped.endsWith('::')) {
    return `${stripped}1`;
  }
  return stripped;
}

export class HetznerProvider implements ComputeProvider {
  readonly name = 'cloud' as const;
  readonly displayName = 'JustAVPS Cloud';

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

  async createImage(serverId: number, description: string): Promise<{ imageId: string; diskSize: number; architecture: string }> {
    const resp = await hetznerFetch<{ image: HetznerImage }>(
      `/servers/${serverId}/actions/create_image`,
      { method: 'POST', body: { type: 'snapshot', description } },
    );
    const imageId = resp.image.id;
    await waitForImageReady(imageId);
    const final = await hetznerFetch<{ image: HetznerImage }>(`/images/${imageId}`);
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
    const firewallId = await getOrCreateManagedFirewall();
    const body: Record<string, unknown> = {
      name: opts.name,
      server_type: opts.serverType,
      image: isNaN(Number(opts.image)) ? opts.image : parseInt(opts.image, 10),
      location: opts.region,
      start_after_create: true,
      user_data: opts.userData,
      labels: opts.labels,
      automount: false,
      public_net: { enable_ipv4: false, enable_ipv6: true },
      firewalls: [{ firewall: firewallId }],
    };

    if (opts.enableBackups) body.enable_backup = true;
    if (opts.sshKeyIds.length > 0) body.ssh_keys = opts.sshKeyIds.map(Number);

    const result = await hetznerFetch<{ server: HetznerServer; action?: HetznerAction }>('/servers', {
      method: 'POST',
      body,
    });

    const serverId = result.server.id;
    // IP is assigned immediately at creation — don't wait for "running" status
    // (waiting takes 60-90s on snapshot boot, which exceeds Vercel's serverless timeout)
    const publicIp = extractIPv6(result.server.public_net.ipv6.ip);

    if (!publicIp) {
      // Fallback: poll briefly for IP assignment (shouldn't be needed)
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const info = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
        const polledIp = extractIPv6(info.server.public_net.ipv6.ip);
        if (polledIp) {
          console.log(`[hetzner] Created server ${opts.name} (ID: ${serverId}, IP: ${polledIp})`);
          return { serverId: String(serverId), publicIp: polledIp, createActionId: result.action ? String(result.action.id) : null };
        }
      }
      throw new Error(`[hetzner] Server ${serverId} created but no IP assigned`);
    }

    console.log(`[hetzner] Created server ${opts.name} (ID: ${serverId}, IP: ${publicIp})`);

    // Enable delete + rebuild protection (fire-and-forget — don't block provisioning)
    hetznerFetch(`/servers/${serverId}/actions/change_protection`, {
      method: 'POST',
      body: { delete: true, rebuild: true },
    }).then(() => {
      console.log(`[hetzner] Enabled delete/rebuild protection for server ${serverId}`);
    }).catch((err) => {
      console.warn(`[hetzner] Failed to enable protection for server ${serverId}:`, err);
    });

    return { serverId: String(serverId), publicIp, createActionId: result.action ? String(result.action.id) : null };
  }

  async getActionProgress(actionId: string): Promise<ProviderActionProgress> {
    const result = await hetznerFetch<{ action: HetznerAction }>(`/servers/actions/${actionId}`);
    return {
      status: result.action.status,
      progress: typeof result.action.progress === 'number' ? result.action.progress : null,
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
  async resizeServer(serverId: string, serverType: string): Promise<void> {
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
      body: { server_type: serverType, upgrade_disk: true },
    });
    console.log(`[hetzner] Server ${serverId} type changed to ${serverType}`);

    // 3. Start the server back up
    console.log(`[hetzner] Starting server ${serverId} after resize...`);
    await this.startServer(serverId);
    await waitForServerStatus(Number(serverId), 'running', 120_000);
    console.log(`[hetzner] Server ${serverId} resized to ${serverType} and running`);
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

    return getPlansForRegion(loc).map((tier) => ({
      name: tier.sku,
      description: `${tier.vcpu} vCPU / ${tier.memory} GB RAM / ${tier.disk} GB SSD / ${tier.traffic}`,
      cores: tier.vcpu,
      memory: tier.memory,
      disk: tier.disk,
      cpuType: 'shared' as const,
      architecture: 'x86' as const,
      providerPriceMonthly: tier.providerPriceMonthly,
      priceMonthly: tier.priceMonthly,
      backupPriceMonthly: backupSurcharge(tier.priceMonthly),
      region: loc,
    }));
  }

  async listRegions(): Promise<RegionInfo[]> {
    return HETZNER_REGIONS;
  }

  // ─── Backups ──────────────────────────────────────────────────────────────

  async listBackups(serverId: string): Promise<BackupInfo[]> {
    const data = await hetznerFetch<{ images: HetznerBackup[] }>(`/images?type=backup&sort=created:desc&status=available&per_page=25`);
    // Filter to only backups for this server
    return data.images
      .filter((img) => img.created_from?.id === Number(serverId))
      .map((img) => ({
        id: String(img.id),
        description: img.description || `Backup ${img.id}`,
        created: img.created,
        size: img.image_size ?? 0,
        status: img.status,
      }));
  }

  async createBackup(serverId: string, description?: string): Promise<{ id: string }> {
    const result = await hetznerFetch<{ image: { id: number } }>(`/servers/${serverId}/actions/create_image`, {
      method: 'POST',
      body: { type: 'backup', description: description || `Manual backup` },
    });
    console.log(`[hetzner] Created backup for server ${serverId}: image ${result.image.id}`);
    return { id: String(result.image.id) };
  }

  async enableBackups(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/enable_backup`, { method: 'POST' });
    console.log(`[hetzner] Enabled backups for server ${serverId}`);
  }

  async disableBackups(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/disable_backup`, { method: 'POST' });
    console.log(`[hetzner] Disabled backups for server ${serverId}`);
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

export interface BackupInfo {
  id: string;
  description: string;
  created: string;
  size: number;
  status: string;
}
