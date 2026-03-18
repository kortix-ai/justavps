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

// Only CPX (shared AMD) types — curated list per region
const ALLOWED_TYPES_BY_REGION: Record<string, string[]> = {
  hel1: ['cpx22', 'cpx32', 'cpx42', 'cpx52', 'cpx62'],
  nbg1: ['cpx22', 'cpx32', 'cpx42', 'cpx52', 'cpx62'],
  hil:  ['cpx11', 'cpx21', 'cpx31', 'cpx41'],
};

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
  { id: 'hel1', name: 'EU-Central', country: 'FI', city: 'Helsinki' },
  { id: 'hil', name: 'US-West', country: 'US', city: 'Hillsboro, OR' },
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
  readonly name = 'hetzner' as const;
  readonly displayName = 'Hetzner Cloud';

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
    await hetznerFetch(`/images/${imageId}`, { method: 'DELETE' });
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
    };

    if (opts.enableBackups) body.enable_backup = true;
    if (opts.sshKeyIds.length > 0) body.ssh_keys = opts.sshKeyIds.map(Number);

    const result = await hetznerFetch<{ server: HetznerServer }>('/servers', {
      method: 'POST',
      body,
    });

    const serverId = result.server.id;
    await waitForServerStatus(serverId, 'running');

    const info = await hetznerFetch<{ server: HetznerServer }>(`/servers/${serverId}`);
    const publicIp = info.server.public_net.ipv4.ip;

    console.log(`[hetzner] Created server ${opts.name} (ID: ${serverId}, IP: ${publicIp})`);

    return { serverId: String(serverId), publicIp };
  }

  async deleteServer(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}`, { method: 'DELETE' });
    console.log(`[hetzner] Deleted server ${serverId}`);
  }

  async startServer(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/poweron`, { method: 'POST' });
  }

  async stopServer(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/poweroff`, { method: 'POST' });
  }

  async rebootServer(serverId: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/reboot`, { method: 'POST' });
    console.log(`[hetzner] Rebooted server ${serverId}`);
  }

  async resizeServer(serverId: string, serverType: string): Promise<void> {
    await hetznerFetch(`/servers/${serverId}/actions/change_type`, {
      method: 'POST',
      body: { server_type: serverType, upgrade_disk: true },
    });
    console.log(`[hetzner] Resizing server ${serverId} to ${serverType}`);
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
    const data = await hetznerFetch<{ server_types: HetznerServerType[] }>('/server_types?per_page=50');
    const markup = config.COMPUTE_MARKUP;

    return data.server_types
      .filter((st) => (ALLOWED_TYPES_BY_REGION[loc] ?? []).includes(st.name))
      .filter((st) => st.prices.some((p) => p.location === loc))
      .map((st) => {
        const locPrice = st.prices.find((p) => p.location === loc)!;
        const providerMonthly = parseFloat(locPrice.price_monthly.gross);
        return {
          name: st.name,
          description: st.description,
          cores: st.cores,
          memory: st.memory,
          disk: st.disk,
          cpuType: st.cpu_type,
          architecture: st.architecture as 'x86' | 'arm',
          providerPriceMonthly: providerMonthly,
          priceMonthly: Math.ceil(providerMonthly * markup),
          region: loc,
        };
      })
      .sort((a, b) => a.providerPriceMonthly - b.providerPriceMonthly);
  }

  async listRegions(): Promise<RegionInfo[]> {
    return HETZNER_REGIONS;
  }
}
