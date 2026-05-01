#!/usr/bin/env node
/**
 * `justavps` — CLI for the JustAVPS V2 API.
 *
 * Built directly on the published SDK, so the CLI surface is automatically
 * in sync with the API: regenerate `sdk/generated/`, the CLI gets new types
 * for free.
 *
 * Auth + base URL: `JUSTAVPS_TOKEN` and `JUSTAVPS_API_URL` env vars first,
 * then a config file at `$XDG_CONFIG_HOME/justavps/config.json` (or
 * `~/.config/justavps/config.json`). `justavps login` writes that file.
 */

import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readFileSync as fsRead } from 'node:fs';
import { JustAVPSV2, JustAVPSV2Error } from '../sdk/client.js';

type Config = { baseUrl: string; token?: string };
let commandJson = false;

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg && xdg.length ? xdg : join(homedir(), '.config'), 'justavps', 'config.json');
}

function loadConfig(): Config {
  // Env wins so CI / per-shell overrides are easy. Falls back to the
  // login-written config file. Defaults to localhost:4200 (the dev port).
  const fileConfig: Partial<Config> = (() => {
    const path = configPath();
    if (!existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>; } catch { return {}; }
  })();
  return {
    baseUrl: process.env.JUSTAVPS_API_URL?.trim() || fileConfig.baseUrl || 'http://localhost:4200',
    token: process.env.JUSTAVPS_TOKEN?.trim() || fileConfig.token,
  };
}

