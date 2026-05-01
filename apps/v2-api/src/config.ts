import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type IncusClusterConfig = {
  id: string;
  name: string;
  region: string;
  endpoint: string;
  project: string;
  rootPool?: string;
  // Local file path on a new member where the ZFS loopback file lives.
  // Used in the join preseed's member_config.storage-pool.source. The
  // existing 2-node hel1 cluster uses /var/lib/incus/disks/zfs-pool.img;
  // hel2-style fresh clusters use /var/lib/incus/disks/default.img.
  storageSource?: string;
  // Optional explicit size for file-backed storage pools on new cluster
  // members. If omitted or set to "auto", the runner
  // computes a size from the target node's actual free disk before joining.
  storageSize?: string;
  // Auto-sizing policy. Incus's interactive default uses 20% of free disk and
  // caps at 30GiB; for sellable hosts we use an explicit percentage and no
  // arbitrary final-size cap.
  storageUsePercent?: number;
  storageMinGiB?: number;
  // Zabbly apt channel new members install Incus from. `stable` shipped
  // 6.23 with a cluster-join regression; `lts-6.0` is the conservative
  // branch that predates that regression and is the default for new clusters.
  incusChannel?: string;
  // Hardware SKU each new member is provisioned as (e.g. "EX44", "AX41-NVMe",
  // "AX162-R"). Used by /admin/economics to look up €/month + per-resource
  // capacity from the SKU catalog. Operators with mixed-SKU clusters can
  // annotate per-member overrides in IncusMember.observed.sku.
  defaultMemberSku?: string;
  clientCert?: string;
  clientKey?: string;
  caCert?: string;
  rejectUnauthorized: boolean;
};

export type AppConfig = {
  port: number;
  adminToken?: string;
  corsOrigins: string[];
  databaseConfigured: boolean;
  clusters: IncusClusterConfig[];
  proxyDomain: string;
  appUrl: string;
  proxyOriginHost?: string;
  daemonDownloadUrl: string;
  daemonLocalPath?: string;
  daemonEnsureWorker: boolean;
  sshGatewayEnabled: boolean;
  sshGatewayHost: string;
  sshGatewayPort: number;
  sshGatewayPublicKey?: string;
  cloudflare?: {
    accountId: string;
    kvNamespaceId: string;
    apiKey: string;
    email: string;
  };
  hetznerRobot?: {
    user: string;
    password: string;
  };
};

function readPem(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN ')) return trimmed;
  return readFileSync(trimmed, 'utf8');
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no'].includes(value.trim().toLowerCase());
}

