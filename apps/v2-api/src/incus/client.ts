import http from 'node:http';
import https from 'node:https';

import type { IncusClusterConfig } from '../config.js';
import type { IncusBackup, IncusClusterMember, IncusEnvelope, IncusImage, IncusInstance, IncusOperation, IncusServer, IncusSnapshot } from './types.js';

type RequestBody = Record<string, unknown> | Array<unknown> | string | null;

export type CreateInstanceSource =
  | { type: 'image'; image: string }
  | { type: 'snapshot'; source: string }
  | { type: 'empty' };

export class IncusApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly body: string) {
    super(message);
  }
}

function appendQuery(path: string, params: Record<string, string | undefined>) {
  const [pathname, query = ''] = path.split('?');
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const next = search.toString();
  return next ? `${pathname}?${next}` : pathname;
}

function normalizePath(path: string) {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.startsWith('/1.0') ? withSlash : `/1.0${withSlash}`;
}

function operationPath(operation: string) {
  if (!operation.startsWith('http://') && !operation.startsWith('https://')) return operation;
  const url = new URL(operation);
  return `${url.pathname}${url.search}`;
}

export class IncusClient {
  private readonly endpoint: URL;

  constructor(readonly cluster: IncusClusterConfig) {
    this.endpoint = new URL(cluster.endpoint);
  }

  getServer(): Promise<IncusServer> {
    return this.request('GET', '/1.0');
  }

  listClusterMembers(): Promise<IncusClusterMember[]> {
    return this.request('GET', '/cluster/members?recursion=1');
  }

  listImages(): Promise<IncusImage[]> {
    return this.request('GET', this.projectPath('/images?recursion=1'));
  }

  listInstances(): Promise<IncusInstance[]> {
    return this.request('GET', this.projectPath('/instances?recursion=1'));
  }

  getInstance(name: string): Promise<IncusInstance> {
    return this.request('GET', this.projectPath(`/instances/${encodeURIComponent(name)}`));
  }

  async createInstance(input: {
    name: string;
    machineType: 'container' | 'vm';
    source: CreateInstanceSource;
    targetMember: string;
    resources: { vcpu: number; memoryGb: number; diskGb: number };
  }): Promise<IncusOperation> {
    const devices: Record<string, Record<string, string>> = {};
    if (this.cluster.rootPool) {
      devices.root = {
        type: 'disk',
        pool: this.cluster.rootPool,
        path: '/',
        size: `${input.resources.diskGb}GiB`,
      };
    }

    const operation = await this.requestOperation('POST', this.projectPath('/instances', { target: input.targetMember }), {
        name: input.name,
        type: input.machineType === 'vm' ? 'virtual-machine' : 'container',
        source: input.source.type === 'image'
          ? { type: 'image', alias: input.source.image }
          : input.source.type === 'snapshot'
            ? { type: 'copy', source: input.source.source }
            : { type: 'none' },
        config: {
          'limits.cpu': String(input.resources.vcpu),
          'limits.memory': `${input.resources.memoryGb}GiB`,
          'user.justavps.machine_name': input.name,
          'user.justavps.machine_id': input.name,
        },
      ...(Object.keys(devices).length ? { devices } : {}),
    });

    return this.waitOperation(operation);
  }

  async startInstance(name: string): Promise<IncusOperation> {
    return this.changeInstanceState(name, 'start');
  }

  async stopInstance(name: string): Promise<IncusOperation> {
    return this.changeInstanceState(name, 'stop', true);
  }

  async rebootInstance(name: string): Promise<IncusOperation> {
    return this.changeInstanceState(name, 'restart', true);
  }

  async deleteInstance(name: string, input: { force?: boolean } = {}): Promise<IncusOperation> {
    if (input.force) {
      await this.changeInstanceState(name, 'stop', true).catch(() => undefined);
      await this.waitInstanceStatus(name, 'Stopped').catch(() => undefined);
    }
    const operation = await this.requestOperation('DELETE', this.projectPath(`/instances/${encodeURIComponent(name)}`));
    return this.waitOperation(operation);
  }

