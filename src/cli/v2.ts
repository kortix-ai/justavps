#!/usr/bin/env tsx

import { readFile } from 'node:fs/promises';

import { JustAVPSV2, JustAVPSV2Error, normalizeV2BaseUrl, type JustAVPSV2ExecInput } from '../sdk/client-v2';
import { buildV2OpenApiOperations, findV2Operation, loadV2OpenApiSpec, type V2OpenApiOperation } from './openapi-v2';

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function getFlag(args: string[], names: string[]) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    for (const name of names) {
      if (arg === name) return args[i + 1] ?? null;
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return null;
}

function hasFlag(args: string[], names: string[]) {
  return args.some((arg) => names.includes(arg));
}

function parseNumberFlag(args: string[], names: string[], fallback?: number) {
  const raw = getFlag(args, names);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric value for ${names[0]}`);
  }
  return parsed;
}

function usage(operations: V2OpenApiOperation[], exitCode = 1): never {
  const grouped = operations.reduce<Record<string, V2OpenApiOperation[]>>((acc, operation) => {
    acc[operation.resource] = [...(acc[operation.resource] ?? []), operation];
    return acc;
  }, {});

  const sections = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, ops]) => {
      const lines = ops.map((op) => `  ${resource} ${op.action}${op.paramNames.length ? ` ${op.paramNames.map((name) => `<${name}>`).join(' ')}` : ''}  # ${op.summary}`);
      return [resource, ...lines].join('\n');
    })
    .join('\n\n');

  console.error(`JustAVPS V2 CLI

Generated command surface (from V2 OpenAPI):
${sections}

Manual ergonomic overrides:
  machines create --region hel1 --vcpu 2 --ram 4 --disk 80 [--name mybox] [--mode container|vm] [--docker-image nginx:latest] [--image-id <id>] [--backups]
  machines exec <machineId> -- <command> [args...]

Generic invocation:
  <resource> <action> [path params...] [--json '{...}' | --file body.json]

Examples:
  JUSTAVPS_API_KEY=... pnpm cli:v2 -- machines list
  JUSTAVPS_API_KEY=... pnpm cli:v2 -- machines get <machineId>
  JUSTAVPS_API_KEY=... pnpm cli:v2 -- machines start <machineId>
  JUSTAVPS_API_KEY=... pnpm cli:v2 -- machines exec <machineId> -- bash -lc "uname -a && whoami"
  JUSTAVPS_API_KEY=... pnpm cli:v2 -- snapshots create <machineId> --json '{}'

Environment:
  JUSTAVPS_API_KEY   Required
  JUSTAVPS_API       Optional base origin or API base (e.g. http://localhost:4100 or http://localhost:4100/api/v2)
  JUSTAVPS_API_URL   Optional alias for JUSTAVPS_API
`);
  process.exit(exitCode);
}

function buildPath(operation: V2OpenApiOperation, params: string[]) {
  if (params.length < operation.paramNames.length) {
    throw new Error(`${operation.resource} ${operation.action} requires ${operation.paramNames.length} parameter(s): ${operation.paramNames.join(', ')}`);
  }
  let path = operation.path;
  operation.paramNames.forEach((name, index) => {
    path = path.replace(`{${name}}`, encodeURIComponent(params[index]));
  });
  return path.replace(/^\/api\/v2/, '');
}

async function parseBodyFromArgs(args: string[]) {
  const inline = getFlag(args, ['--json']);
  if (inline) return JSON.parse(inline);
  const file = getFlag(args, ['--file']);
  if (file) {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  }
  return undefined;
}

async function invokeGeneratedOperation(client: JustAVPSV2, operation: V2OpenApiOperation, args: string[]) {
  const positionalArgs = args.filter((arg, index) => {
    if (arg.startsWith('--')) return false;
    const prev = args[index - 1];
    if (prev && prev.startsWith('--') && !prev.includes('=')) return false;
    return true;
  });

  const path = buildPath(operation, positionalArgs);
  const body = operation.hasBody ? await parseBodyFromArgs(args) : undefined;
  const http = (client as unknown as { _http: { get: <T>(path: string) => Promise<T>; post: <T>(path: string, body?: unknown) => Promise<T>; delete: <T>(path: string) => Promise<T> } })._http;

  switch (operation.method) {
    case 'GET':
      return http.get(path);
    case 'POST':
      return http.post(path, body ?? {});
    case 'DELETE':
      return http.delete(path);
    default:
      throw new Error(`Unsupported generated CLI method: ${operation.method}`);
  }
}

