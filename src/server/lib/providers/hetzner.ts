import { config } from '../config';
import type {
  ComputeProvider,
  CreateServerOpts,
  ServerResult,
  ServerTypeInfo,
  RegionInfo,
  SSHKeyResult,
} from './types';

const HETZNER_API = 'https://api.hetzner.cloud/v1';
const API_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 3_000;

/**
 * ═══ PLAN TIERS — single source of truth ═══
 *
 * Canonical customer-facing specs & pricing.  Both EU and US show
 * identical plans; the underlying Hetzner SKU differs per region.
 *
 * EU uses one-tier-up CPX so customers always get ≥ advertised specs
 * (e.g. EU cpx32 = 3 vCPU / 4 GB — we advertise 2 vCPU / 4 GB, they
 * get *more* CPU than promised).
 *
 *   Plan       vCPU   RAM    SSD     Price    EU SKU    US SKU
 *   ────────   ────   ────   ─────   ──────   ───────   ──────
 *   Starter      2    4 GB    80 GB   $15/mo   cpx32    cpx11
 *   Pro          4    8 GB   160 GB   $27/mo   cpx42    cpx21
 *   Power        8   16 GB   320 GB   $49/mo   cpx52    cpx31
 *   Ultra       16   32 GB   640 GB   $97/mo   cpx62    cpx41
 */
export const PLAN_TIERS = [
  { vcpu: 2,  memory: 4,  disk: 80,  price: 15, sku: { hel1: 'cpx32', nbg1: 'cpx32', hil: 'cpx11' } as Record<string, string> },
  { vcpu: 4,  memory: 8,  disk: 160, price: 27, sku: { hel1: 'cpx42', nbg1: 'cpx42', hil: 'cpx21' } as Record<string, string> },
  { vcpu: 8,  memory: 16, disk: 320, price: 49, sku: { hel1: 'cpx52', nbg1: 'cpx52', hil: 'cpx31' } as Record<string, string> },
  { vcpu: 16, memory: 32, disk: 640, price: 97, sku: { hel1: 'cpx62', nbg1: 'cpx62', hil: 'cpx41' } as Record<string, string> },
];

/**
 * Get the plan tier index for a given SKU across any region.
 * Returns -1 if not found.
 */
export function getPlanTierIndex(sku: string): number {
  return PLAN_TIERS.findIndex((tier) =>
    Object.values(tier.sku).includes(sku),
  );
}

/**
 * Get the plan tier for a given SKU.
 */
export function getPlanTier(sku: string) {
  return PLAN_TIERS[getPlanTierIndex(sku)] ?? null;
}

interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  prices: Array<{
    location: string;
    price_hourly: { net: string; gross: string };
    price_monthly: { net: string; gross: string };
  }>;
  cpu_type: 'shared' | 'dedicated';
  architecture: 'x86' | 'arm';
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

interface HetznerImage {
  id: number;
  description: string | null;
  status: string;
  created?: string;
  architecture: 'x86' | 'arm' | string;
  disk_size: number;
}

const HETZNER_REGIONS: RegionInfo[] = [
  { id: 'hel1', name: 'EU-Central', country: 'EU', city: 'Europe' },
  { id: 'hil', name: 'US-West', country: 'US', city: 'United States' },
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

export class HetznerProvider implements ComputeProvider {
  readonly name = 'cloud' as const;
  readonly displayName = 'JustAVPS Cloud';

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
    const body: Record<string, unknown> = {
      name: opts.name,
      server_type: opts.serverType,
      image: isNaN(Number(opts.image)) ? opts.image : parseInt(opts.image, 10),
      location: opts.region,
      start_after_create: true,
      user_data: opts.userData,
      labels: opts.labels,
      automount: false,
      public_net: { enable_ipv4: true, enable_ipv6: false },
    };

    if (opts.enableBackups) body.enable_backup = true;
    if (opts.sshKeyIds.length > 0) body.ssh_keys = opts.sshKeyIds.map(Number);

    const result = await hetznerFetch<{ server: HetznerServer }>('/servers', {
      method: 'POST',
      body,
    });

    const serverId = result.server.id;
    // IP is assigned immediately at creation — don't wait for "running" status
    // (waiting takes 60-90s on snapshot boot, which exceeds Vercel's serverless timeout)
    const publicIp = result.server.public_net.ipv4.ip;

    if (!publicIp) {
      // Fallback: poll briefly for IP assignment (shouldn't be needed)
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const info = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
        if (info.server.public_net.ipv4.ip) {
          console.log(`[hetzner] Created server ${opts.name} (ID: ${serverId}, IP: ${info.server.public_net.ipv4.ip})`);
          return { serverId: String(serverId), publicIp: info.server.public_net.ipv4.ip };
        }
      }
      throw new Error(`[hetzner] Server ${serverId} created but no IP assigned`);
    }

    console.log(`[hetzner] Created server ${opts.name} (ID: ${serverId}, IP: ${publicIp})`);
    return { serverId: String(serverId), publicIp };
  }

  async deleteServer(serverId: string): Promise<void> {
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
    await hetznerFetch(`/ssh_keys/${keyId}`, { method: 'DELETE' });
  }

  async listServerTypes(region: string): Promise<ServerTypeInfo[]> {
    const loc = region || config.HETZNER_DEFAULT_LOCATION;

    // Collect the Hetzner SKU names we need for this region
    const skuNames = PLAN_TIERS.map((t) => t.sku[loc]).filter(Boolean);

    // Fetch Hetzner server types for provider-cost tracking only
    const data = await hetznerFetch<{ server_types: HetznerServerType[] }>('/server_types?per_page=50');
    const providerCosts: Record<string, number> = {};
    for (const st of data.server_types) {
      if (!skuNames.includes(st.name)) continue;
      const locPrice = st.prices.find((p) => p.location === loc);
      if (locPrice) providerCosts[st.name] = parseFloat(locPrice.price_monthly.gross);
    }

    // Return canonical plan definitions — specs & prices are region-independent
    // Hetzner charges 20% of the server price for backups
    return PLAN_TIERS
      .filter((tier) => tier.sku[loc])
      .map((tier) => {
        const skuName = tier.sku[loc];
        const providerPrice = providerCosts[skuName] ?? 0;
        return {
          name: skuName,
          description: `${tier.vcpu} vCPU / ${tier.memory} GB RAM / ${tier.disk} GB SSD`,
          cores: tier.vcpu,
          memory: tier.memory,
          disk: tier.disk,
          cpuType: 'shared' as const,
          architecture: 'x86' as const,
          providerPriceMonthly: providerPrice,
          priceMonthly: tier.price,
          backupPriceMonthly: Math.round(providerPrice * 0.2 * 100) / 100,
          region: loc,
        };
      });
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
