import http from 'node:http';
import https from 'node:https';

import type { BaremetalRunnerClient, RunnerCreateInstanceInput, RunnerCreateInstanceResult, RunnerHostState } from './types';

const RUNNER_REQUEST_TIMEOUT_MS = 15 * 60_000;

function toOutgoingHeaders(headers?: RequestInit['headers']): http.OutgoingHttpHeaders | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as http.OutgoingHttpHeaders;
}

function requestJson(urlString: string, init: RequestInit = {}, timeoutMs = RUNNER_REQUEST_TIMEOUT_MS): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: init.method ?? 'GET',
      headers: toOutgoingHeaders(init.headers),
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode ?? 500,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`runner request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);

    if (init.body) {
      req.write(typeof init.body === 'string' ? init.body : String(init.body));
    }

    req.end();
  });
}

export class HttpBaremetalRunnerClient implements BaremetalRunnerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { status, text } = await requestJson(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (status < 200 || status >= 300) {
      throw new Error(`runner ${init.method || 'GET'} ${path} -> ${status}: ${text.slice(0, 300)}`);
    }

    if (status === 204 || !text) return {} as T;
    return JSON.parse(text) as T;
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

  getState(): Promise<RunnerHostState> {
    return this.request('/v1/state');
  }

  listSnapshots(instanceId: string): Promise<Array<{ id: string; name: string; createdAt: string; status: string }>> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}/snapshots`);
  }

  createSnapshot(instanceId: string, name?: string): Promise<{ id: string; name: string; createdAt: string; status: string }> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    });
  }

  restoreSnapshot(instanceId: string, snapshotId: string): Promise<void> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`, { method: 'POST' });
  }

  deleteSnapshot(instanceId: string, snapshotId: string): Promise<void> {
    return this.request(`/v1/instances/${encodeURIComponent(instanceId)}/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  publishImage(instanceId: string, alias: string): Promise<{ imageId: string }> {
    return this.request(`/v1/images/publish`, {
      method: 'POST',
      body: JSON.stringify({ instanceId, alias }),
    });
  }

  deleteImage(imageId: string): Promise<void> {
    return this.request(`/v1/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
  }
}
