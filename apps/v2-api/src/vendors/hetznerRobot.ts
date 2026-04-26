const HETZNER_ROBOT_API = 'https://robot-ws.your-server.de';

function basicAuthHeader(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

export type HetznerRobotProduct = {
  product: {
    id: string;
    name: string;
    description?: string[];
    traffic?: string;
    location?: string[];
    prices?: Array<{
      location: string;
      price: { net: string; gross: string; hourly_net?: string | null; hourly_gross?: string | null };
    }>;
    orderable_addons?: Array<{ id: string; name: string }>;
  };
};

export type HetznerRobotServer = {
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
};

export class HetznerRobotClient {
  constructor(private readonly opts: { user: string; password: string }) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${HETZNER_ROBOT_API}${path}`, {
      ...init,
      headers: {
        Authorization: basicAuthHeader(this.opts.user, this.opts.password),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Hetzner Robot ${init.method || 'GET'} ${path} -> ${response.status}: ${text.slice(0, 400)}`);
    }
    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  }

  listServerProducts(filters?: { location?: string; minPrice?: number; maxPrice?: number }) {
    const params = new URLSearchParams();
    if (filters?.location) params.set('location', filters.location);
    if (typeof filters?.minPrice === 'number') params.set('min_price', String(filters.minPrice));
    if (typeof filters?.maxPrice === 'number') params.set('max_price', String(filters.maxPrice));
    const query = params.toString();
    return this.request<HetznerRobotProduct[]>(`/order/server/product${query ? `?${query}` : ''}`);
  }

  async listServers() {
    try {
      return await this.request<HetznerRobotServer[]>('/server');
    } catch (error) {
      if (error instanceof Error && error.message.includes('-> 404')) return [];
      throw error;
    }
  }
}
