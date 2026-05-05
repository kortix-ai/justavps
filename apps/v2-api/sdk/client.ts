/**
 * JustAVPS V2 SDK — Ergonomic TypeScript Client.
 *
 * Resource-oriented façade over the auto-generated `sdk/generated/` client.
 * Generated types stay the source of truth — this file only adds verb names
 * (`client.machines.create({...})`) so callers don't have to remember
 * operation IDs or import the raw functions one by one.
 *
 * @example
 * ```ts
 * import { JustAVPSV2 } from '@kortix/justavps-v2';
 *
 * const client = new JustAVPSV2({ baseUrl: 'http://localhost:4200', token: 'sk_live_...' });
 * const { machines } = await client.machines.list();
 * const m = await client.machines.create({
 *   region: 'eu',
 *   type: 'container',
 *   resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
 *   source: { type: 'image', image_id: 'justavps-ubuntu-24.04-template' },
 * });
 * ```
 */

import { client as defaultClient } from './generated/client.gen.js';
import type { Config } from './generated/client/index.js';
import {
  getHealth,
  getRegions,
  getImages,
  postImages,
  postImagesByIdPrewarm,
  deleteImagesById,
  getMachines,
  postMachines,
  getMachinesById,
  patchMachinesById,
  deleteMachinesById,
  postMachinesByIdStart,
  postMachinesByIdStop,
  postMachinesByIdReboot,
  postMachinesByIdExec,
  postMachinesByIdDaemonEnsure,
  getProxyTokens,
  postProxyTokens,
  deleteProxyTokensById,
  getSshTokens,
  postSshTokens,
  getTemplates,
  deleteTemplatesCacheExtras,
  putMachinesByIdFiles,
  getMachinesByIdFiles,
  deleteMachinesByIdFiles,
  getMachinesByIdSnapshots,
  postMachinesByIdSnapshots,
  postMachinesByIdSnapshotsByNameRestore,
  deleteMachinesByIdSnapshotsByName,
  getMachinesByIdBackups,
  postMachinesByIdBackups,
  postMachinesByIdBackupsByNameRestore,
  deleteMachinesByIdBackupsByName,
} from './generated/sdk.gen.js';
import type {
  CreateBackupBody,
  CreateImageBody,
  CreateMachineBody,
  CreateSnapshotBody,
  ExecBody,
  ExecResponse,
  FileWriteBody,
  RestoreBody,
} from './generated/types.gen.js';

export type JustAVPSV2Config = {
  /** Base URL of the V2 API (e.g. `http://localhost:4200` or `https://justavps.com/v2`). */
  baseUrl: string;
  /** Bearer token for non-GET routes (the V2_ADMIN_TOKEN on the server). */
  token?: string;
  /** Custom fetch implementation (Node 18+ has it built in; supply your own for tests / different runtimes). */
  fetch?: typeof fetch;
};

export class JustAVPSV2Error extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
    this.name = 'JustAVPSV2Error';
  }
}

export class JustAVPSV2 {
  constructor(config: JustAVPSV2Config) {
    // The generated functions read from `defaultClient` at call time, so
    // mutating its config here is enough to point all calls at this SDK
    // instance's base URL and auth token. Last-instance-wins semantics —
    // fine for single-process apps; spin up multiple shells out of process
    // if you genuinely need parallel base URLs.
    const merged: Config = {
      baseUrl: config.baseUrl,
      fetch: config.fetch,
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    };
    defaultClient.setConfig(merged);
  }

