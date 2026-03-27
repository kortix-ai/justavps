/**
 * JustAVPS SDK — Ergonomic TypeScript Client.
 *
 * Thin wrapper around the auto-generated SDK that provides a nicer
 * resource-oriented API. Uses generated types — zero manual type maintenance.
 *
 * @example
 * ```ts
 * import { JustAVPS } from '@kortix/justavps';
 *
 * const client = new JustAVPS({ apiKey: 'sk_live_...' });
 *
 * const { machines } = await client.machines.list();
 * const machine = await client.machines.create({
 *   image_id: 'uuid', server_type: 'starter', region: 'eu',
 * });
 * const ready = await client.machines.waitForReady(machine.id);
 * ```
 */

// ─── SDK types (defined locally — generated types no longer export these) ────

export interface Machine {
  id: string;
  slug: string;
  name: string;
  status: string;
  provider: string;
  image_id?: string | null;
  server_type: string;
  region: string;
  ip?: string | null;
  price_monthly?: number | null;
  created_at: string;
  ready_at?: string | null;
  deleted_at?: string | null;
  ssh_key?: { public_key: string; private_key: string };
  connect?: { vscode_url: string; ssh_command: string };
  urls?: { proxy: string; terminal: string; port_template: string };
  provisioning_stage?: string | null;
  requires_checkout?: boolean;
}

export interface Image {
  id: string;
  name: string;
  status: string;
  provider: string;
  provider_image_id?: string | null;
  disk_size_gb?: number | null;
  created_at: string;
}

export interface SshKey {
  id: string;
  name: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  key?: string;
  created_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
}

export interface Account {
  id: string;
  email: string;
  name?: string | null;
}

export interface AccountUsage {
  machines: number;
  total_monthly_cost: number;
}

export interface Billing { url?: string; status?: string }
export interface BillingSetup { url: string }
export interface ServerType { name: string; cores: number; memory: number; disk: number; price_monthly: number; cpu_type: string }
export interface Provider { id: string; name: string; regions: string[] }
export interface Region { id: string; name: string; city: string; country: string }

export type Snapshot = Image;

// ─── Configuration ──────────────────────────────────────────────────────────

export interface JustAVPSConfig {
  /** API key (e.g. sk_live_xxx) */
  apiKey: string;
  /** Base URL — defaults to https://justavps.com/api/v1 */
  baseUrl?: string;
  /** Custom fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;
  /** Request timeout in ms (defaults to 30000) */
  timeout?: number;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class JustAVPSError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: { error: boolean; message: string; status: number },
  ) {
    super(message);
    this.name = 'JustAVPSError';
  }
}

// ─── Internal HTTP Client ───────────────────────────────────────────────────

class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;
  private readonly timeout: number;

  constructor(config: JustAVPSConfig) {
    this.baseUrl = (config.baseUrl || 'https://justavps.com/api/v1').replace(/\/$/, '');
    this.headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
    this.fetchFn = config.fetch || globalThis.fetch;
    this.timeout = config.timeout || 30_000;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: body ? this.headers : { Authorization: this.headers.Authorization },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 204) return undefined as T;
      const data = await res.json();

      if (!res.ok) {
        throw new JustAVPSError(data.message || `HTTP ${res.status}`, res.status, data);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(path: string) { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body); }
  delete<T = void>(path: string) { return this.request<T>('DELETE', path); }

  /** Raw fetch — for binary/text operations (downloads, file uploads) */
  async requestRaw(method: string, path: string, body?: BodyInit | null, headers?: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: this.headers.Authorization, ...headers },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new JustAVPSError(data.message || `HTTP ${res.status}`, res.status, data);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Opens an SSE connection and yields parsed events */
  async *sse(path: string): AsyncGenerator<{ type: string; data: unknown }> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { Authorization: this.headers.Authorization, Accept: 'text/event-stream' },
    });
    if (!res.ok || !res.body) throw new JustAVPSError(`SSE failed: ${res.status}`, res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let eventType = '', eventData = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) eventData = line.slice(5).trim();
          else if (line === '') {
            if (eventType && eventData) {
              try { yield { type: eventType, data: JSON.parse(eventData) }; }
              catch { yield { type: eventType, data: eventData }; }
              if (eventType === 'done') return;
            }
            eventType = ''; eventData = '';
          }
        }
      }
    } finally { reader.releaseLock(); }
  }
}

