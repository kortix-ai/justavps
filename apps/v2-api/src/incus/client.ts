import http from 'node:http';
import https from 'node:https';

import WebSocket from 'ws';

import type { IncusClusterConfig } from '../config.js';
import type { IncusBackup, IncusClusterMember, IncusEnvelope, IncusImage, IncusInstance, IncusInstanceState, IncusOperation, IncusServer, IncusSnapshot } from './types.js';

type RequestBody = Record<string, unknown> | Array<unknown> | string | null;

export type CreateInstanceSource =
  | { type: 'image'; image: string }
  | { type: 'snapshot'; source: string };

export type IncusInteractiveExec = {
  operation: string;
  fds: Record<string, string>;
};

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

// Hardened defaults applied to every instance we create. These prioritize
// isolation over flexibility — workloads that need (e.g.) nesting or devlxd
// must opt back in explicitly, never inherit it by default.
//
// Containers run unprivileged with their own non-overlapping uid/gid range
// (security.idmap.isolated) so root in container A cannot collide with root
// in container B even if a kernel idmap bug were exploited. Nesting and the
// /dev/incus management socket are off; the rootfs shift is locked in after
// initial provisioning.
//
// VMs boot under UEFI Secure Boot only (no legacy CSM path) so unsigned
// kernels are rejected at boot, on top of the inherent KVM hypervisor
// isolation. Stateful migration is disabled (the snapshot/restore path is
// stateless export+import — no live RAM dump to a foreign host).
function hardenedContainerSecurityConfig(): Record<string, string> {
  // Sandbox-grade hardening for the platform-container-hardened profile.
  // Goal: untrusted agent code runs here. We assume the workload is hostile
  // and block every capability + syscall it doesn't strictly need. This is
  // strictly more locked-down than sysbox's defaults — sysbox enables
  // capabilities for nested workloads (Docker-in-Docker, systemd) which we
  // explicitly do NOT want for one-shot sandboxes.
  return {
    // Identity / namespaces ────────────────────────────────────────────
    'security.privileged': 'false',
    'security.nesting': 'false',
    'security.idmap.isolated': 'true',
    'security.protection.shift': 'true',
    // Incus's in-container management socket — disabled. Sandboxes have
    // no business reaching back into the host's Incus daemon.
    'security.guestapi': 'false',
    'security.guestapi.images': 'false',

    // Hard cgroup resource boundaries. Swap is disabled so memory pressure is
    // contained to the customer's configured RAM rather than spilling into host
    // swap and creating noisy-neighbour leakage.
    'limits.memory.enforce': 'hard',
    'limits.memory.swap': 'false',
    'limits.processes': '4096',

    // Seccomp / syscall surface ───────────────────────────────────────
    // Apply Incus's stricter default-deny seccomp filter plus explicit
    // denials for the syscalls most commonly chained in container-escape
    // exploits and kernel-LPE chains. Note we do NOT deny mount/umount2/
    // pivot_root — the kernel's user-namespace implementation already
    // restricts those to the container's own mount namespace (no host
    // impact), and denying them breaks legitimate workloads (venv,
    // app-image, FUSE clients).
    'security.syscalls.deny_default': 'true',
    'security.syscalls.deny_compat': 'true',
    'security.syscalls.deny': [
      'bpf',                  // unprivileged eBPF — recurring CVE source
      'init_module',          // kernel module load
      'finit_module',         //   ditto
      'delete_module',        //   ditto
      'kexec_load',           // kernel replacement
      'kexec_file_load',      //   ditto
      'iopl',                 // direct hardware I/O port access
      'ioperm',               //   ditto
      'swapon',               // swap manipulation
      'swapoff',              //   ditto
      'perf_event_open',      // perf side-channels (CVE-2022-1729 etc)
      'quotactl',             // disk quota manipulation
      'reboot',               // host reboot
    ].join(','),

    // Kernel surface ───────────────────────────────────────────────────
    // Pin kernel module set to empty so even allowed processes can't load
    // modules via systemd-modules-load equivalents.
    'linux.kernel_modules': '',

    // Sysinfo / proc virtualization — return container-scoped values
    // (cgroup-aware cpu/mem/uptime) instead of host-scoped. Stops trivial
    // host fingerprinting from /proc reads.
    'security.syscalls.intercept.sysinfo': 'true',
  };
}
function hardenedVmSecurityConfig(): Record<string, string> {
  return {
    'security.secureboot': 'true',
    'security.csm': 'false',
    'migration.stateful': 'false',
    'limits.processes': '4096',
  };
}
export function hardenedSecurityConfig(machineType: 'container' | 'vm'): Record<string, string> {
  return machineType === 'vm' ? hardenedVmSecurityConfig() : hardenedContainerSecurityConfig();
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

  // Evacuate a cluster member: Incus moves all running instances to other
  // online members with capacity. Returns the operation ID; the caller
  // can poll for completion if needed. We don't await the operation here
  // because evacuation can take many minutes for big nodes.
  async evacuateClusterMember(memberName: string): Promise<unknown> {
    return this.rawRequest('POST', `/1.0/cluster/members/${encodeURIComponent(memberName)}/state`, { action: 'evacuate' });
  }

  // Restore: opposite of evacuate. Brings instances back to a previously
  // evacuated member. Used after un-cordoning.
  async restoreClusterMember(memberName: string): Promise<unknown> {
    return this.rawRequest('POST', `/1.0/cluster/members/${encodeURIComponent(memberName)}/state`, { action: 'restore' });
  }

  // Remove a member from the cluster. Member must already be empty (drain
  // first). Used by the terminate-node op.
  async removeClusterMember(memberName: string): Promise<void> {
    await this.request('DELETE', `/cluster/members/${encodeURIComponent(memberName)}`);
  }

  // Mint a one-shot join token for a new cluster member. The returned base64
  // string is what the new node passes to `incus admin init --preseed` (or
  // its IncusOS seed equivalent) to join the existing cluster. Tokens are
  // single-use and TTL'd by Incus.
  async mintClusterJoinToken(memberName: string): Promise<{ token: string; raw: { secret?: string; fingerprint?: string; addresses?: string[] } }> {
    // POST /1.0/cluster/members returns a Token-type operation whose
    // metadata IS the join token. The operation stays in Running state
    // until the new member consumes the token (or expiry, default 3h).
    // We don't wait for completion — we read the metadata once and return.
    const envelope = await this.rawRequest<unknown>(
      'POST', '/1.0/cluster/members', { server_name: memberName }
    );
    let meta = (envelope.metadata ?? {}) as Record<string, unknown>;
    // For async-type envelopes (operation: <id>), do one GET to grab the
    // current metadata. Don't poll — token tokens don't transition.
    if ((!meta.secret || !meta.addresses) && envelope.operation) {
      const op = await this.request<Record<string, unknown>>('GET', operationPath(envelope.operation));
      const opMeta = (op?.metadata ?? {}) as Record<string, unknown>;
      if (Object.keys(opMeta).length) meta = opMeta;
    }
    const secret = typeof meta.secret === 'string' ? meta.secret : '';
    const fingerprint = typeof meta.fingerprint === 'string' ? meta.fingerprint : '';
    const addresses = Array.isArray(meta.addresses) ? meta.addresses as string[] : [];
    const serverName = typeof meta.serverName === 'string' ? meta.serverName : memberName;
    const expiresAt = typeof meta.expiresAt === 'string'
      ? meta.expiresAt
      : (typeof meta.expires_at === 'string' ? meta.expires_at as string : new Date(Date.now() + 3 * 3600_000).toISOString());
    if (!secret) throw new Error('Incus did not return a join token secret');
    // Token format Incus expects: base64(JSON({server_name, fingerprint, addresses, secret, expires_at})).
    const token = Buffer.from(JSON.stringify({
      server_name: serverName, fingerprint, addresses, secret, expires_at: expiresAt,
    })).toString('base64');
    return { token, raw: { secret, fingerprint, addresses } };
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

  getInstanceState(name: string): Promise<IncusInstanceState> {
    return this.request('GET', this.projectPath(`/instances/${encodeURIComponent(name)}/state`));
  }

  async createInstance(input: {
    name: string;
    machineType: 'container' | 'vm';
    source: CreateInstanceSource;
    targetMember: string;
    resources: { vcpu: number; memoryGb: number; diskGb: number };
    start?: boolean;
    machineId?: string;
    displayName?: string;
    // Customer / billing attribution. Stored under `user.justavps.account_id`
    // on the Incus instance config so the billing worker can read it back
    // when reconciling sessions. Without this, all revenue lands on
    // customer_id=null in RevenueLedger.
    accountId?: string | null;
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

    // Profile binding: the `default` profile carries network + root disk; the
    // type-specific platform profile carries the hardened security posture.
    // Inlining the same security keys is belt-and-suspenders — if either layer
    // drifts the other still enforces. The profile is the long-term home.
    const profiles = ['default', input.machineType === 'vm' ? 'platform-vm-default' : 'platform-container-hardened'];

    const operation = await this.requestOperation('POST', this.projectPath('/instances', { target: input.targetMember }), {
        name: input.name,
        type: input.machineType === 'vm' ? 'virtual-machine' : 'container',
        source: input.source.type === 'image'
          ? { type: 'image', alias: input.source.image }
          : { type: 'copy', source: input.source.source },
        profiles,
        config: {
          ...hardenedSecurityConfig(input.machineType),
          'limits.cpu': String(input.resources.vcpu),
          'limits.memory': `${input.resources.memoryGb}GiB`,
          ...(input.machineId ? { 'user.justavps.machine_id': input.machineId } : {}),
          'user.justavps.machine_name': input.displayName ?? input.name,
          'user.justavps.display_name': input.displayName ?? input.name,
          'user.justavps.hostname': input.name,
          ...(input.accountId ? { 'user.justavps.account_id': input.accountId } : {}),
        },
        ...(input.start ? { start: true } : {}),
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
    // 'container' produces an LXC-bootable rootfs (default). 'virtual-machine'
    // tells Incus to wrap the OCI rootfs into a bootable disk image (mkfs +
    // kernel injection) so subsequent `machines create type=vm` works against
    // it. Most modern distro images (ubuntu, debian, fedora) work as VMs;
    // scratch-derived / Alpine-without-kernel images don't and will fail
    // at boot rather than at import.
    imageType?: 'container' | 'virtual-machine';
    aliases?: Array<{ name: string; description?: string }>;
    properties?: Record<string, string>;
    public?: boolean;
  }): Promise<IncusOperation> {
    // Native Incus OCI pull. Equivalent to:
    //   incus remote add <server> --protocol=oci
    //   incus image copy <server>:<ociRef> local: --alias <aliasName> [--vm]
    const operation = await this.requestOperation('POST', this.projectPath('/images'), {
      source: {
        type: 'image',
        mode: 'pull',
        protocol: 'oci',
        server: input.server,
        alias: input.ociRef,
        image_type: input.imageType ?? 'container',
      },
      aliases: input.aliases ?? [],
      properties: input.properties ?? {},
      public: input.public ?? false,
    });
    // OCI pulls (Docker layers + convert) can take a while; give it a generous deadline.
    return this.waitOperation(operation, 600_000);
  }

  async createImageFromSimplestreams(input: {
    server: string;
    alias: string;
    imageType?: 'container' | 'virtual-machine';
    aliases?: Array<{ name: string; description?: string }>;
    properties?: Record<string, string>;
    public?: boolean;
  }): Promise<IncusOperation> {
    // Simplestreams (linuxcontainers.org / images.linuxcontainers.org) is the
    // canonical source for Incus VM-bootable images — Ubuntu, Debian, Fedora,
    // Alpine all publish container + VM variants here. OCI/Docker Hub doesn't
    // expose VM manifests for most images, so this is the path users hit when
    // they want a VM from a public catalog.
    const operation = await this.requestOperation('POST', this.projectPath('/images'), {
      source: {
        type: 'image',
        mode: 'pull',
        protocol: 'simplestreams',
        server: input.server,
        alias: input.alias,
        image_type: input.imageType ?? 'container',
      },
      aliases: input.aliases ?? [],
      properties: input.properties ?? {},
      public: input.public ?? false,
    });
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
    return this.waitOperation(operation, 600_000);
  }

  async deleteBackup(instanceName: string, backupName: string): Promise<IncusOperation> {
    const operation = await this.requestOperation('DELETE', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/backups/${encodeURIComponent(backupName)}`));
    return this.waitOperation(operation);
  }

  async exportBackup(instanceName: string, backupName: string): Promise<Buffer> {
    // Native Incus: GET /1.0/instances/<name>/backups/<backup>/export streams the backup tarball
    // body. The response is binary, not the usual JSON envelope.
    return this.rawBinaryGet(this.projectPath(`/instances/${encodeURIComponent(instanceName)}/backups/${encodeURIComponent(backupName)}/export`));
  }

  async importInstanceFromTarball(input: {
    tarball: Buffer;
    targetName?: string;
    targetMember?: string;
  }): Promise<IncusOperation> {
    // Native Incus: POST /1.0/instances with Content-Type: application/octet-stream and the
    // tarball as the body creates an instance from a backup. X-Incus-Name overrides the
    // instance name embedded in the tarball; ?target=<member> pins it to a cluster member.
    const path = this.projectPath('/instances', input.targetMember ? { target: input.targetMember } : {});
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/octet-stream',
      'Content-Length': input.tarball.length.toString(),
    };
    if (input.targetName) headers['X-Incus-Name'] = input.targetName;
    const envelope = await this.rawBinaryPost(path, input.tarball, headers);
    if (!envelope.operation) throw new Error('Incus instance import did not return an operation');
    return this.waitOperation(envelope.operation, 600_000);
  }

  // ─── Sandbox runtime: Incus-native exec + files (no in-instance daemon) ──
  // These are what gives JustAVPS its E2B/Daytona-grade sandbox primitives:
  // run a command, read/write a file, list a directory — all over the Incus
  // HTTP API. No agent has to be installed inside the instance, so any image
  // (vanilla Ubuntu, custom golden, customer-built Docker) works the same.

  async exec(instanceName: string, input: {
    command: string[];
    env?: Record<string, string>;
    cwd?: string;
    user?: number;
    group?: number;
    timeoutMs?: number;
    stdin?: string;
  }): Promise<{ exit_code: number | null; stdout: string; stderr: string }> {
    // Incus exec flow: POST /instances/<n>/exec with `wait-for-websocket=false`
    // and `record-output=true` instructs the daemon to buffer stdout/stderr
    // and write them to /1.0/instances/<n>/logs/exec_<uuid>.{stdout,stderr}.
    // We then await the operation and fetch those log files.
    const body = {
      command: input.command,
      'record-output': true,
      'wait-for-websocket': false,
      interactive: false,
      environment: input.env ?? {},
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(typeof input.user === 'number' ? { user: input.user } : {}),
      ...(typeof input.group === 'number' ? { group: input.group } : {}),
    };
    const operation = await this.requestOperation('POST', this.projectPath(`/instances/${encodeURIComponent(instanceName)}/exec`), body);
    const finalOp = await this.waitOperation(operation, input.timeoutMs ?? 600_000);
    // Operation metadata is shape-specific to the operation kind (exec puts
    // `output: { '1': path, '2': path }` and `return: <exit_code>` here).
    // The base IncusOperation type doesn't model it; widen and read through.
    const metadata = ((finalOp as unknown as { metadata?: Record<string, unknown> }).metadata ?? {}) as Record<string, unknown>;
    const output = (metadata.output ?? {}) as Record<string, string>;
    const returnCode = typeof metadata.return === 'number' ? metadata.return : null;
    // The "output" map points at log file paths; fetch each. Empty map (no
    // output) means stdout/stderr were both empty — return empty strings.
    async function readOutput(self: IncusClient, key: '1' | '2'): Promise<string> {
      const path = output[key];
      if (!path) return '';
      const buf = await self.rawBinaryGet(self.projectPath(path)).catch(() => Buffer.alloc(0));
      return buf.toString('utf8');
    }
    const [stdout, stderr] = await Promise.all([readOutput(this, '1'), readOutput(this, '2')]);
    return { exit_code: returnCode, stdout, stderr };
  }

  async createInteractiveExec(instanceName: string, input: {
    command?: string[];
    env?: Record<string, string>;
    cwd?: string;
    user?: number;
    group?: number;
    cols?: number;
    rows?: number;
  } = {}): Promise<IncusInteractiveExec> {
    const body = {
      command: input.command ?? ['/bin/bash', '-l'],
      'wait-for-websocket': true,
      interactive: true,
      environment: { TERM: 'xterm-256color', ...(input.env ?? {}) },
      width: input.cols ?? 120,
      height: input.rows ?? 32,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(typeof input.user === 'number' ? { user: input.user } : {}),
      ...(typeof input.group === 'number' ? { group: input.group } : {}),
    };
    const envelope = await this.rawRequest<IncusOperation & { metadata?: { fds?: Record<string, string> } }>(
      'POST',
      this.projectPath(`/instances/${encodeURIComponent(instanceName)}/exec`),
      body,
    );
    const fds = envelope.metadata?.metadata?.fds ?? {};
    const operation = envelope.operation ?? (envelope.metadata?.id ? `/1.0/operations/${envelope.metadata.id}` : '');
    if (!operation || !fds['0']) throw new Error('Incus interactive exec did not return a terminal websocket');
    return { operation, fds };
  }

  connectOperationWebSocket(operation: string, secret: string): WebSocket {
    const basePath = operationPath(operation).replace(/\?.*$/, '');
    const requestPath = appendQuery(`${basePath}/websocket`, { secret });
    const url = new URL(requestPath, this.endpoint);
    url.protocol = this.endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(url, {
      cert: this.cluster.clientCert,
      key: this.cluster.clientKey,
      ca: this.cluster.caCert,
      rejectUnauthorized: this.cluster.rejectUnauthorized,
      perMessageDeflate: false,
    });
  }

  sendTerminalResize(control: WebSocket | null, cols: number, rows: number) {
    if (!control || control.readyState !== WebSocket.OPEN) return;
    control.send(JSON.stringify({
      command: 'window-resize',
      args: { width: String(cols), height: String(rows) },
    }));
  }

  async pushFile(instanceName: string, targetPath: string, content: Buffer | string, opts: { mode?: number; uid?: number; gid?: number; createDirs?: boolean } = {}): Promise<void> {
    // POST /instances/<n>/files?path=<absolute> with X-Incus-Type=file
    // uploads a file. X-Incus-Mode/Uid/Gid set permissions atomically.
    const body = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Incus-Type': 'file',
      'Content-Length': body.length.toString(),
    };
    if (typeof opts.mode === 'number') headers['X-Incus-Mode'] = (opts.mode & 0o7777).toString(8).padStart(4, '0');
    if (typeof opts.uid === 'number') headers['X-Incus-Uid'] = String(opts.uid);
    if (typeof opts.gid === 'number') headers['X-Incus-Gid'] = String(opts.gid);
    const path = appendQuery(this.projectPath(`/instances/${encodeURIComponent(instanceName)}/files`), {
      path: targetPath,
      ...(opts.createDirs ? { mkdir: 'true' } : {}),
    });
    await this.rawBinaryPost(path, body, headers);
  }

  async pullFile(instanceName: string, targetPath: string): Promise<{ content: Buffer; type: string; mode: string | null }> {
    // GET /instances/<n>/files?path=<abs> returns the raw bytes for files,
    // and a JSON listing for directories (with X-Incus-Type=directory). We
    // return the raw bytes here; directory listings go through listFiles().
    const path = appendQuery(this.projectPath(`/instances/${encodeURIComponent(instanceName)}/files`), { path: targetPath });
    const requestPath = normalizePath(path);
    const options = this.requestOptions('GET', requestPath, { Accept: 'application/octet-stream' });
    const transport = this.endpoint.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if ((res.statusCode ?? 500) >= 400) {
            reject(new IncusApiError(`Incus GET ${requestPath} -> ${res.statusCode}`, res.statusCode ?? 500, body.toString('utf8')));
            return;
          }
          resolve({
            content: body,
            type: String(res.headers['x-incus-type'] ?? 'file'),
            mode: typeof res.headers['x-incus-mode'] === 'string' ? res.headers['x-incus-mode'] as string : null,
          });
        });
      });
      req.setTimeout(120_000, () => req.destroy(new Error(`Incus GET ${requestPath} timed out`)));
      req.on('error', reject);
      req.end();
    });
  }

  async listFiles(instanceName: string, dirPath: string): Promise<string[]> {
    // Directory listings come back as a JSON envelope, not a raw stream.
    return this.request<string[]>('GET', appendQuery(this.projectPath(`/instances/${encodeURIComponent(instanceName)}/files`), { path: dirPath }));
  }

  async deleteFile(instanceName: string, targetPath: string): Promise<void> {
    await this.requestOperation('DELETE', appendQuery(this.projectPath(`/instances/${encodeURIComponent(instanceName)}/files`), { path: targetPath })).catch(async () => {
      // Some Incus deletions return synchronously (no operation). Fall back to
      // a direct delete that ignores the missing-operation envelope.
      const requestPath = normalizePath(appendQuery(this.projectPath(`/instances/${encodeURIComponent(instanceName)}/files`), { path: targetPath }));
      await this.rawRequest('DELETE', requestPath);
    });
  }

  async updateInstanceConfig(name: string, config: Record<string, string>, devices?: Record<string, Record<string, string>>): Promise<IncusOperation> {
    // PATCH preserves any keys we don't send, so we only need to ship the diff.
    // Incus applies instance config patches synchronously on some versions, so
    // this route may not return an operation URL. Treat any successful sync
    // envelope as a completed operation-like result.
    const envelope = await this.rawRequest<unknown>('PATCH', this.projectPath(`/instances/${encodeURIComponent(name)}`), {
      config,
      ...(devices ? { devices } : {}),
    });
    if (envelope.operation) return this.waitOperation(envelope.operation);
    return {
      id: `${name}-config-patch`,
      class: 'task',
      description: `Patch instance ${name}`,
      status: envelope.status || 'Success',
      status_code: envelope.status_code || 200,
    };
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

    const options = this.requestOptions(method, requestPath, headers);
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

  private async rawBinaryGet(path: string): Promise<Buffer> {
    const requestPath = normalizePath(path);
    const options = this.requestOptions('GET', requestPath, { Accept: 'application/octet-stream' });
    const transport = this.endpoint.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if ((res.statusCode ?? 500) >= 400) {
            reject(new IncusApiError(`Incus GET ${requestPath} -> ${res.statusCode}`, res.statusCode ?? 500, body.toString('utf8')));
            return;
          }
          resolve(body);
        });
      });
      // Backup exports can take a while to stream — give them 10 minutes.
      req.setTimeout(600_000, () => req.destroy(new Error(`Incus GET ${requestPath} timed out`)));
      req.on('error', reject);
      req.end();
    });
  }

  private async rawBinaryPost(path: string, body: Buffer, headers: Record<string, string>): Promise<IncusEnvelope<unknown>> {
    const requestPath = normalizePath(path);
    const options = this.requestOptions('POST', requestPath, headers);
    const transport = this.endpoint.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 500) >= 400) {
            reject(new IncusApiError(`Incus POST ${requestPath} -> ${res.statusCode}`, res.statusCode ?? 500, text));
            return;
          }
          try {
            resolve(JSON.parse(text) as IncusEnvelope<unknown>);
          } catch (error) {
            reject(new Error(`Invalid Incus JSON response: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      });
      // Tarball uploads can be 100s of MB; give the request 10 minutes too.
      req.setTimeout(600_000, () => req.destroy(new Error(`Incus POST ${requestPath} timed out`)));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private requestOptions(method: string, requestPath: string, extraHeaders: Record<string, string>): http.RequestOptions | https.RequestOptions {
    // URL.hostname keeps the surrounding [..] brackets for IPv6 literals;
    // Node's net/dns layer rejects bracketed hostnames. Strip them here.
    const hostname = this.endpoint.hostname.replace(/^\[|\]$/g, '');
    const options: http.RequestOptions | https.RequestOptions = {
      protocol: this.endpoint.protocol,
      hostname,
      port: this.endpoint.port || (this.endpoint.protocol === 'https:' ? 443 : 80),
      method,
      path: requestPath,
      headers: { ...extraHeaders, Connection: 'close' },
      // Disable any agent pooling — Node creates a one-shot agent per request.
      // We saw "ssl3_read_bytes:bad record mac" in tight call sequences when
      // a pooled HTTPS socket's TLS state drifted; one-shot sockets avoid it.
      agent: false,
    };
    if (this.endpoint.protocol === 'https:') {
      Object.assign(options, {
        cert: this.cluster.clientCert,
        key: this.cluster.clientKey,
        ca: this.cluster.caCert,
        rejectUnauthorized: this.cluster.rejectUnauthorized,
      });
    }
    return options;
  }
}
