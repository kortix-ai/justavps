import { config } from '../../config';

const HETZNER_ROBOT_API = 'https://robot-ws.your-server.de';

function basicAuthHeader(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

export interface HetznerRobotProduct {
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

export interface HetznerRobotTransaction {
  transaction: {
    id: string;
    status: 'ready' | 'in process' | 'cancelled';
    server_number: number | null;
    server_ip: string | null;
    product?: { id: string; name: string; location?: string };
  };
}

export interface HetznerRobotKey {
  key: {
    name: string;
    fingerprint: string;
    data: string;
    type?: string;
    size?: number;
    created_at?: string;
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
    const body = new URLSearchParams();
    body.set('name', input.name);
    body.set('data', input.data);
    return this.request('/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  async ensureKey(input: { name: string; data: string }): Promise<string> {
    const keys = await this.listKeys().catch(() => []);
    const existing = keys.find((entry) => entry.key.data.trim() === input.data.trim());
    if (existing) return existing.key.fingerprint;
    const created = await this.createKey(input);
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
}