async function main() {
  const apiKey = process.env.JUSTAVPS_API_KEY;
  if (!apiKey) {
    console.error('JUSTAVPS_API_KEY is required');
    process.exit(1);
  }

  const baseUrl = normalizeV2BaseUrl(process.env.JUSTAVPS_API || process.env.JUSTAVPS_API_URL);
  const spec = await loadV2OpenApiSpec(baseUrl);
  const operations = buildV2OpenApiOperations(spec);
  const client = new JustAVPSV2({ apiKey, baseUrl });

  const argv = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
  const [resourceOrAlias, actionOrId, ...rest] = argv;

  if (!resourceOrAlias || ['help', '--help', '-h'].includes(resourceOrAlias)) {
    usage(operations, resourceOrAlias ? 0 : 1);
  }

  const aliasMap: Record<string, [string, string]> = {
    list: ['machines', 'list'],
    get: ['machines', 'get'],
    create: ['machines', 'create'],
    start: ['machines', 'start'],
    stop: ['machines', 'stop'],
    reboot: ['machines', 'reboot'],
    delete: ['machines', 'delete'],
    exec: ['machines', 'exec'],
  };

  const [resource, action] = aliasMap[resourceOrAlias] ?? [resourceOrAlias, actionOrId];
  const remaining = aliasMap[resourceOrAlias] ? [actionOrId, ...rest].filter((value): value is string => Boolean(value)) : rest;

  if (!resource || !action) {
    usage(operations);
  }

  if (resource === 'machines' && action === 'create' && !getFlag(remaining, ['--json', '--file'])) {
    const region = getFlag(remaining, ['--region']);
    const vcpu = parseNumberFlag(remaining, ['--vcpu']);
    const ram = parseNumberFlag(remaining, ['--ram']);
    const disk = parseNumberFlag(remaining, ['--disk']);
    if (!region || vcpu == null || ram == null || disk == null) usage(operations);
    const payload = {
      name: getFlag(remaining, ['--name']) ?? undefined,
      region,
      vcpu,
      ram_gb: ram,
      disk_gb: disk,
      machine_mode: (getFlag(remaining, ['--mode']) ?? 'container') as 'container' | 'vm',
      docker_image: getFlag(remaining, ['--docker-image']) ?? undefined,
      image_id: getFlag(remaining, ['--image-id']) ?? undefined,
      enable_backups: hasFlag(remaining, ['--backups']),
    };
    printJson(await client.machines.create(payload));
    return;
  }

  if (resource === 'machines' && action === 'exec') {
    const id = remaining[0];
    if (!id) usage(operations);
    const delimiterIndex = remaining.indexOf('--');
    const commandArgs = delimiterIndex >= 0 ? remaining.slice(delimiterIndex + 1) : remaining.slice(1);
    if (commandArgs.length === 0) {
      throw new Error('exec requires a command after --');
    }
    const [cmd, ...cmdArgs] = commandArgs;
    const execInput: JustAVPSV2ExecInput = { command: cmd, args: cmdArgs };
    const cwd = getFlag(remaining, ['--cwd']);
    if (cwd) execInput.cwd = cwd;
    const timeoutMs = parseNumberFlag(remaining, ['--timeout-ms']);
    if (timeoutMs != null) execInput.timeout_ms = timeoutMs;
    const result = await client.machines.exec(id, execInput);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exit_code;
    return;
  }

  const operation = findV2Operation(operations, resource, action);
  if (!operation) {
    throw new Error(`Unknown command: ${resource} ${action}`);
  }

  const result = await invokeGeneratedOperation(client, operation, remaining);
  printJson(result);
}

main().catch((error) => {
  if (error instanceof JustAVPSV2Error) {
    console.error(`JustAVPS V2 API error (${error.status ?? 'unknown'}): ${error.message}`);
    if (error.body) console.error(JSON.stringify(error.body, null, 2));
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
