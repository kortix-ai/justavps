const HETZNER_ROBOT_API = 'https://robot-ws.your-server.de';

export class HetznerRobotApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly statusCode: number,
    readonly bodyText: string,
    readonly body: unknown,
  ) {
    const robotMessage = body && typeof body === 'object' && 'error' in body
      ? (body as { error?: { message?: string } }).error?.message
      : undefined;
    super(`Hetzner Robot ${method} ${path} -> ${statusCode}: ${robotMessage ?? bodyText.slice(0, 400)}`);
  }

  get robotMessage() {
    return this.body && typeof this.body === 'object' && 'error' in this.body
      ? (this.body as { error?: { message?: string } }).error?.message
      : undefined;
  }
}

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
      let body: unknown = { raw: text };
      if (text) {
        try { body = JSON.parse(text); } catch { /* keep raw */ }
      }
      throw new HetznerRobotApiError(init.method || 'GET', path, response.status, text, body);
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
      if (error instanceof HetznerRobotApiError && error.statusCode === 404) return [];
      throw error;
    }
  }

  // Place a server order via Robot's transactions endpoint. With `test: true`
  // Hetzner runs the order through validation but doesn't actually charge or
  // provision — we use that for the dry-run safety check before flipping to
  // live mode. Returns the transaction object including the assigned
  // server_number once delivered.
  async placeOrder(input: {
    productId: string;
    location: string;
    dist?: string;          // OS distribution; defaults to Rescue.
    authorizedKeyFingerprints?: string[];
    addons?: string[];
    test?: boolean;         // true = dry-run validation only
  }): Promise<{ transaction: { id: string; status: string; server_number: number | null; product: { id: string }; price?: unknown; transaction?: unknown } }> {
    const params = new URLSearchParams();
    params.set('product_id', input.productId);
    params.set('location', input.location);
    if (input.dist) params.set('dist', input.dist);
    if (input.test) params.set('test', 'true');
    for (const fp of input.authorizedKeyFingerprints ?? []) params.append('authorized_key[]', fp);
    for (const a of input.addons ?? []) params.append('addon[]', a);
    return this.request('/order/server/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  }

  async getOrderTransaction(id: string) {
    return this.request<{ transaction: { id: string; status: string; server_number: number | null } }>(`/order/server/transaction/${encodeURIComponent(id)}`);
  }

  async listSshKeys() {
    return this.request<Array<{ key: { name: string; fingerprint: string; data: string } }>>('/key');
  }

  // Re-image an existing dedicated into Hetzner's Rescue mode. Required as
  // the first step of the IncusOS install path; rescue gives us a minimal
  // Linux that can dd a new disk image onto the NVMe and reboot. Returns
  // the temporary rescue root password.
  async setRescueMode(serverNumber: number, opts: { os?: 'linux' | 'linux64'; arch?: 64 | 32; authorizedKeyFingerprints?: string[] } = {}) {
    const params = new URLSearchParams();
    params.set('os', opts.os ?? 'linux');
    if (opts.arch) params.set('arch', String(opts.arch));
    for (const fp of opts.authorizedKeyFingerprints ?? []) params.append('authorized_key[]', fp);
    return this.request<{ rescue: { server_number: number; password: string; authorized_key?: unknown[] } }>(`/boot/${serverNumber}/rescue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  }

  // Schedule a server for cancellation. Hetzner only honors
  // cancel-at-earliest-possible-date (next billing-period boundary or
  // contract anniversary, depending on the product). The body parameters
  // are documented at robot.hetzner.com/doc/webservice — `reserve_location`
  // controls whether you keep priority on the IP block; default false.
  async cancelServer(serverNumber: number, opts: { cancellation_date?: string; reserve_location?: boolean; reason?: string } = {}) {
    const params = new URLSearchParams();
    // Default: cancel at the earliest possible date (Hetzner-determined).
    if (opts.cancellation_date) params.set('cancellation_date', opts.cancellation_date);
    else params.set('cancellation_date', 'now'); // Hetzner accepts 'now' meaning "next available"
    if (opts.reserve_location !== undefined) params.set('reserve_location', opts.reserve_location ? 'true' : 'false');
    if (opts.reason) params.set('cancellation_reason', opts.reason);
    return this.request<{ cancellation: { server_number: number; cancelled: boolean; cancellation_date: string | null } }>(
      `/server/${serverNumber}/cancellation`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      },
    );
  }

  // Withdraw a previously-scheduled cancellation. Useful if operator
  // changes their mind before the cancellation date. Hetzner will not
  // refund pre-paid time, but the server stays online.
  async withdrawCancellation(serverNumber: number) {
    return this.request<{ cancellation: { server_number: number; cancelled: boolean } }>(
      `/server/${serverNumber}/cancellation`,
      { method: 'DELETE' },
    );
  }

  async resetServer(serverNumber: number, type: 'sw' | 'hw' | 'man' = 'hw') {
    const params = new URLSearchParams();
    params.set('type', type);
    return this.request<{ reset: { server_number: number; type: string } }>(`/reset/${serverNumber}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  }
}