function numberValue(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function listEnv(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim();
  if (!raw) return fallback;
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

// Exported so admin endpoints can hydrate operator-provided cluster configs
// at runtime (POST /admin/clusters) using the same parsing rules as env.
export function normalizeClusterConfig(raw: Record<string, unknown>): IncusClusterConfig {
  return normalizeCluster(raw);
}

function normalizeCluster(raw: Record<string, unknown>): IncusClusterConfig {
  const endpoint = String(raw.endpoint ?? '').trim();
  if (!endpoint) throw new Error('Incus cluster config missing endpoint');

  const id = String(raw.id ?? raw.name ?? endpoint).trim();
  return {
    id,
    name: String(raw.name ?? id).trim(),
    region: String(raw.region ?? 'eu').trim(),
    endpoint,
    project: String(raw.project ?? 'default').trim(),
    rootPool: typeof raw.rootPool === 'string' && raw.rootPool.trim() ? raw.rootPool.trim() : undefined,
    storageSource: typeof raw.storageSource === 'string' && raw.storageSource.trim() ? raw.storageSource.trim() : undefined,
    storageSize: typeof raw.storageSize === 'string' && raw.storageSize.trim() ? raw.storageSize.trim() : undefined,
    storageUsePercent: numberValue(raw.storageUsePercent, 80),
    storageMinGiB: numberValue(raw.storageMinGiB, 30),
    incusChannel: typeof raw.incusChannel === 'string' && raw.incusChannel.trim() ? raw.incusChannel.trim() : undefined,
    defaultMemberSku: typeof raw.defaultMemberSku === 'string' && raw.defaultMemberSku.trim() ? raw.defaultMemberSku.trim() : undefined,
    clientCert: readPem(typeof raw.clientCert === 'string' ? raw.clientCert : undefined),
    clientKey: readPem(typeof raw.clientKey === 'string' ? raw.clientKey : undefined),
    caCert: readPem(typeof raw.caCert === 'string' ? raw.caCert : undefined),
    rejectUnauthorized: typeof raw.rejectUnauthorized === 'boolean' ? raw.rejectUnauthorized : true,
  };
}

function loadClustersFromJson(): IncusClusterConfig[] | null {
  if (!process.env.INCUS_CLUSTERS_JSON?.trim()) return null;
  const parsed = JSON.parse(process.env.INCUS_CLUSTERS_JSON) as unknown;
  if (!Array.isArray(parsed)) throw new Error('INCUS_CLUSTERS_JSON must be a JSON array');
  return parsed.map((entry) => normalizeCluster(entry as Record<string, unknown>));
}

function loadSingleCluster(): IncusClusterConfig[] {
  if (!process.env.INCUS_ENDPOINT?.trim()) return [];
  return [normalizeCluster({
    id: process.env.INCUS_CLUSTER_ID ?? 'default',
    name: process.env.INCUS_CLUSTER_NAME ?? process.env.INCUS_CLUSTER_ID ?? 'default',
    region: process.env.INCUS_REGION ?? 'eu',
    endpoint: process.env.INCUS_ENDPOINT,
    project: process.env.INCUS_PROJECT ?? 'default',
    rootPool: process.env.INCUS_ROOT_POOL,
    storageSource: process.env.INCUS_STORAGE_SOURCE,
    storageSize: process.env.INCUS_STORAGE_SIZE,
    storageUsePercent: process.env.INCUS_STORAGE_USE_PERCENT,
    storageMinGiB: process.env.INCUS_STORAGE_MIN_GIB,
    incusChannel: process.env.INCUS_CHANNEL,
    clientCert: process.env.INCUS_CLIENT_CERT,
    clientKey: process.env.INCUS_CLIENT_KEY,
    caCert: process.env.INCUS_CA_CERT,
    rejectUnauthorized: boolEnv(process.env.INCUS_TLS_REJECT_UNAUTHORIZED, true),
  })];
}

function discoverLocalDaemonPath(): string | undefined {
  const explicit = process.env.V2_DAEMON_LOCAL_PATH?.trim();
  if (explicit) return explicit;
  const candidates = [
    resolve(process.cwd(), 'apps/daemon/bin/justavps-daemon-linux-amd64'),
    resolve(process.cwd(), '../daemon/bin/justavps-daemon-linux-amd64'),
    resolve(process.cwd(), '../../apps/daemon/bin/justavps-daemon-linux-amd64'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function loadConfig(): AppConfig {
  if (process.env.V2_DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.V2_DATABASE_URL;
  }

  const robotUser = process.env.HETZNER_ROBOT_USER?.trim() ?? '';
  const robotPassword = process.env.HETZNER_ROBOT_PASSWORD?.trim() ?? '';
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const cfKvNamespaceId = process.env.CF_KV_NAMESPACE_ID?.trim() ?? '';
  const cfApiKey = (process.env.CLOUDFLARE_GLOBAL_API_KEY ?? process.env.CLOUDFLARE_API_KEY ?? '').trim();
  const cfEmail = process.env.CLOUDFLARE_EMAIL?.trim() ?? '';
  const daemonChannel = (process.env.V2_DAEMON_CHANNEL ?? process.env.DAEMON_CHANNEL ?? 'dev').trim();
  const daemonPrefix = daemonChannel === 'dev' ? 'daemon/dev/latest' : 'daemon/latest';

  return {
    port: Number(process.env.V2_API_PORT || 4200),
    adminToken: process.env.V2_ADMIN_TOKEN?.trim() || undefined,
    corsOrigins: listEnv(process.env.V2_CORS_ORIGINS ?? process.env.V2_CORS_ORIGIN, [
      'http://localhost:4100',
      'http://127.0.0.1:4100',
      'http://localhost:4300',
      'http://127.0.0.1:4300',
    ]),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    clusters: loadClustersFromJson() ?? loadSingleCluster(),
    // Legacy/optional proxy domain. The primary V2 dev proxy is served directly
    // by v2-api using host-based localhost URLs, not Cloudflare Worker routing.
    proxyDomain: (process.env.V2_PROXY_DOMAIN ?? process.env.NEXT_PUBLIC_PROXY_DOMAIN ?? 'kortix-dev.cloud').trim(),
    appUrl: (process.env.V2_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? `http://localhost:${Number(process.env.V2_API_PORT || 4200)}`).trim(),
    proxyOriginHost: (process.env.V2_PROXY_ORIGIN_HOST ?? process.env.PROXY_ORIGIN_HOST ?? '').trim() || undefined,
    daemonDownloadUrl: (process.env.V2_DAEMON_DOWNLOAD_URL ?? process.env.DAEMON_URL ?? `https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/${daemonPrefix}/justavps-daemon-linux-amd64`).trim(),
    daemonLocalPath: discoverLocalDaemonPath(),
    daemonEnsureWorker: boolEnv(process.env.V2_DAEMON_ENSURE_WORKER, true),
    sshGatewayEnabled: boolEnv(process.env.V2_SSH_GATEWAY_ENABLED ?? process.env.V2_SSH_ACCESS_ENABLED, false),
    sshGatewayHost: (process.env.V2_SSH_GATEWAY_HOST ?? 'localhost').trim(),
    sshGatewayPort: Number(process.env.V2_SSH_GATEWAY_PORT || 2222),
    sshGatewayPublicKey: (process.env.V2_SSH_GATEWAY_PUBLIC_KEY ?? '').trim() || undefined,
    cloudflare: cfAccountId && cfKvNamespaceId && cfApiKey && cfEmail
      ? { accountId: cfAccountId, kvNamespaceId: cfKvNamespaceId, apiKey: cfApiKey, email: cfEmail }
      : undefined,
    hetznerRobot: robotUser && robotPassword
      ? { user: robotUser, password: robotPassword }
      : undefined,
  };
}