function saveConfig(config: Config) {
  const path = configPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function client(): JustAVPSV2 {
  const cfg = loadConfig();
  return new JustAVPSV2({ baseUrl: cfg.baseUrl, token: cfg.token });
}

// Renderers — keep `--json` available everywhere so output is machine-pipeable.
function emit(value: unknown, opts: { json?: boolean }) {
  if (opts.json || commandJson) {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  // Non-JSON: small structured shapes get a clean key=value rendering, arrays
  // become tab-separated tables. Falls back to JSON for nested complexity so
  // we never silently drop fields.
  if (Array.isArray(value)) {
    if (!value.length) { process.stdout.write('(empty)\n'); return; }
    const cols = Object.keys(value[0] ?? {});
    process.stdout.write(cols.join('\t') + '\n');
    for (const row of value) process.stdout.write(cols.map((c) => formatCell((row as Record<string, unknown>)[c])).join('\t') + '\n');
    return;
  }
  if (value && typeof value === 'object') {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  process.stdout.write(String(value) + '\n');
}

function formatCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseJsonInput(value: string | undefined, fallback: unknown = undefined) {
  if (value === undefined) return fallback;
  try { return JSON.parse(value); } catch (error) { throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function parsePairs(values: string[] = []) {
  const out: Record<string, string> = {};
  for (const pair of values) {
    const idx = pair.indexOf('=');
    if (idx <= 0) throw new Error(`Expected KEY=VALUE, got ${pair}`);
    out[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return out;
}

async function rawApi(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}) {
  const cfg = loadConfig();
  const url = new URL(path.startsWith('http') ? path : `${cfg.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) url.searchParams.set(key, value);
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const response = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    },
    body,
  });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!response.ok) throw new JustAVPSV2Error(`${response.status} ${response.statusText}`, response.status, data);
  return data;
}

async function run(fn: () => Promise<void>) {
  try { await fn(); } catch (error) {
    if (error instanceof JustAVPSV2Error) {
      process.stderr.write(`error: ${error.message}\n`);
      if (error.body) process.stderr.write(JSON.stringify(error.body, null, 2) + '\n');
      process.exit(1);
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

const program = new Command();
program
  .name('justavps')
  .description('JustAVPS V2 CLI — sandbox + machine lifecycle, snapshots, backups, exec, files.')
  .version('0.2.0')
  .option('--json', 'Emit raw JSON output (skip the pretty renderer).')
  // Required so child commands (e.g. `machines exec`) can call
  // .passThroughOptions() and forward `-a`, `--flag`, etc. to the remote
  // process instead of having Commander interpret them.
  .enablePositionalOptions();

program
  .command('login')
  .description('Save base URL + bearer token to ~/.config/justavps/config.json.')
  .option('--base-url <url>', 'API base URL', 'http://localhost:4200')
  .option('--token <token>', 'Bearer token (will be stored in plaintext at ~/.config/justavps/config.json).')
  .action((opts) => {
    if (!opts.token) {
      process.stderr.write('--token is required (or set JUSTAVPS_TOKEN env).\n');
      process.exit(1);
    }
    saveConfig({ baseUrl: opts.baseUrl, token: opts.token });
    process.stdout.write(`saved config to ${configPath()}\n`);
  });

program.command('health').description('Health probe.').action(() => run(async () => emit(await client().health(), program.opts())));
program.command('regions').description('List configured regions.').action(() => run(async () => emit((await client().regions()).regions, program.opts())));
program.command('ls').description('Alias for `machines list`.').action(() => run(async () => emit((await client().machines.list()).machines, program.opts())));

const machines = program.command('machines').description('Sandbox / machine lifecycle.').enablePositionalOptions();
machines.command('list').alias('ls').description('List machines.').action(() => run(async () => emit((await client().machines.list()).machines, program.opts())));
machines.command('get <id>').description('Get a single machine.').action((id) => run(async () => emit((await client().machines.get(id)).machine, program.opts())));
machines.command('create')
  .description('Create a machine. Pass --image for an image source, or --snapshot / --backup to clone from an artifact.')
  .option('--region <region>', 'Region', 'eu')
  .option('--type <type>', 'container | vm', 'container')
  .option('--name <name>', 'Optional name')
  .option('--vcpu <n>', 'vCPU count', '1')
  .option('--memory <gb>', 'Memory GB', '1')
  .option('--disk <gb>', 'Disk GB', '10')
  .option('--image <alias>', 'Image alias / fingerprint to clone from')
  .option('--snapshot <id>', 'Snapshot ID (cuid or "<machineId>/<snapshotName>")')
  .option('--backup <id>', 'Backup ID (cuid or "<machineId>/<backupName>")')
  .option('--start', 'Start the machine after create.')
  // Daytona-style ergonomics — env + labels + lifecycle.
  .option('--env <KEY=VAL...>', 'Environment variable. Repeatable. Auto-merged into every exec.', (v: string, prev: string[] = []) => prev.concat(v), [] as string[])
  .option('--label <KEY=VAL...>', 'Free-form label. Repeatable.', (v: string, prev: string[] = []) => prev.concat(v), [] as string[])
  .option('--auto-stop <min>', 'Idle minutes before automatic stop. 0 disables.')
  .option('--auto-archive <min>', 'Stopped minutes before archive. 0 disables.')
  .option('--auto-delete <min>', 'Stopped minutes before hard delete. 0 disables.')
  .option('--ephemeral', 'Delete the machine the moment it stops.')
  .action((opts) => run(async () => {
    const sources = [opts.image && 'image', opts.snapshot && 'snapshot', opts.backup && 'backup'].filter(Boolean);
    if (sources.length !== 1) throw new Error('Pass exactly one of --image / --snapshot / --backup.');
    const source = opts.image
      ? { type: 'image' as const, image_id: opts.image }
      : opts.snapshot
        ? { type: 'snapshot' as const, snapshot_id: opts.snapshot }
        : { type: 'backup' as const, backup_id: opts.backup };
    const env: Record<string, string> = {};
    for (const pair of opts.env ?? []) { const idx = pair.indexOf('='); if (idx > 0) env[pair.slice(0, idx)] = pair.slice(idx + 1); }
    const labels: Record<string, string> = {};
    for (const pair of opts.label ?? []) { const idx = pair.indexOf('='); if (idx > 0) labels[pair.slice(0, idx)] = pair.slice(idx + 1); }
    const lifecycle: Record<string, number | boolean> = {};
    if (opts.autoStop != null) lifecycle.auto_stop_min = Number(opts.autoStop);
    if (opts.autoArchive != null) lifecycle.auto_archive_min = Number(opts.autoArchive);
    if (opts.autoDelete != null) lifecycle.auto_delete_min = Number(opts.autoDelete);
    if (opts.ephemeral) lifecycle.ephemeral = true;
    const c = client();
    const created = await c.machines.create({
      region: opts.region,
      type: opts.type,
      name: opts.name,
      resources: { vcpu: Number(opts.vcpu), memory_gb: Number(opts.memory), disk_gb: Number(opts.disk) },
      source,
      ...(Object.keys(env).length ? { env } : {}),
      ...(Object.keys(labels).length ? { labels } : {}),
      ...(Object.keys(lifecycle).length ? { lifecycle } : {}),
    });
    if (opts.start && created.machine?.id) await c.machines.start(created.machine.id);
    emit(created.machine, program.opts());
  }));
machines.command('start <id>').description('Start a machine.').action((id) => run(async () => emit(await client().machines.start(id), program.opts())));
machines.command('stop <id>').description('Stop a machine.').action((id) => run(async () => emit(await client().machines.stop(id), program.opts())));
machines.command('reboot <id>').description('Reboot a machine.').action((id) => run(async () => emit(await client().machines.reboot(id), program.opts())));
machines.command('delete <id>').description('Force-delete a machine.').action((id) => run(async () => emit(await client().machines.delete(id), program.opts())));
machines.command('resize <id>')
  .description('Live-resize a running machine. At least one of --vcpu / --memory / --disk required.')
  .option('--vcpu <n>', 'New vCPU count')
  .option('--memory <gb>', 'New memory GB')
  .option('--disk <gb>', 'New disk GB cap (grows lazily)')
  .action((id, opts) => run(async () => {
    const resources: Record<string, number> = {};
    if (opts.vcpu != null) resources.vcpu = Number(opts.vcpu);
    if (opts.memory != null) resources.memory_gb = Number(opts.memory);
    if (opts.disk != null) resources.disk_gb = Number(opts.disk);
    if (!Object.keys(resources).length) throw new Error('Pass at least one of --vcpu / --memory / --disk.');
    emit(await client().machines.resize(id, resources), program.opts());
  }));

machines.command('exec <id> [command...]')
  .description('Run a shell command inside a machine. Joins remaining args as the command. Use --argv to skip the shell wrapper.')
  .option('--argv', 'Treat command... as argv (no /bin/sh -c wrapper).')
  .option('--cwd <dir>', 'Working directory')
  .option('--env <KEY=VAL...>', 'Environment variable. Repeatable.', (val: string, prev: string[] = []) => prev.concat(val), [] as string[])
  .option('--timeout-ms <ms>', 'Hard timeout in milliseconds', '600000')
  // Anything after the positional `id` is the command to run inside the
  // sandbox — including `-a`, `--flag`, etc. passThroughOptions tells
  // Commander to stop parsing options once a positional starts, so these
  // forward intact to the remote process instead of erroring.
  .passThroughOptions()
  .allowUnknownOption(true)
  .action((id, command: string[], opts) => run(async () => {
    if (!command.length) throw new Error('No command provided.');
    const env: Record<string, string> = {};
    for (const pair of opts.env ?? []) { const idx = pair.indexOf('='); if (idx > 0) env[pair.slice(0, idx)] = pair.slice(idx + 1); }
    const result = await client().machines.exec(id, {
      command: opts.argv ? command : command.join(' '),
      cwd: opts.cwd,
      env,
      timeout_ms: Number(opts.timeoutMs ?? opts.timeout_ms ?? 600000),
    });
    if (program.opts().json || commandJson) { emit(result, program.opts()); return; }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.exit_code !== 0) process.exit(typeof result.exit_code === 'number' ? result.exit_code : 1);
  }));

program.command('exec <id> [command...]')
  .description('Alias for `machines exec <id> ...`.')
  .option('--argv', 'Treat command... as argv (no /bin/sh -c wrapper).')
  .option('--cwd <dir>', 'Working directory')
  .option('--env <KEY=VAL...>', 'Environment variable. Repeatable.', (val: string, prev: string[] = []) => prev.concat(val), [] as string[])
  .option('--timeout-ms <ms>', 'Hard timeout in milliseconds', '600000')
  .passThroughOptions()
  .allowUnknownOption(true)
  .action((id, command: string[], opts) => run(async () => {
    if (!command.length) throw new Error('No command provided.');
    const result = await client().machines.exec(id, {
      command: opts.argv ? command : command.join(' '),
      cwd: opts.cwd,
      env: parsePairs(opts.env ?? []),
      timeout_ms: Number(opts.timeoutMs ?? opts.timeout_ms ?? 600000),
    });
    if (program.opts().json || commandJson) { emit(result, program.opts()); return; }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.exit_code !== 0) process.exit(typeof result.exit_code === 'number' ? result.exit_code : 1);
  }));

const apiCommands = program.command('api').description('Raw OpenAPI-driven API runner for endpoints not wrapped by ergonomic commands.');
apiCommands.command('ls')
  .description('List operations from /docs/openapi.json.')
  .action(() => run(async () => {
    const spec = await rawApi('GET', '/docs/openapi.json') as { paths?: Record<string, Record<string, { summary?: string; tags?: string[] }>> };
    const rows = Object.entries(spec.paths ?? {}).flatMap(([path, methods]) => Object.entries(methods)
      .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map(([method, op]) => ({ method: method.toUpperCase(), path, tag: op.tags?.[0] ?? '', summary: op.summary ?? '' })));
    emit(rows, program.opts());
  }));
apiCommands.command('call <method> <path>')
  .description('Call any API route. Example: justavps api call GET /machines')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Read JSON request body from file')
  .option('--query <KEY=VALUE...>', 'Query parameter. Repeatable.', (val: string, prev: string[] = []) => prev.concat(val), [] as string[])
  .action((method, path, opts) => run(async () => {
    if (opts.body && opts.bodyFile) throw new Error('Use either --body or --body-file, not both.');
    const body = opts.bodyFile ? parseJsonInput(readFileSync(opts.bodyFile, 'utf8')) : parseJsonInput(opts.body, undefined);
    emit(await rawApi(method, path, { query: parsePairs(opts.query ?? []), body }), program.opts());
  }));

const files = program.command('files').description('In-sandbox filesystem operations.');
files.command('read <id> <path>')
  .description('Read a file from the sandbox. Prints raw content to stdout.')
  .action((id, path) => run(async () => {
    const result = await client().files.read(id, path);
    const r = result as { content?: string; encoding?: string; entries?: string[] };
    if (Array.isArray(r.entries)) { emit(r.entries, program.opts()); return; }
    if (program.opts().json || commandJson) { emit(result, program.opts()); return; }
    if (r.encoding === 'base64' && typeof r.content === 'string') process.stdout.write(Buffer.from(r.content, 'base64'));
    else if (typeof r.content === 'string') process.stdout.write(r.content);
  }));
files.command('write <id> <path> [content]')
  .description('Write a file. Reads from stdin if [content] is omitted; pass --from-file to upload from disk.')
  .option('--from-file <path>', 'Read the body from a local file instead of stdin/argv.')
  .option('--mode <octal>', 'Permission bits (e.g. 0644).')
  .option('--create-dirs', 'mkdir -p the parent directory.')
  .action((id, path, content, opts) => run(async () => {
    const body = opts.fromFile
      ? fsRead(opts.fromFile)
      : typeof content === 'string'
        ? Buffer.from(content, 'utf8')
        : await readStdin();
    // We always JSON-serialize; binary uploads use base64 to survive the JSON round-trip.
    const isBinary = !isUtf8Buffer(body);
    await client().files.write(id, {
      path,
      content: isBinary ? body.toString('base64') : body.toString('utf8'),
      encoding: isBinary ? 'base64' : 'utf8',
      mode: opts.mode ? parseInt(opts.mode, 8) : undefined,
      create_dirs: !!opts.createDirs,
    });
    process.stdout.write('ok\n');
  }));
files.command('delete <id> <path>')
  .description('Delete a file or directory inside the sandbox.')
  .action((id, path) => run(async () => emit(await client().files.delete(id, path), program.opts())));

const snapshots = program.command('snapshots').description('Snapshot lifecycle.');
snapshots.command('list <machineId>').action((id) => run(async () => emit((await client().snapshots.list(id)).snapshots, program.opts())));
snapshots.command('create <machineId>').option('--name <name>').action((id, opts) => run(async () => emit(await client().snapshots.create(id, { name: opts.name }), program.opts())));
snapshots.command('restore <machineId> <name>').action((id, name) => run(async () => emit(await client().snapshots.restore(id, name), program.opts())));
snapshots.command('delete <machineId> <name>').action((id, name) => run(async () => emit(await client().snapshots.delete(id, name), program.opts())));

const backups = program.command('backups').description('Backup lifecycle (Incus tarball).');
backups.command('list <machineId>').action((id) => run(async () => emit((await client().backups.list(id)).backups, program.opts())));
backups.command('create <machineId>').option('--name <name>').action((id, opts) => run(async () => emit(await client().backups.create(id, { name: opts.name }), program.opts())));
backups.command('restore <machineId> <name>').action((id, name) => run(async () => emit(await client().backups.restore(id, name), program.opts())));
backups.command('delete <machineId> <name>').action((id, name) => run(async () => emit(await client().backups.delete(id, name), program.opts())));

const proxyTokens = program.command('proxy-tokens').description('Share/revoke HTTP proxy access tokens.');
proxyTokens.command('list').option('--machine <id>', 'Filter by machine id').action((opts) => run(async () => emit((await client().proxyTokens.list({ machine_id: opts.machine })).proxy_tokens, program.opts())));
proxyTokens.command('create <machineId>')
  .option('--label <label>')
  .option('--port <port...>', 'Allowed port. Repeatable/list.', (val: string, prev: number[] = []) => prev.concat(Number(val)), [] as number[])
  .option('--ttl <seconds>', 'Seconds until expiry')
  .action((machineId, opts) => run(async () => emit(await client().proxyTokens.create({
    machine_id: machineId,
    label: opts.label,
    ports: opts.port?.length ? opts.port : undefined,
    expires_in_seconds: opts.ttl ? Number(opts.ttl) : undefined,
  }), program.opts())));
proxyTokens.command('revoke <id>').alias('delete').action((id) => run(async () => emit(await client().proxyTokens.delete(id), program.opts())));

const ssh = program.command('ssh').description('Short-lived SSH gateway tokens.');
ssh.command('list').option('--machine <id>', 'Filter by machine id').action((opts) => run(async () => emit((await client().sshTokens.list({ machine_id: opts.machine })).ssh_tokens, program.opts())));
ssh.command('create <machineId>')
  .option('--label <label>')
  .option('--ttl <seconds>', 'Seconds until expiry')
  .action((machineId, opts) => run(async () => emit(await client().sshTokens.create({
    machine_id: machineId,
    label: opts.label,
    expires_in_seconds: opts.ttl ? Number(opts.ttl) : undefined,
  }), program.opts())));

const templates = program.command('templates').description('Curated base image templates.');
templates.command('list').alias('ls').action(() => run(async () => emit((await client().templates.list()).templates, program.opts())));
templates.command('purge-extras').description('Delete non-template cached images from every cluster.').action(() => run(async () => emit(await client().templates.purgeExtras(), program.opts())));

// ─── admin: node provisioning ────────────────────────────────────────
const admin = program.command('admin').description('Operator-only commands.');
const adminNodes = admin.command('nodes').description('Add nodes to Incus clusters.');
adminNodes.command('list').description('List recent provisioning runs.').action(() => run(async () => emit((await client().admin.nodes.list()).runs, program.opts())));
adminNodes.command('get <id>').description('Get full state of one provisioning run.').action((id) => run(async () => emit((await client().admin.nodes.get(id)).run, program.opts())));
adminNodes.command('add')
  .description('Schedule a node-provisioning run. Default source=byo (existing host).')
  .requiredOption('--cluster <id>', 'Target Incus cluster id (e.g. hel1)')
  .option('--source <s>', 'byo | hetzner-buy', 'byo')
  .option('--target-os <os>', 'ubuntu-incus | incus-os', 'ubuntu-incus')
  .option('--ssh-host <host>', 'IP / hostname of the new node')
  .option('--ssh-user <user>', 'SSH user', 'root')
  .option('--ssh-port <port>', 'SSH port', '22')
  .option('--hetzner-server <number>', 'Hetzner Robot server number (hetzner-buy source)')
  .action((opts) => run(async () => {
    const body: Parameters<ReturnType<typeof client>['admin']['nodes']['add']>[0] = {
      cluster_id: opts.cluster,
      source: opts.source,
      target_os: opts.targetOs,
    };
    if (opts.sshHost) body.ssh_host = opts.sshHost;
    if (opts.sshUser) body.ssh_user = opts.sshUser;
    if (opts.sshPort) body.ssh_port = Number(opts.sshPort);
    if (opts.hetznerServer) body.hetzner_server_number = Number(opts.hetznerServer);
    emit((await client().admin.nodes.add(body)).run, program.opts());
  }));
adminNodes.command('drive <id>').description('Manually drive a pending/failed run on the API process.').action((id) => run(async () => emit(await client().admin.nodes.drive(id), program.opts())));
adminNodes.command('retry <id>').description('Reset failed steps + mark pending so the worker re-drives.').action((id) => run(async () => emit(await client().admin.nodes.retry(id), program.opts())));
adminNodes.command('cancel <id>').description('Mark the run cancelled (runner stops at next step boundary).').action((id) => run(async () => emit(await client().admin.nodes.cancel(id), program.opts())));

const images = program.command('images').description('Image catalog.');
images.command('list').action(() => run(async () => emit((await client().images.list()).images, program.opts())));
images.command('pull <ref>')
  .description('Pull an image into the catalog. Defaults to docker.io OCI; use --from=simplestreams for VM-bootable public images (e.g. ubuntu/22.04).')
  .option('--name <alias>', 'Local alias to attach (default: derived from ref).')
  .option('--vm', 'Pull as VM-bootable. For Docker Hub: usually fails (most images lack VM manifests). For simplestreams: works for ubuntu/debian/fedora/alpine.')
  .option('--from <protocol>', 'Source protocol: docker | simplestreams', 'docker')
  .action((ref, opts) => run(async () => {
    const body: Record<string, unknown> = { name: opts.name };
    if (opts.from === 'simplestreams') body.simplestreams = { ref, as_vm: !!opts.vm };
    else body.docker = { ref, as_vm: !!opts.vm };
    emit(await client().images.create(body as never), program.opts());
  }));
images.command('delete <id>').action((id) => run(async () => emit(await client().images.delete(id), program.opts())));
images.command('prewarm <id>').description('Pre-cache the image so first user create is fast.').action((id) => run(async () => emit(await client().images.prewarm(id), program.opts())));

function addJsonEverywhere(command: Command) {
  for (const child of command.commands) {
    child.option('--json', 'Emit raw JSON output (can be placed after subcommands).');
    addJsonEverywhere(child);
  }
}

addJsonEverywhere(program);
program.hook('preAction', (_thisCommand, actionCommand) => {
  commandJson = Boolean(program.opts().json);
  let current: Command | null = actionCommand;
  while (current) {
    commandJson = commandJson || Boolean(current.opts().json);
    current = current.parent ?? null;
  }
});

async function readStdin(): Promise<Buffer> {
  // Bounded by callers — avoid hanging if stdin is a terminal with no input.
  if (process.stdin.isTTY) throw new Error('No content provided. Pipe data into stdin or pass [content] as an arg.');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

function isUtf8Buffer(buf: Buffer): boolean {
  // Round-trip test: if a buffer survives utf8 → utf8 unchanged, treat it as
  // text. Otherwise it's binary and gets base64-encoded for the JSON payload.
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
}

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
