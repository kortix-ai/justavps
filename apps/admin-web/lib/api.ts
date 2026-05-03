export type ApiOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  expectedStatus?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export type ApiContext = {
  baseUrl: string;
  token: string;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly path: string, readonly data?: unknown) {
    super(message);
  }
}

function normalizeBase(input: string): string {
  const value = input?.trim() || (typeof window !== 'undefined' ? window.location.origin : '');
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizePath(path: string): string {
  const value = path.startsWith('/') ? path : `/${path}`;
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function api<T = unknown>(ctx: ApiContext, path: string, opts: ApiOptions = {}): Promise<T> {
  const normalizedPath = normalizePath(path);
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && ctx.token) headers.Authorization = `Bearer ${ctx.token}`;

  const response = await fetch(normalizeBase(ctx.baseUrl) + normalizedPath, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (opts.expectedStatus !== undefined) {
    if (response.status !== opts.expectedStatus) {
      throw new ApiError(
        `${opts.method ?? 'GET'} ${normalizedPath} expected ${opts.expectedStatus}, got ${response.status}`,
        response.status,
        normalizedPath,
        data,
      );
    }
    return data as T;
  }

  if (!response.ok) {
    const message =
      (data as { message?: string })?.message ??
      (typeof data === 'string' ? data : `HTTP ${response.status}`);
    throw new ApiError(`${opts.method ?? 'GET'} ${normalizedPath} failed: ${response.status} ${message}`, response.status, normalizedPath, data);
  }

  return data as T;
}

// ─── Domain types ──────────────────────────────────────────────────────────

export type Health = {
  status: string;
  service?: string;
  database_configured?: boolean;
  incus_clusters_configured?: number;
  hetzner_robot_configured?: boolean;
  telemetry?: {
    enabled: boolean;
    driver: 'clickhouse' | 'memory' | 'disabled' | string;
    ingest_reachable_from_sandbox: boolean;
    warnings: string[];
  };
};

export type IncusLinks = { ui_url: string | null; api_url: string | null };

export type ClusterPublic = {
  id: string;
  name: string;
  region: string;
  endpoint: string;
  project: string;
  links?: IncusLinks;
};

export type ClusterRow = ClusterPublic & {
  observed?: { members?: unknown[]; instances?: unknown[]; images?: unknown[] };
};

export type HostMember = {
  cluster: ClusterPublic;
  name: string;
  url: string;
  status: string;
  roles: string[];
  schedulable: boolean;
  links?: IncusLinks;
};

export type InventoryHost = {
  id: string;
  vendor: string;
  providerServerNumber?: string | null;
  hostClass: string;
  region: string;
  location: string;
  name: string;
  status: string;
  schedulable: boolean;
  publicIpv4?: string | null;
  publicIpv6?: string | null;
  incusClusterId?: string | null;
  incusMemberName?: string | null;
  // Fleet-management lifecycle: requested → ordered → delivered →
  // bootstrapping → joining → online ↔ cordoned ↔ draining → terminated.
  // Drives cordon/drain/terminate UI buttons + autoscale eligibility.
  lifecycleState?: string | null;
  rawLifecycleState?: string | null;
  capacityState?: string | null;
  fleetIssue?: string | null;
  clusterConfigured?: boolean;
  bootstrapAddress?: string | null;
  bootstrapAddressFamily?: 'ipv4' | 'ipv6' | string | null;
  sku?: string | null;
  costEurMonthly?: number | string | null;
  metadata?: Record<string, unknown>;
};

export type Machine = {
  id: string;
  slug?: string;
  name: string;
  type: 'container' | string;
  status: string;
  region?: string;
  location?: string | null;
  cluster?: ClusterPublic;
  source?: { type: string; id: string | null } | { type: string };
  resources?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  urls?: {
    proxy?: string;
    terminal?: string;
    port_template?: string;
  };
  incus?: {
    cluster_id?: string;
    project?: string;
    instance_name?: string;
    member_name?: string | null;
    observed?: unknown;
  } & Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type TelemetrySpan = {
  name: string;
  status: 'active' | 'ok' | 'error' | string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  details?: Record<string, unknown>;
  error?: string;
};

export type MachineCreationTrace = {
  id: string;
  kind: 'machine.create' | string;
  status: 'active' | 'ok' | 'error' | string;
  stage: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  labels?: Record<string, unknown>;
  spans: TelemetrySpan[];
  error?: string;
};

export type MachineTelemetryLatest = {
  machine_id: string;
  health: 'healthy' | 'stale' | 'unknown' | string;
  last_seen_at: string | null;
  metrics: Record<string, { value: number; unit: string; timestamp: string }>;
};

export type TelemetryStoreInfo = {
  enabled: boolean;
  driver: 'memory' | 'clickhouse' | 'disabled' | string;
  clickhouse_database?: string;
};

export type MachineTelemetryMetric = {
  timestamp: string;
  machine_id: string;
  name: string;
  value: number;
  unit: string;
  source: string;
  attributes?: Record<string, unknown>;
};

export type MachineTelemetryLog = {
  timestamp: string;
  machine_id?: string;
  severity: string;
  source: string;
  stream: string;
  body: string;
  trace_id?: string;
  span_id?: string;
  attributes?: Record<string, unknown>;
};

export type MachineTelemetryTrace = {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  machine_id?: string;
  operation: string;
  name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  attributes?: Record<string, unknown>;
  error?: string;
};

export type MachineTelemetryEvent = {
  timestamp: string;
  machine_id?: string;
  type: string;
  category: string;
  body: string;
  attributes?: Record<string, unknown>;
};

export type PoolSource = { type: 'image' | 'snapshot' | string; id: string };

export type PoolBilling = {
  mode: 'reserved' | string;
  pool_mode?: 'stopped' | 'running' | string;
  target: number;
  metered_bytes?: number;
  billable_gib?: number;
  measured_instances?: number;
  estimated_instances?: number;
  unmeasured_instances?: number;
  disk_limit_gb_per_instance?: number;
  disk_limit_gb_total_cap?: number;
  running_instances?: number;
  per_instance_eur_month: number;
  total_eur_month: number;
  storage_eur_month?: number;
  hot_resource_eur_month?: number;
  pricing_key?: string;
  pricing_micro_eur_per_sec?: number;
  note?: string;
};

export type PoolPolicy = {
  id: string;
  account_id: string;
  name: string;
  status: 'active' | 'paused' | 'deleted' | string;
  mode?: 'primed_stopped_exact' | 'primed_running_exact' | string;
  pool_mode?: 'stopped' | 'running' | string;
  region: string;
  type: 'container' | string;
  source: PoolSource;
  resources: { vcpu: number; memory_gb: number; disk_gb: number };
  target: number;
  ready: number;
  claiming: number;
  billing: PoolBilling;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PoolAdminMachine = {
  id: string;
  account_id: string;
  status: string;
  region: string;
  type: string;
  source_type: string;
  source_id: string | null;
  resources?: Record<string, unknown>;
  cluster_id?: string;
  member_name?: string | null;
  policy_id?: string | null;
  storage_usage?: Record<string, unknown>;
  updated_at?: string;
};

export type PoolAdminState = {
  enabled: boolean;
  legacy_target?: number;
  policies: PoolPolicy[];
  groups: Array<{ key: string; account_id: string; policy_id: string | null; ready: number; claiming: number; total: number; machines: string[] }>;
  machines: PoolAdminMachine[];
};

export type ProxyToken = {
  id: string;
  token?: string;
  token_prefix: string;
  label: string | null;
  machine_id: string;
  machine_slug: string;
  ports: number[] | null;
  expires_at: string;
  proxy_url?: string;
  created_at: string;
};

export type SshToken = {
  id: string;
  token?: string;
  token_prefix: string;
  label: string | null;
  machine_id: string;
  expires_at: string;
  ssh_command?: string;
  ssh_config?: string;
  target?: {
    host?: string | null;
    port?: number;
    user?: string;
  };
  created_at: string;
};

export type ImageItem = {
  id: string;
  cluster?: ClusterPublic;
  aliases?: Array<{ name: string; description?: string }>;
  fingerprint: string;
  architecture?: string | null;
  type?: string | null;
  public?: boolean;
  size?: number | string | null;
  properties?: Record<string, string>;
  uploaded_at?: string | null;
};

export type ArtifactCostAttribution = {
  account_id?: string;
  machine_id?: string;
  machine_name?: string;
  cluster_id?: string;
  incus_project?: string;
  kind?: 'snapshot' | 'backup' | string;
  storage_class?: 'local' | 'archive' | string;
  metered_bytes?: number;
  billable_gib?: number;
  estimated?: boolean;
  eur_per_month?: number;
  pricing_key?: string;
  pricing_micro_eur_per_sec?: number;
  note?: string;
  components?: Array<{ label: string; metered_bytes: number; billable_gib: number }>;
};

export type SnapshotItem = {
  id?: string;
  name: string;
  created_at?: string;
  stateful?: boolean;
  expires_at?: string | null;
  size?: number;
  account_id?: string;
  machine_id?: string;
  cost_attribution?: ArtifactCostAttribution;
};

export type BackupItem = {
  id?: string;
  name: string;
  incus_backup_name?: string;
  created_at?: string;
  expires_at?: string | null;
  instance_only?: boolean;
  optimized_storage?: boolean;
  size?: number;
  account_id?: string;
  machine_id?: string;
  restore_snapshot?: string;
  cost_attribution?: ArtifactCostAttribution;
};

export type ToolboxRoutes = {
  configured: boolean;
  base_url: string | null;
  terminal_url: string | null;
  opencode_url: string | null;
  health_path: string;
  services_path: string;
  command_path: string;
  proxy_prefix: string;
};
