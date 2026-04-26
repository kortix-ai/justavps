import { readFileSync } from 'node:fs';

export type IncusClusterConfig = {
  id: string;
  name: string;
  region: string;
  endpoint: string;
  project: string;
  rootPool?: string;
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

function listEnv(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim();
  if (!raw) return fallback;
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
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
    clientCert: process.env.INCUS_CLIENT_CERT,
    clientKey: process.env.INCUS_CLIENT_KEY,
    caCert: process.env.INCUS_CA_CERT,
    rejectUnauthorized: boolEnv(process.env.INCUS_TLS_REJECT_UNAUTHORIZED, true),
  })];
}

export function loadConfig(): AppConfig {
  if (process.env.V2_DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.V2_DATABASE_URL;
  }

  const robotUser = process.env.HETZNER_ROBOT_USER?.trim() ?? '';
  const robotPassword = process.env.HETZNER_ROBOT_PASSWORD?.trim() ?? '';

  return {
    port: Number(process.env.V2_API_PORT || 4200),
    adminToken: process.env.V2_ADMIN_TOKEN?.trim() || undefined,
    corsOrigins: listEnv(process.env.V2_CORS_ORIGINS ?? process.env.V2_CORS_ORIGIN, ['http://localhost:4100', 'http://127.0.0.1:4100']),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    clusters: loadClustersFromJson() ?? loadSingleCluster(),
    hetznerRobot: robotUser && robotPassword
      ? { user: robotUser, password: robotPassword }
      : undefined,
  };
}
