export interface JustAVPSV2Config {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  fetch?: typeof fetch;
}

export class JustAVPSV2Error extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = 'JustAVPSV2Error';
  }
}

class HttpClientV2 {
  readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeout: number;

  constructor(config: JustAVPSV2Config) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://justavps.com/api/v2').replace(/\/$/, '');
    this.fetchFn = config.fetch || globalThis.fetch;
    this.timeout = config.timeout || 30_000;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: body
          ? { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
          : { Authorization: `Bearer ${this.apiKey}` },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 204) return undefined as T;
      const data = await res.json();
      if (!res.ok) {
        throw new JustAVPSV2Error(data.message || `HTTP ${res.status}`, res.status, data);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(path: string) { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body); }
  delete<T = void>(path: string) { return this.request<T>('DELETE', path); }
}

export class JustAVPSV2 {
  _http: HttpClientV2;

  constructor(config: JustAVPSV2Config) {
    this._http = new HttpClientV2(config);
  }

  catalog = {
    plans: (region: string) => this._http.get<{ region: string; plans: unknown[] }>(`/catalog/plans?region=${encodeURIComponent(region)}`),
    regions: () => this._http.get<{ regions: unknown[] }>(`/catalog/regions`),
  };

  machines = {
    list: () => this._http.get<{ machines: unknown[] }>(`/machines`),
    get: (id: string) => this._http.get<unknown>(`/machines/${id}`),
    create: (input: unknown) => this._http.post<unknown>(`/machines`, input),
    start: (id: string) => this._http.post<{ ok: boolean }>(`/machines/${id}/start`),
    stop: (id: string) => this._http.post<{ ok: boolean }>(`/machines/${id}/stop`),
    reboot: (id: string) => this._http.post<{ ok: boolean }>(`/machines/${id}/reboot`),
    cancel: (id: string) => this._http.post<{ action: string; status: string }>(`/machines/${id}/cancel`),
    reactivate: (id: string) => this._http.post<{ action: string; status: string }>(`/machines/${id}/reactivate`),
    delete: (id: string) => this._http.delete<{ ok: boolean }>(`/machines/${id}`),
  };

  images = {
    list: () => this._http.get<{ images: unknown[] }>(`/images`),
    create: (input: unknown) => this._http.post<unknown>(`/images`, input),
    delete: (id: string) => this._http.delete<{ ok: boolean }>(`/images/${id}`),
  };

  snapshots = {
    list: (machineId: string) => this._http.get<{ snapshots: unknown[] }>(`/snapshots/${machineId}`),
    create: (machineId: string, input?: unknown) => this._http.post<unknown>(`/snapshots/${machineId}`, input || {}),
    restore: (machineId: string, snapshotId: string) => this._http.post<{ ok: boolean }>(`/snapshots/${machineId}/${snapshotId}/restore`),
    delete: (machineId: string, snapshotId: string) => this._http.delete<{ ok: boolean }>(`/snapshots/${machineId}/${snapshotId}`),
  };

  billing = {
    overview: () => this._http.get<unknown>(`/billing/overview`),
    compare: (plan: string, hoursPerDay: number) => this._http.get<unknown>(`/billing/compare?plan=${encodeURIComponent(plan)}&hours_per_day=${hoursPerDay}`),
  };

  fleet = {
    hosts: () => this._http.get<{ hosts: unknown[] }>(`/admin/fleet/hosts`),
    procurements: () => this._http.get<{ procurements: unknown[] }>(`/admin/fleet/procurements`),
  };
}
