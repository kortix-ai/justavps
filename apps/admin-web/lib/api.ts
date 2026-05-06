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
  account_id?: string;
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

export type BackupPolicy = {
  id: string | null;
  account_id: string;
  machine_id: string;
  enabled: boolean;
  cadence: 'daily' | string;
  interval_hours: number;
  retention_days: number;
  retention_count: number;
  last_backup_at: string | null;
  next_backup_at: string | null;
  status: string;
  policy_label: string;
};

export type AccountMember = {
  id: string;
  role: 'owner' | 'admin' | 'member' | string;
  user_id: string;
  email: string;
  name?: string | null;
  is_admin?: boolean;
  created_at?: string;
};

export type AccountInvitation = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | string;
  token?: string;
  expires_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  created_at?: string;
};

export type Account = {
  id: string;
  type: 'personal' | 'organization' | string;
  name: string;
  slug: string;
  personal_for_user_id?: string | null;
  billing_email?: string | null;
  stripe_customer_id?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  members: AccountMember[];
  invitations: AccountInvitation[];
  counts?: { members: number; machines: number; auto_backup_policies: number; auto_backup_enabled: number };
};

export type BillingStatement = {
  account: { id: string; name: string; slug: string; type: string };
  window: { from: string; to: string; as_of: string; finalized_through: string };
  currency: string;
  price_version?: { id: string; code: string };
  actual_mtd: { micro_eur: string; eur: number };
  unfinalized_current_hour: { included: boolean; micro_eur: string; eur: number };
  components: Array<{ key: string; label: string; quantity: number; quantity_unit: string; micro_eur: string; eur: number }>;
  sources: Array<{ source_type: string; source_id: string; machine_id?: string | null; name?: string | null; micro_eur: string; eur: number; components: string[] }>;
  hourly: Array<{ hour: string; micro_eur: string; eur: number; components: Record<string, number> }>;
  coverage: {
    status: 'complete' | 'partial' | string;
    accuracy_model?: string;
    missing_hours: string[];
    unmeasured_sources: Array<{ source_type: string; source_id: string; reason: string }>;
    warnings: string[];
  };
};

export type BillingLedgerEntry = {
  id: string;
  account_id: string;
  machine_id?: string | null;
  source_type: string;
  source_id: string;
  component: string;
  region?: string | null;
  interval_start: string;
  interval_end: string;
  quantity: string;
  quantity_unit: string;
  rate_micro_eur_per_unit: string;
  price_version_id: string;
  micro_eur: string;
  eur: number;
  status: string;
  measurement_source: string;
  measurement_exact: boolean;
  metadata?: Record<string, unknown>;
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

export type MachineTemplate = {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  status: 'preparing' | 'active' | 'failed' | 'archived' | 'deleted' | string;
  visibility: 'catalog' | 'private' | string;
  region: string;
  type: 'container' | string;
  default_resources: { vcpu: number; memory_gb: number; disk_gb: number };
  source?: { type?: string; ref?: string | null };
  image?: {
    alias?: string;
    fingerprint?: string;
    cluster_id?: string;
    project?: string;
    size?: number | string | null;
    aliases?: Array<{ name: string; description?: string }>;
    properties?: Record<string, string>;
  };
  readiness?: {
    ready?: boolean;
    daemon_baked?: boolean;
    daemon_first_boot_verified?: boolean;
    daemon_second_boot_verified?: boolean;
    prepared_at?: string | null;
    verified_at?: string | null;
  };
  storage?: {
    metered_bytes?: number | null;
    billable_gib?: number | null;
    source?: string;
    estimated?: boolean;
    note?: string;
  };
  pool?: PoolPolicy | null;
  pools?: {
    stopped?: PoolPolicy | null;
    running?: PoolPolicy | null;
  };
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
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

export type SnapshotItem = {
  id?: string;
  name: string;
  created_at?: string;
  stateful?: boolean;
  expires_at?: string | null;
  size?: number;
  metered_bytes?: number;
  billable_gib?: number;
  account_id?: string;
  machine_id?: string;
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
  metered_bytes?: number;
  billable_gib?: number;
  storage_components?: Array<{ label: string; metered_bytes: number; billable_gib: number }>;
  account_id?: string;
  machine_id?: string;
  trigger?: 'manual' | 'auto' | string;
  policy_id?: string | null;
  restore_snapshot?: string;
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
