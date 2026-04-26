export type ApiOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  expectedStatus?: number;
  signal?: AbortSignal;
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

export async function api<T = unknown>(ctx: ApiContext, path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && ctx.token) headers.Authorization = `Bearer ${ctx.token}`;

  const response = await fetch(normalizeBase(ctx.baseUrl) + path, {
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
        `${opts.method ?? 'GET'} ${path} expected ${opts.expectedStatus}, got ${response.status}`,
        response.status,
        path,
        data,
      );
    }
    return data as T;
  }

  if (!response.ok) {
    const message =
      (data as { message?: string })?.message ??
      (typeof data === 'string' ? data : `HTTP ${response.status}`);
    throw new ApiError(`${opts.method ?? 'GET'} ${path} failed: ${response.status} ${message}`, response.status, path, data);
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
};

export type Machine = {
  id: string;
  name: string;
  type: 'container' | 'vm' | string;
  status: string;
  region?: string;
  location?: string | null;
  cluster?: ClusterPublic;
  source?: { type: string; id: string | null } | { type: string };
  resources?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  incus?: {
    cluster_id?: string;
    project?: string;
    instance_name?: string;
    member_name?: string | null;
    observed?: unknown;
  } & Record<string, unknown>;
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
  name: string;
  created_at?: string;
  stateful?: boolean;
  expires_at?: string | null;
  size?: number;
};

export type BackupItem = {
  name: string;
  created_at?: string;
  expires_at?: string | null;
  instance_only?: boolean;
};

export type ProcurementItem = {
  id: string;
  vendor: string;
  productId?: string;
  product_id?: string;
  hostClass: string;
  region: string;
  location: string;
  status: string;
  hostId?: string | null;
  host_id?: string | null;
  request?: unknown;
  result?: unknown;
  createdAt?: string;
  updatedAt?: string;
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