// ─── Type aliases for request bodies (from generated types) ─────────────────

import type {
  PostApiV1MachinesData,
  PostApiV1MachinesByIdResizeData,
  PostApiV1MachinesByIdImageData,
} from './generated/types.gen';

type CreateMachineBody = NonNullable<PostApiV1MachinesData['body']>;
type CreateSnapshotBody = NonNullable<PostApiV1MachinesByIdImageData['body']>;
type ResizeMachineBody = NonNullable<PostApiV1MachinesByIdResizeData['body']>;

// ─── Resource Namespaces ────────────────────────────────────────────────────

class MachinesResource {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<{ machines: Machine[] }>('/machines'); }
  get(id: string) { return this.http.get<Machine>(`/machines/${id}`); }
  create(input: CreateMachineBody) { return this.http.post<Machine>('/machines', input); }
  delete(id: string) { return this.http.delete(`/machines/${id}`); }
  reboot(id: string) { return this.http.post<{ action: string; status: string }>(`/machines/${id}/reboot`); }
  resize(id: string, input: ResizeMachineBody) { return this.http.post<{ action: string; old_type: string; new_type: string; status: string }>(`/machines/${id}/resize`, input); }
  createImage(id: string, input: { name: string }) { return this.http.post<Snapshot>(`/machines/${id}/image`, input); }
  stream(id: string) { return this.http.sse(`/machines/${id}/status/stream`); }

  async waitForReady(id: string, opts?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<Machine> {
    const timeout = opts?.timeoutMs ?? 600_000;
    const poll = opts?.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + timeout;
    try { for await (const e of this.stream(id)) { if (e.type === 'done') break; if (Date.now() > deadline) break; } } catch { /* fallback to polling */ }
    while (Date.now() < deadline) {
      const m = await this.get(id);
      if (m.status === 'ready' || m.status === 'error' || m.status === 'deleted') return m;
      await new Promise(r => setTimeout(r, poll));
    }
    throw new JustAVPSError('Timeout waiting for machine', 408);
  }
}

class SnapshotsResource {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<{ snapshots: Snapshot[] }>('/snapshots'); }
  get(id: string) { return this.http.get<Snapshot>(`/snapshots/${id}`); }
  create(input: CreateSnapshotBody) { return this.http.post<Snapshot>('/snapshots', input); }
  delete(id: string) { return this.http.delete(`/snapshots/${id}`); }
  build(id: string, input: { provider: string }) { return this.http.post<{ message: string; status: string }>(`/snapshots/${id}/build`, input); }

  async waitForReady(id: string, opts?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<Snapshot> {
    const timeout = opts?.timeoutMs ?? 1_200_000;
    const poll = opts?.pollIntervalMs ?? 10_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const s = await this.get(id);
      if (s.status === 'ready' || s.status === 'failed' || s.status === 'deleted') return s;
      await new Promise(r => setTimeout(r, poll));
    }
    throw new JustAVPSError('Timeout waiting for snapshot', 408);
  }
}

class ImagesResource {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<{ images: Snapshot[] }>('/images'); }
  get(id: string) { return this.http.get<Snapshot>(`/images/${id}`); }
  delete(id: string) { return this.http.delete(`/images/${id}`); }

  async waitForReady(id: string, opts?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<Snapshot> {
    const timeout = opts?.timeoutMs ?? 1_200_000;
    const poll = opts?.pollIntervalMs ?? 10_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const s = await this.get(id);
      if (s.status === 'ready' || s.status === 'failed' || s.status === 'deleted') return s;
      await new Promise(r => setTimeout(r, poll));
    }
    throw new JustAVPSError('Timeout waiting for image', 408);
  }
}

class SSHKeysResource {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<{ ssh_keys: SshKey[] }>('/ssh-keys'); }
  create(input: { name: string; public_key: string }) { return this.http.post<SshKey>('/ssh-keys', input); }
  delete(id: string) { return this.http.delete(`/ssh-keys/${id}`); }
}

class APIKeysResource {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<{ api_keys: ApiKey[] }>('/api-keys'); }
  create(input: { name: string }) { return this.http.post<ApiKey>('/api-keys', input); }
  delete(id: string) { return this.http.delete(`/api-keys/${id}`); }
}

