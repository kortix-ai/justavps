import { config } from '../config';
import type {
  ComputeProvider,
  CreateServerOpts,
  ServerResult,
  ServerTypeInfo,
  RegionInfo,
  ProviderSnapshot,
  SSHKeyResult,
} from './types';

const HETZNER_API = 'https://api.hetzner.cloud/v1';
const API_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 3_000;
const BUILDER_TIMEOUT_MS = 1_200_000;
const BUILDER_POLL_MS = 15_000;

const ALLOWED_SERVER_TYPE_PREFIXES = ['cx', 'ccx', 'cpx', 'cax'];

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
  { id: 'hel1', name: 'Helsinki, Finland', country: 'FI', city: 'Helsinki' },
  { id: 'nbg1', name: 'Nuremberg, Germany', country: 'DE', city: 'Nuremberg' },
  { id: 'fsn1', name: 'Falkenstein, Germany', country: 'DE', city: 'Falkenstein' },
  { id: 'ash', name: 'Ashburn, USA (East)', country: 'US', city: 'Ashburn' },
  { id: 'hil', name: 'Hillsboro, USA (West)', country: 'US', city: 'Hillsboro' },
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

async function waitForSnapshotReady(imageId: number, timeoutMs = PROVISION_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await hetznerFetch<{ image: HetznerImage }>(`/images/${imageId}`);
    if (data.image.status === 'available') return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[hetzner] Snapshot ${imageId} did not become available within ${timeoutMs / 1000}s`);
}

export class HetznerProvider implements ComputeProvider {
  readonly name = 'hetzner' as const;
  readonly displayName = 'Hetzner Cloud';

  private async validateDockerImage(dockerImage: string): Promise<void> {
    const [org, rest] = dockerImage.includes('/') ? dockerImage.split('/') : ['library', dockerImage];
    const [repo, tag] = rest.includes(':') ? rest.split(':') : [rest, 'latest'];
    const hubUrl = org === 'library'
      ? `https://hub.docker.com/v2/repositories/library/${repo}/tags/${tag}`
      : `https://hub.docker.com/v2/repositories/${org}/${repo}/tags/${tag}`;

    const hubCheck = await fetch(hubUrl).catch(() => null);
    if (!hubCheck?.ok) {
      throw new Error(`Docker image '${dockerImage}' not found on Docker Hub`);
    }
  }

  private buildBuilderUserData(dockerImage: string): string {
    return `#!/bin/bash
set -e
# Disable forced root password change on first login
chage -d 99999 root 2>/dev/null || true
sed -i 's/^root:.*$/root:*:19000:0:99999:7:::/' /etc/shadow 2>/dev/null || true
apt-get update -qq
apt-get install -y -qq ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io
docker pull ${dockerImage}
docker tag ${dockerImage} justavps-image:latest
shutdown -h now
`;
  }

  private async createBuilderServer(dockerImage: string): Promise<number> {
    const userData = this.buildBuilderUserData(dockerImage);
    const builderName = `justavps-builder-${Date.now()}`;
    const serverResp = await hetznerFetch<{ server: HetznerServer }>('/servers', {
      method: 'POST',
      body: {
        name: builderName,
        server_type: 'cx23',
        image: 'ubuntu-24.04',
        location: 'nbg1',
        user_data: userData,
        public_net: { enable_ipv4: true, enable_ipv6: false },
        labels: { justavps: 'true', role: 'snapshot-builder' },
      },
    });
    return serverResp.server.id;
  }

  private async waitForBuilderPowerOff(builderId: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < BUILDER_TIMEOUT_MS) {
      const data = await hetznerFetch<{ server: HetznerServer }>(`/servers/${builderId}`);
      if (data.server.status === 'off') return;
      await new Promise((r) => setTimeout(r, BUILDER_POLL_MS));
    }
    throw new Error(`[hetzner] Builder server did not power off within ${BUILDER_TIMEOUT_MS / 1000}s`);
  }

  private async createSnapshotFromBuilder(builderId: number, description: string): Promise<ProviderSnapshot> {
    const snapResp = await hetznerFetch<{ image: HetznerImage }>(
      `/servers/${builderId}/actions/create_image`,
      { method: 'POST', body: { type: 'snapshot', description } },
    );
    const snapshotId = snapResp.image.id;

    await waitForSnapshotReady(snapshotId);
    const finalSnap = await hetznerFetch<{ image: HetznerImage }>(`/images/${snapshotId}`);

    console.log(`[hetzner] Snapshot ready: id=${snapshotId} desc=${description}`);

    return {
      snapshotId: String(snapshotId),
      diskSize: finalSnap.image.disk_size,
      architecture: finalSnap.image.architecture,
    };
  }

  async buildSnapshot(
    dockerImage: string,
    opts?: { description?: string },
  ): Promise<ProviderSnapshot> {
    const description = opts?.description || `justavps-img-${Date.now()}`;

    await this.validateDockerImage(dockerImage);

    const builderId = await this.createBuilderServer(dockerImage);
    console.log(`[hetzner] Snapshot builder started: server ${builderId} for image ${dockerImage}`);

    try {
      await this.waitForBuilderPowerOff(builderId);
      console.log(`[hetzner] Builder powered off, creating snapshot...`);
      return await this.createSnapshotFromBuilder(builderId, description);
    } finally {
      await hetznerFetch(`/servers/${builderId}`, { method: 'DELETE' }).catch((err) => {
        console.error(`[hetzner] Failed to delete builder server ${builderId}:`, err);
      });
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    await hetznerFetch(`/images/${snapshotId}`, { method: 'DELETE' });
    console.log(`[hetzner] Deleted snapshot ${snapshotId}`);
  }

  async createServer(opts: CreateServerOpts): Promise<ServerResult> {
    const body: Record<string, unknown> = {
      name: opts.name,
      server_type: opts.serverType,
      image: isNaN(Number(opts.snapshotId)) ? opts.snapshotId : parseInt(opts.snapshotId, 10),
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

  async listServerTypes(region: string, snapshot?: ProviderSnapshot): Promise<ServerTypeInfo[]> {
    const loc = region || config.HETZNER_DEFAULT_LOCATION;
    const data = await hetznerFetch<{ server_types: HetznerServerType[] }>('/server_types?per_page=50');
    const markup = config.COMPUTE_MARKUP;

    return data.server_types
      .filter((st) => ALLOWED_SERVER_TYPE_PREFIXES.some((p) => st.name.startsWith(p)))
      .filter((st) => st.prices.some((p) => p.location === loc))
      .filter((st) => !snapshot || st.disk >= snapshot.diskSize)
      .filter((st) => {
        if (!snapshot) return true;
        if (snapshot.architecture === 'x86') return st.architecture === 'x86';
        if (snapshot.architecture === 'arm') return st.architecture === 'arm';
        return true;
      })
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