  listSnapshots(instanceName: string): Promise<IncusSnapshot[]> {
    return this.request('GET', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/snapshots?recursion=1`));
  }

  async createSnapshot(instanceName: string, snapshotName: string, input: { stateful?: boolean; expiresAt?: string | null } = {}): Promise<IncusOperation> {
    const operation = await this.requestOperation('POST', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/snapshots`), {
      name: snapshotName,
      stateful: input.stateful ?? false,
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    });
    return this.waitOperation(operation);
  }

  async restoreSnapshot(instanceName: string, snapshotName: string, input: { stateful?: boolean } = {}): Promise<IncusOperation> {
    const operation = await this.requestOperation('PUT', this.projectPath(`/instances/${encodeURIComponent(instanceName)}`), {
      restore: snapshotName,
      stateful: input.stateful ?? false,
    });
    return this.waitOperation(operation);
  }

  async deleteSnapshot(instanceName: string, snapshotName: string): Promise<IncusOperation> {
    const operation = await this.requestOperation('DELETE', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/snapshots/${encodeURIComponent(snapshotName)}`));
    return this.waitOperation(operation);
  }

  async createImageFromInstance(input: {
    instanceName: string;
    snapshotName?: string;
    aliases?: Array<{ name: string; description?: string }>;
    properties?: Record<string, string>;
    public?: boolean;
  }): Promise<IncusOperation> {
    const sourceName = input.snapshotName ? `${input.instanceName}/${input.snapshotName}` : input.instanceName;
    const operation = await this.requestOperation('POST', this.projectPath('/images'), {
      source: {
        type: input.snapshotName ? 'snapshot' : 'instance',
        name: sourceName,
      },
      aliases: input.aliases ?? [],
      properties: input.properties ?? {},
      public: input.public ?? false,
    });
    return this.waitOperation(operation);
  }

  async createImageFromOci(input: {
    server: string;
    ociRef: string;
    aliases?: Array<{ name: string; description?: string }>;
    properties?: Record<string, string>;
    public?: boolean;
  }): Promise<IncusOperation> {
    // Native Incus OCI pull. Equivalent to:
    //   incus remote add <server> --protocol=oci
    //   incus image copy <server>:<ociRef> local: --alias <aliasName>
    const operation = await this.requestOperation('POST', this.projectPath('/images'), {
      source: {
        type: 'image',
        mode: 'pull',
        protocol: 'oci',
        server: input.server,
        alias: input.ociRef,
        image_type: 'container',
      },
      aliases: input.aliases ?? [],
      properties: input.properties ?? {},
      public: input.public ?? false,
    });
    // OCI pulls (Docker layers + convert) can take a while; give it a generous deadline.
    return this.waitOperation(operation, 600_000);
  }

  async deleteImage(fingerprint: string): Promise<IncusOperation> {
    const resolved = await this.resolveImageFingerprint(fingerprint);
    const operation = await this.requestOperation('DELETE', this.projectPath(`/images/${encodeURIComponent(resolved)}`));
    return this.waitOperation(operation);
  }

  listBackups(instanceName: string): Promise<IncusBackup[]> {
    return this.request('GET', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/backups?recursion=1`));
  }

  async createBackup(instanceName: string, backupName: string, input: { instanceOnly?: boolean; optimizedStorage?: boolean; expiresAt?: string | null } = {}): Promise<IncusOperation> {
    const operation = await this.requestOperation('POST', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/backups`), {
      name: backupName,
      instance_only: input.instanceOnly ?? false,
      optimized_storage: input.optimizedStorage ?? true,
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    });
    return this.waitOperation(operation);
  }

  async deleteBackup(instanceName: string, backupName: string): Promise<IncusOperation> {
    const operation = await this.requestOperation('DELETE', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/backups/${encodeURIComponent(backupName)}`));
    return this.waitOperation(operation);
  }

  private async changeInstanceState(name: string, action: 'start' | 'stop' | 'restart', force = false): Promise<IncusOperation> {
    const operation = await this.requestOperation('PUT', this.projectPath(`/instances/${encodeURIComponent(name)}/state`), {
      action,
      timeout: 60,
      force,
    });
    return this.waitOperation(operation);
  }

  private projectPath(path: string, extra: Record<string, string | undefined> = {}) {
    return appendQuery(path, { project: this.cluster.project, ...extra });
  }

  private async resolveImageFingerprint(fingerprintOrAlias: string) {
    if (/^[a-f0-9]{64}$/i.test(fingerprintOrAlias)) return fingerprintOrAlias;
    const images = await this.listImages();
    return images.find((image) => image.fingerprint === fingerprintOrAlias || image.aliases?.some((alias) => alias.name === fingerprintOrAlias))?.fingerprint ?? fingerprintOrAlias;
  }

  private async requestOperation(method: string, path: string, body?: RequestBody) {
    const envelope = await this.rawRequest<unknown>(method, path, body);
    if (!envelope.operation) throw new Error(`Incus ${method} ${path} did not return an operation`);
    return envelope.operation;
  }

  private async waitOperation(operation: string, timeoutMs = 120_000): Promise<IncusOperation> {
    const deadline = Date.now() + timeoutMs;
    const path = operationPath(operation);
    while (Date.now() < deadline) {
      const op = await this.request<IncusOperation>('GET', path);
      if (op.status === 'Success' || op.status_code === 200) return op;
      if (op.status === 'Failure' || op.status_code >= 400) throw new Error(op.err || `Incus operation ${op.id} failed`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Incus operation ${operation}`);
  }

  private async waitInstanceStatus(name: string, status: string, timeoutMs = 30_000): Promise<IncusInstance> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const instance = await this.getInstance(name);
      if (instance.status === status) return instance;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Incus instance ${name} to become ${status}`);
  }

  private async request<T>(method: string, path: string, body?: RequestBody): Promise<T> {
    const envelope = await this.rawRequest<T>(method, path, body);
    return envelope.metadata;
  }

  private async rawRequest<T>(method: string, path: string, body?: RequestBody): Promise<IncusEnvelope<T>> {
    const requestPath = normalizePath(path);
    const payload = body === undefined || body === null
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const options: http.RequestOptions | https.RequestOptions = {
      protocol: this.endpoint.protocol,
      hostname: this.endpoint.hostname,
      port: this.endpoint.port || (this.endpoint.protocol === 'https:' ? 443 : 80),
      method,
      path: requestPath,
      headers,
    };

    if (this.endpoint.protocol === 'https:') {
      Object.assign(options, {
        cert: this.cluster.clientCert,
        key: this.cluster.clientKey,
        ca: this.cluster.caCert,
        rejectUnauthorized: this.cluster.rejectUnauthorized,
      });
    }

    const transport = this.endpoint.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 500) >= 400) {
            reject(new IncusApiError(`Incus ${method} ${requestPath} -> ${res.statusCode}`, res.statusCode ?? 500, text));
            return;
          }
          try {
            resolve(JSON.parse(text) as IncusEnvelope<T>);
          } catch (error) {
            reject(new Error(`Invalid Incus JSON response: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      });
      req.setTimeout(30_000, () => req.destroy(new Error(`Incus ${method} ${requestPath} timed out`)));
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}