class WebhooksResource {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get<{ webhooks: Webhook[] }>('/webhooks'); }
  create(input: { url: string; events: string[]; secret?: string }) { return this.http.post<Webhook>('/webhooks', input); }
  delete(id: string) { return this.http.delete(`/webhooks/${id}`); }
}

class ServerTypesResource {
  constructor(private readonly http: HttpClient) {}
  list(region: string, provider = 'cloud') { return this.http.get<{ provider: string; region: string; server_types: ServerType[] }>(`/server-types?provider=${provider}&region=${region}`); }
  providers() { return this.http.get<{ providers: Provider[] }>('/server-types/providers'); }
  regions(provider = 'cloud') { return this.http.get<{ provider: string; regions: Region[] }>(`/server-types/regions?provider=${provider}`); }
}

class AccountResource {
  constructor(private readonly http: HttpClient) {}
  get() { return this.http.get<Account>('/account'); }
  usage() { return this.http.get<AccountUsage>('/account/usage'); }
  billing() { return this.http.get<Billing>('/account/billing'); }
}

// ─── Toolbox Types ──────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  mode: string;
  mode_bits: string;
  owner: string;
  group: string;
  mod_time: string;
  symlink_target: string | null;
}

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  args: string;
  cwd?: string;
  user?: string;
  state?: string;
  memory_rss_bytes?: number;
}

export interface FindMatch {
  file: string;
  line: number;
  content: string;
}

// ─── Toolbox: Filesystem ────────────────────────────────────────────────────

class ToolboxFilesResource {
  constructor(private readonly http: HttpClient, private readonly machineId: string) {}

  private get base() { return `/machines/${this.machineId}/toolbox`; }

  /** List files in a directory */
  list(path = '/root', depth = 1) {
    return this.http.get<{ entries: FileEntry[] }>(`${this.base}/files?path=${encodeURIComponent(path)}&depth=${depth}`);
  }

  /** Get file or directory metadata */
  info(path: string) {
    return this.http.get<FileEntry>(`${this.base}/files/info?path=${encodeURIComponent(path)}`);
  }

  /** Check if a file or directory exists */
  exists(path: string) {
    return this.http.get<{ exists: boolean; type: 'file' | 'dir' | null }>(`${this.base}/files/exists?path=${encodeURIComponent(path)}`);
  }

  /** Download file content as text */
  async download(path: string): Promise<string> {
    const res = await this.http.requestRaw('GET', `${this.base}/files/download?path=${encodeURIComponent(path)}`);
    return res.text();
  }

  /** Download file content as ArrayBuffer (for binary files) */
  async downloadBytes(path: string): Promise<ArrayBuffer> {
    const res = await this.http.requestRaw('GET', `${this.base}/files/download?path=${encodeURIComponent(path)}`);
    return res.arrayBuffer();
  }

  /** Upload content to a file (creates parent directories automatically) */
  async upload(path: string, content: string | ArrayBuffer, opts?: { mode?: string; overwrite?: boolean }) {
    const params = new URLSearchParams({ path });
    if (opts?.mode) params.set('mode', opts.mode);
    if (opts?.overwrite === false) params.set('overwrite', 'false');
    const res = await this.http.requestRaw(
      'POST',
      `${this.base}/files/upload?${params}`,
      typeof content === 'string' ? content : content,
      { 'Content-Type': 'application/octet-stream' },
    );
    return res.json() as Promise<{ path: string; name: string; type: 'file'; size: number }>;
  }

  /** Create a directory recursively (like mkdir -p) */
  mkdir(path: string, mode?: string) {
    const params = new URLSearchParams({ path });
    if (mode) params.set('mode', mode);
    return this.http.post<{ path: string; created: boolean }>(`${this.base}/files/folder?${params}`);
  }

  /** Delete a file or directory */
  remove(path: string, recursive = false) {
    return this.http.delete<{ deleted: boolean; path: string }>(`${this.base}/files?path=${encodeURIComponent(path)}${recursive ? '&recursive=true' : ''}`);
  }

  /** Move or rename a file/directory */
  move(source: string, destination: string) {
    return this.http.post<{ source: string; destination: string }>(
      `${this.base}/files/move?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}`,
    );
  }

