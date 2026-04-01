import type { BaremetalRunnerClient, RunnerCreateInstanceInput, RunnerCreateInstanceResult } from './types';

export class HttpBaremetalRunnerClient implements BaremetalRunnerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`runner ${init.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }

    if (res.status === 204) return {} as T;
    return res.json() as Promise<T>;
  }

  createInstance(input: RunnerCreateInstanceInput): Promise<RunnerCreateInstanceResult> {
    return this.request('/v1/instances', { method: 'POST', body: JSON.stringify(input) });
  }

  deleteInstance(instanceId: string): Promise<void> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });
  }

  startInstance(instanceId: string): Promise<void> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}/start`, { method: 'POST' });
  }

  stopInstance(instanceId: string): Promise<void> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}/stop`, { method: 'POST' });
  }

  rebootInstance(instanceId: string): Promise<void> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}/reboot`, { method: 'POST' });
  }

  publishImage(instanceId: string, alias: string): Promise<{ imageId: string }> {
    return this.request(`/v1/images/publish`, {
      method: 'POST',
      body: JSON.stringify({ instanceId, alias }),
    });
  }
}
