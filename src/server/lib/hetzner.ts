/**
 * Hetzner Cloud API client.
 * Lifted + adapted from computer/kortix-api/src/platform/providers/hetzner.ts
 */

import { config } from './config';

const HETZNER_API = 'https://api.hetzner.cloud/v1';
const API_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 3_000;

const ALLOWED_SERVER_TYPE_PREFIXES = ['cx', 'ccx', 'cpx', 'cax'];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HetznerServerType {
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
  created?: string;
  architecture: 'x86' | 'arm' | string;
  disk_size: number;
}

// ─── Snapshot Cache ─────────────────────────────────────────────────────────

let snapshotCache: {
  snapshotId: string;
  description: string | null;
  diskSize: number;
  architecture: string;
  fetchedAt: number;
} | null = null;

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

/** Reset snapshot cache — for testing only. */
export function _resetSnapshotCache() {
  snapshotCache = null;
}

// ─── API Helper ─────────────────────────────────────────────────────────────

async function hetznerFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${config.HETZNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hetzner API ${options.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ─── Client ─────────────────────────────────────────────────────────────────

export const hetznerClient = {
  /**
   * Find the JustAVPS base snapshot by description pattern.
   */
  async resolveSnapshot(): Promise<{ snapshotId: string; diskSize: number; architecture: string }> {
    const now = Date.now();
    if (snapshotCache && now - snapshotCache.fetchedAt < SNAPSHOT_TTL_MS) {
      return snapshotCache;
    }

    const data = await hetznerFetch<{ images: HetznerImage[] }>('/images?type=snapshot&per_page=50');
    const snapshots = data.images
      .filter((img) => img.description?.startsWith('justavps-base-'))
      .sort((a, b) => Date.parse(b.created || '') - Date.parse(a.created || ''));

    if (snapshots.length === 0) {
      // Fallback: use ubuntu-24.04 as base image (slower provisioning, full cloud-init)
      console.warn('[HETZNER] No justavps-base-* snapshot found, falling back to ubuntu-24.04');
      return { snapshotId: 'ubuntu-24.04', diskSize: 20, architecture: 'x86' };
    }

    snapshotCache = {
      snapshotId: String(snapshots[0].id),
      description: snapshots[0].description,
      diskSize: snapshots[0].disk_size,
      architecture: snapshots[0].architecture,
      fetchedAt: now,
    };

    return snapshotCache;
  },

  /**
   * Create a Hetzner server.
   */
  async createServer(opts: {
    name: string;
    serverType: string;
    image: string;
    location: string;
    userData: string;
    sshKeyIds: number[];
    labels: Record<string, string>;
    firewallId?: number;
    enableBackups?: boolean;
  }): Promise<{ serverId: number; publicIp: string }> {
    const body: Record<string, unknown> = {
      name: opts.name,
      server_type: opts.serverType,
      image: isNaN(Number(opts.image)) ? opts.image : parseInt(opts.image, 10),
      location: opts.location,
      start_after_create: true,
      user_data: opts.userData,
      labels: opts.labels,
      automount: false,
    };

    if (opts.enableBackups) {
      body.enable_backup = true;
    }
    if (opts.sshKeyIds.length > 0) {
      body.ssh_keys = opts.sshKeyIds;
    }
    if (opts.firewallId) {
      body.firewalls = [{ firewall: opts.firewallId }];
    }

    const result = await hetznerFetch<{ server: HetznerServer }>('/servers', {
      method: 'POST',
      body,
    });

    const serverId = result.server.id;

    // Wait for server to reach "running" state
    await this.waitForStatus(serverId, 'running');

    // Re-fetch to get assigned IP
    const info = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
    const publicIp = info.server.public_net.ipv4.ip;

    console.log(`[HETZNER] Created server ${opts.name} (ID: ${serverId}, IP: ${publicIp})`);

    return { serverId, publicIp };
  },

  /**
   * Delete a Hetzner server.
   */
  async deleteServer(serverId: number): Promise<void> {
    await hetznerFetch(`/servers/${serverId}`, { method: 'DELETE' });
    console.log(`[HETZNER] Deleted server ${serverId}`);
  },

  /**
   * Reboot a Hetzner server.
   */
  async rebootServer(serverId: number): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/reboot`, { method: 'POST' });
    console.log(`[HETZNER] Rebooted server ${serverId}`);
  },

  /**
   * Resize a Hetzner server to a different type.
   */
  async resizeServer(serverId: number, serverType: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/change_type`, {
      method: 'POST',
      body: { server_type: serverType, upgrade_disk: true },
    });
    console.log(`[HETZNER] Resizing server ${serverId} to ${serverType}`);
  },

  /**
   * Power on a Hetzner server.
   */
  async startServer(serverId: number): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/poweron`, { method: 'POST' });
  },

  /**
   * Power off a Hetzner server.
   */
  async stopServer(serverId: number): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/poweroff`, { method: 'POST' });
  },

  /**
   * Get server status from Hetzner.
   */
  async getServerStatus(serverId: number): Promise<string> {
    const data = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
    return data.server.status;
  },

  /**
   * List available server types with pricing for a location.
   */
  async listServerTypes(location?: string): Promise<Array<{
    name: string;
    description: string;
    cores: number;
    memory: number;
    disk: number;
    cpuType: 'shared' | 'dedicated';
    architecture: 'x86' | 'arm';
    priceMonthlyHetzner: number;
    priceMonthlyOurs: number;
    location: string;
  }>> {
    const loc = location || config.HETZNER_DEFAULT_LOCATION;
    const snapshot = await this.resolveSnapshot();
    const data = await hetznerFetch<{ server_types: HetznerServerType[] }>('/server_types?per_page=50');

    const markup = config.COMPUTE_MARKUP;

    return data.server_types
      .filter((st) => ALLOWED_SERVER_TYPE_PREFIXES.some((p) => st.name.startsWith(p)))
      .filter((st) => st.prices.some((p) => p.location === loc))
      .filter((st) => st.disk >= snapshot.diskSize)
      .filter((st) => {
        if (snapshot.architecture === 'x86') return st.architecture === 'x86';
        if (snapshot.architecture === 'arm') return st.architecture === 'arm';
        return true;
      })
      .map((st) => {
        const locPrice = st.prices.find((p) => p.location === loc)!;
        const hetznerMonthly = parseFloat(locPrice.price_monthly.gross);
        return {
          name: st.name,
          description: st.description,
          cores: st.cores,
          memory: st.memory,
          disk: st.disk,
          cpuType: st.cpu_type,
          architecture: st.architecture as 'x86' | 'arm',
          priceMonthlyHetzner: hetznerMonthly,
          priceMonthlyOurs: Math.ceil(hetznerMonthly * markup),
          location: loc,
        };
      })
      .sort((a, b) => a.priceMonthlyHetzner - b.priceMonthlyHetzner);
  },

  /**
   * Upload an SSH key to Hetzner.
   */
  async uploadSSHKey(name: string, publicKey: string): Promise<{ keyId: number }> {
    const result = await hetznerFetch<{ ssh_key: { id: number } }>('/ssh_keys', {
      method: 'POST',
      body: { name, public_key: publicKey },
    });
    return { keyId: result.ssh_key.id };
  },

  /**
   * Delete an SSH key from Hetzner.
   */
  async deleteSSHKey(keyId: number): Promise<void> {
    await hetznerFetch(`/ssh_keys/${keyId}`, { method: 'DELETE' });
  },

  // ─── Private ────────────────────────────────────────────────────────────

  async waitForStatus(serverId: number, target: string, timeoutMs = PROVISION_TIMEOUT_MS): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const data = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
      if (data.server.status === target) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`[HETZNER] Server ${serverId} did not reach '${target}' within ${timeoutMs / 1000}s`);
  },
};