  /** Search for text in files (grep) */
  find(path: string, pattern: string, opts?: { include?: string; maxResults?: number }) {
    const params = new URLSearchParams({ path, pattern });
    if (opts?.include) params.set('include', opts.include);
    if (opts?.maxResults) params.set('max_results', String(opts.maxResults));
    return this.http.get<{ matches: FindMatch[]; truncated: boolean; total: number }>(`${this.base}/files/find?${params}`);
  }

  /** Find and replace text across files */
  replace(files: string[], pattern: string, newValue: string) {
    return this.http.post<{ results: { file: string; replacements: number }[] }>(
      `${this.base}/files/replace`, { files, pattern, new_value: newValue },
    );
  }

  /** Set file permissions (chmod/chown) */
  chmod(path: string, mode: string) {
    return this.http.post<{ path: string; mode: string; owner: string; group: string }>(
      `${this.base}/files/permissions?path=${encodeURIComponent(path)}`, { mode },
    );
  }
}

// ─── Toolbox: Process ───────────────────────────────────────────────────────

class ToolboxProcessResource {
  constructor(private readonly http: HttpClient, private readonly machineId: string) {}

  private get base() { return `/machines/${this.machineId}/toolbox`; }

  /** Execute a shell command and return stdout/stderr/exit_code */
  exec(command: string, opts?: { cwd?: string; timeout?: number; env?: Record<string, string> }) {
    return this.http.post<ExecResult>(`${this.base}/process/execute`, { command, ...opts });
  }

  /** Execute a command with real-time SSE streaming output */
  async *stream(command: string, opts?: { cwd?: string; timeout?: number; env?: Record<string, string> }) {
    const body = { command, ...opts };
    const res = await this.http.requestRaw(
      'POST', `${this.base}/process/execute/stream`,
      JSON.stringify(body),
      { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    );
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let eventType = '', eventData = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) eventData = line.slice(5).trim();
          else if (line === '') {
            if (eventType && eventData) {
              try { yield { type: eventType, data: JSON.parse(eventData) }; }
              catch { yield { type: eventType, data: eventData }; }
            }
            eventType = ''; eventData = '';
          }
        }
      }
    } finally { reader.releaseLock(); }
  }

  /** Run a code snippet in a given language */
  codeRun(code: string, language?: string, opts?: { timeout?: number; env?: Record<string, string> }) {
    return this.http.post<ExecResult>(`${this.base}/process/code-run`, { code, language, ...opts });
  }

  /** List all running processes on the machine */
  list() {
    return this.http.get<{ processes: ProcessInfo[] }>(`${this.base}/process/list`);
  }

  /** Kill a process by PID */
  kill(pid: number, signal: 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP' = 'SIGTERM') {
    return this.http.post<{ killed: boolean; pid: number; signal: string }>(`${this.base}/process/kill`, { pid, signal });
  }
}

// ─── Toolbox (combined) ─────────────────────────────────────────────────────

class ToolboxResource {
  readonly files: ToolboxFilesResource;
  readonly process: ToolboxProcessResource;

  constructor(http: HttpClient, machineId: string) {
    this.files = new ToolboxFilesResource(http, machineId);
    this.process = new ToolboxProcessResource(http, machineId);
  }
}

// ─── Main Client ────────────────────────────────────────────────────────────

export class JustAVPS {
  readonly machines: MachinesResource;
  /** @deprecated Use `images` instead */
  readonly snapshots: SnapshotsResource;
  readonly images: ImagesResource;
  readonly sshKeys: SSHKeysResource;
  readonly apiKeys: APIKeysResource;
  readonly webhooks: WebhooksResource;
  readonly serverTypes: ServerTypesResource;
  readonly account: AccountResource;

  private readonly _http: HttpClient;

  constructor(config: JustAVPSConfig) {
    this._http = new HttpClient(config);
    this.machines = new MachinesResource(this._http);
    this.snapshots = new SnapshotsResource(this._http);
    this.images = new ImagesResource(this._http);
    this.sshKeys = new SSHKeysResource(this._http);
    this.apiKeys = new APIKeysResource(this._http);
    this.webhooks = new WebhooksResource(this._http);
    this.serverTypes = new ServerTypesResource(this._http);
    this.account = new AccountResource(this._http);
  }

  /** Get a toolbox interface for a specific machine (filesystem + process APIs) */
  toolbox(machineId: string): ToolboxResource {
    return new ToolboxResource(this._http, machineId);
  }
}