  private async unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
    const result = await p;
    if (result.error || !result.response.ok) {
      const body = result.error ?? result.data;
      throw new JustAVPSV2Error(
        `${result.response.status} ${result.response.statusText}`,
        result.response.status,
        body,
      );
    }
    return result.data as T;
  }

  // ─── system ──────────────────────────────────────────────────────────
  health() { return this.unwrap(getHealth()); }
  regions() { return this.unwrap(getRegions()); }

  // ─── machines ────────────────────────────────────────────────────────
  readonly machines = {
    list: () => this.unwrap(getMachines()),
    get: (id: string) => this.unwrap(getMachinesById({ path: { id } })),
    create: (body: CreateMachineBody) => this.unwrap(postMachines({ body })),
    resize: (id: string, resources: { vcpu?: number; memory_gb?: number; disk_gb?: number }) =>
      this.unwrap(patchMachinesById({ path: { id }, body: { resources } })),
    delete: (id: string) => this.unwrap(deleteMachinesById({ path: { id } })),
    start: (id: string) => this.unwrap(postMachinesByIdStart({ path: { id } })),
    stop: (id: string) => this.unwrap(postMachinesByIdStop({ path: { id } })),
    reboot: (id: string) => this.unwrap(postMachinesByIdReboot({ path: { id } })),
    exec: (id: string, body: ExecBody): Promise<ExecResponse> => this.unwrap(postMachinesByIdExec({ path: { id }, body })) as Promise<ExecResponse>,
    ensureDaemon: (id: string, body: { verify_port?: number } = {}) =>
      this.unwrap(postMachinesByIdDaemonEnsure({ path: { id }, body })),
  };

  // ─── files (in-sandbox filesystem) ──────────────────────────────────
  readonly files = {
    write: (machineId: string, body: FileWriteBody) =>
      this.unwrap(putMachinesByIdFiles({ path: { id: machineId }, body })),
    read: (machineId: string, path: string) =>
      this.unwrap(getMachinesByIdFiles({ path: { id: machineId }, query: { path } })),
    delete: (machineId: string, path: string) =>
      this.unwrap(deleteMachinesByIdFiles({ path: { id: machineId }, query: { path } })),
  };

  // ─── snapshots ───────────────────────────────────────────────────────
  readonly snapshots = {
    list: (machineId: string) =>
      this.unwrap(getMachinesByIdSnapshots({ path: { id: machineId } })),
    create: (machineId: string, body: CreateSnapshotBody = {}) =>
      this.unwrap(postMachinesByIdSnapshots({ path: { id: machineId }, body })),
    restore: (machineId: string, snapshotName: string, body: RestoreBody = {}) =>
      this.unwrap(postMachinesByIdSnapshotsByNameRestore({ path: { id: machineId, name: snapshotName }, body })),
    delete: (machineId: string, snapshotName: string) =>
      this.unwrap(deleteMachinesByIdSnapshotsByName({ path: { id: machineId, name: snapshotName } })),
  };

  // ─── backups ─────────────────────────────────────────────────────────
  readonly backups = {
    list: (machineId: string) =>
      this.unwrap(getMachinesByIdBackups({ path: { id: machineId } })),
    create: (machineId: string, body: CreateBackupBody = {}) =>
      this.unwrap(postMachinesByIdBackups({ path: { id: machineId }, body })),
    restore: (machineId: string, backupName: string, body: RestoreBody = {}) =>
      this.unwrap(postMachinesByIdBackupsByNameRestore({ path: { id: machineId, name: backupName }, body })),
    delete: (machineId: string, backupName: string) =>
      this.unwrap(deleteMachinesByIdBackupsByName({ path: { id: machineId, name: backupName } })),
  };

  // ─── images ──────────────────────────────────────────────────────────
  readonly images = {
    list: () => this.unwrap(getImages()),
    create: (body: CreateImageBody) => this.unwrap(postImages({ body })),
    delete: (id: string) => this.unwrap(deleteImagesById({ path: { id } })),
    prewarm: (id: string) => this.unwrap(postImagesByIdPrewarm({ path: { id } })),
  };

  // ─── proxy + ssh access ──────────────────────────────────────────────
  readonly proxyTokens = {
    list: (query: { machine_id?: string } = {}) => this.unwrap(getProxyTokens({ query })),
    create: (body: { machine_id: string; label?: string; ports?: number[]; expires_in_seconds?: number }) =>
      this.unwrap(postProxyTokens({ body })),
    delete: (id: string) => this.unwrap(deleteProxyTokensById({ path: { id } })),
  };

  readonly sshTokens = {
    list: (query: { machine_id?: string } = {}) => this.unwrap(getSshTokens({ query })),
    create: (body: { machine_id: string; label?: string; expires_in_seconds?: number }) =>
      this.unwrap(postSshTokens({ body })),
  };

  // ─── templates ───────────────────────────────────────────────────────
  readonly templates = {
    list: () => this.unwrap(getTemplates()),
    purgeExtras: () => this.unwrap(deleteTemplatesCacheExtras()),
  };

  // ─── admin ───────────────────────────────────────────────────────────
  // Admin surface intentionally NOT in the generated openapi spec yet —
  // these routes are operator-only and we don't want to teach end-user
  // code that they exist. The methods here speak directly through fetch
  // for the same reason: keep admin orthogonal to the published SDK.
  readonly admin = {
    nodes: {
      list: () => this.adminGet<{ runs: Array<Record<string, unknown>> }>('/admin/nodes/runs'),
      get: (runId: string) => this.adminGet<{ run: Record<string, unknown> }>(`/admin/nodes/runs/${encodeURIComponent(runId)}`),
      add: (body: { cluster_id: string; source: 'byo' | 'hetzner-buy'; target_os?: 'ubuntu-incus' | 'incus-os'; ssh_host?: string; ssh_user?: string; ssh_port?: number; hetzner_server_number?: number; metadata?: Record<string, unknown> }) =>
        this.adminPost<{ run: Record<string, unknown> }>('/admin/nodes/runs', body),
      drive: (runId: string) => this.adminPost<{ ok: boolean; scheduled: string }>(`/admin/nodes/runs/${encodeURIComponent(runId)}/drive`, {}),
      retry: (runId: string) => this.adminPost<{ ok: boolean; retried: string }>(`/admin/nodes/runs/${encodeURIComponent(runId)}/retry`, {}),
      cancel: (runId: string) => this.adminPost<{ ok: boolean; cancelled: string }>(`/admin/nodes/runs/${encodeURIComponent(runId)}/cancel`, {}),
    },
  };

  private async adminGet<T>(path: string): Promise<T> {
    const cfg = (defaultClient as unknown as { getConfig: () => { baseUrl?: string; headers?: Record<string, string>; fetch?: typeof fetch } }).getConfig();
    const r = await (cfg.fetch ?? fetch)(`${cfg.baseUrl ?? ''}${path}`, { method: 'GET', headers: cfg.headers });
    if (!r.ok) throw new JustAVPSV2Error(`${r.status} ${r.statusText}`, r.status, await r.json().catch(() => null));
    return r.json() as Promise<T>;
  }
  private async adminPost<T>(path: string, body: unknown): Promise<T> {
    const cfg = (defaultClient as unknown as { getConfig: () => { baseUrl?: string; headers?: Record<string, string>; fetch?: typeof fetch } }).getConfig();
    const r = await (cfg.fetch ?? fetch)(`${cfg.baseUrl ?? ''}${path}`, {
      method: 'POST',
      headers: { ...(cfg.headers ?? {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!r.ok) throw new JustAVPSV2Error(`${r.status} ${r.statusText}`, r.status, await r.json().catch(() => null));
    return r.json() as Promise<T>;
  }
}

export type {
  CreateBackupBody,
  CreateImageBody,
  CreateMachineBody,
  CreateSnapshotBody,
  ExecBody,
  ExecResponse,
  FileWriteBody,
  RestoreBody,
};
