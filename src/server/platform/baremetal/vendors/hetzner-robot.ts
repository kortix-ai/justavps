import { config } from "@/server/core/config";

const HETZNER_ROBOT_API = 'https://robot-ws.your-server.de';

function basicAuthHeader(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

const SSH_KEY_TYPES = new Set([
  'ssh-rsa',
  'ssh-dss',
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ssh-ed25519@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com',
]);

/**
 * Validate + normalize an OpenSSH public key string to `<type> <base64> [comment]`.
 * Catches common env-var corruption (backslash-escaped spaces, quote wrapping,
 * trailing newlines) before it reaches Hetzner with a cryptic 400.
 */
export function normalizeSshPublicKey(raw: string): string {
  if (!raw) throw new Error('SSH public key is empty');
  let value = raw.trim();
  // Strip surrounding quotes (common when pasted from an env file).
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  // Unescape shell-escaped spaces (from `printf '%q'` or similar).
  value = value.replace(/\\ /g, ' ');
  // Collapse any internal newlines / tabs that shouldn't be there.
  if (/[\n\r\t]/.test(value)) {
    throw new Error('SSH public key contains newline/tab characters; expected single-line format');
  }
  const parts = value.split(/\s+/);
  if (parts.length < 2) {
    throw new Error(`SSH public key is malformed: expected '<type> <base64> [comment]', got ${JSON.stringify(raw.slice(0, 40))}…`);
  }
  const [type, base64, ...commentParts] = parts;
  if (!SSH_KEY_TYPES.has(type)) {
    throw new Error(`SSH public key has unsupported type '${type}' — expected one of ${[...SSH_KEY_TYPES].slice(0, 3).join(', ')}, …`);
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    throw new Error('SSH public key base64 body contains invalid characters');
  }
  const comment = commentParts.join(' ').trim();
  return comment ? `${type} ${base64} ${comment}` : `${type} ${base64}`;
}

interface HetznerRobotProduct {
  product: {
    id: string;
    name: string;
    description?: string[];
    traffic?: string;
    location?: string[];
    prices?: Array<{ location: string; price: { net: string; gross: string; hourly_net?: string | null; hourly_gross?: string | null } }>;
    orderable_addons?: Array<{ id: string; name: string }>;
  };
}

interface HetznerRobotTransaction {
  transaction: {
    id: string;
    status: 'ready' | 'in process' | 'cancelled';
    server_number: number | null;
    server_ip: string | null;
    product?: { id: string; name: string; location?: string };
  };
}

interface HetznerRobotKey {
  key: {
    name: string;
    fingerprint: string;
    data: string;
    type?: string;
    size?: number;
    created_at?: string;
  };
}

export interface HetznerRobotServer {
  server: {
    server_ip: string | null;
    server_ipv6_net?: string | null;
    server_number: number;
    server_name: string | null;
    product: string;
    dc: string;
    traffic?: string;
    status: string;
    cancelled: boolean;
    paid_until?: string;
    ip?: string[];
    subnet?: Array<{ ip: string; mask: string }>;
  };
}

export class HetznerRobotClient {
  private readonly user: string;
  private readonly password: string;

  constructor(opts?: { user?: string; password?: string }) {
    this.user = opts?.user ?? config.HETZNER_ROBOT_USER;
    this.password = opts?.password ?? config.HETZNER_ROBOT_PASSWORD;
    if (!this.user || !this.password) {
      throw new Error('Hetzner Robot credentials not configured');
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${HETZNER_ROBOT_API}${path}`, {
      ...init,
      headers: {
        Authorization: basicAuthHeader(this.user, this.password),
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Hetzner Robot ${init.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    }

    if (res.status === 204) return {} as T;
    return res.json() as Promise<T>;
  }

  async listServerProducts(filters?: { location?: string; minPrice?: number; maxPrice?: number }): Promise<HetznerRobotProduct[]> {
    const params = new URLSearchParams();
    if (filters?.location) params.set('location', filters.location);
    if (typeof filters?.minPrice === 'number') params.set('min_price', String(filters.minPrice));
    if (typeof filters?.maxPrice === 'number') params.set('max_price', String(filters.maxPrice));
    const query = params.toString();
    return this.request(`/order/server/product${query ? `?${query}` : ''}`);
  }

  async listKeys(): Promise<HetznerRobotKey[]> {
    return this.request('/key');
  }

  async createKey(input: { name: string; data: string }): Promise<HetznerRobotKey> {
    const normalized = normalizeSshPublicKey(input.data);
    const body = new URLSearchParams();
    body.set('name', input.name);
    body.set('data', normalized);
    return this.request('/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  async ensureKey(input: { name: string; data: string }): Promise<string> {
    const normalized = normalizeSshPublicKey(input.data);
    const keys = await this.listKeys().catch(() => []);
    const existing = keys.find((entry) => entry.key.data.trim() === normalized);
    if (existing) return existing.key.fingerprint;
    const created = await this.createKey({ name: input.name, data: normalized });
    return created.key.fingerprint;
  }

  async orderServer(input: {
    productId: string;
    location?: string;
    distribution?: string;
    authorizedKeys?: string[];
    password?: string;
    addons?: string[];
    test?: boolean;
  }): Promise<HetznerRobotTransaction> {
    const body = new URLSearchParams();
    body.set('product_id', input.productId);
    if (input.location) body.set('location', input.location);
    if (input.distribution) body.set('dist', input.distribution);
    for (const fingerprint of input.authorizedKeys ?? []) body.append('authorized_key[]', fingerprint);
    if (input.password) body.set('password', input.password);
    for (const addon of input.addons ?? []) body.append('addon[]', addon);
    if (input.test) body.set('test', 'true');

    return this.request('/order/server/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  getOrderTransaction(id: string): Promise<HetznerRobotTransaction> {
    return this.request(`/order/server/transaction/${encodeURIComponent(id)}`);
  }

  async listServers(): Promise<HetznerRobotServer[]> {
    try {
      return await this.request<HetznerRobotServer[]>('/server');
    } catch (err) {
      if (err instanceof Error && /404/.test(err.message)) return [];
      throw err;
    }
  }
}
