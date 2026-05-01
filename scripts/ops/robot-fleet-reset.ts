#!/usr/bin/env tsx
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

type Mode = 'status' | 'rescue-reset' | 'probe-ipv6-ssh';

const HOSTS = [
  { server: 2921540, ipv4: '135.181.129.188', ipv6Prefix: '2a01:4f9:4b:2099', member: 'justavps-hel1-1', onlineCapacity: true },
  { server: 2934090, ipv4: '65.109.65.169', ipv6Prefix: null, member: 'justavps-hel1-2', onlineCapacity: true },
  { server: 2953015, ipv4: null, ipv6Prefix: '2a01:4f9:3081:4ed9', member: 'justavps-hel1-3', onlineCapacity: false },
  { server: 2954525, ipv4: '65.21.92.151', ipv6Prefix: null, member: 'justavps-hel1-4', onlineCapacity: true },
  { server: 2962783, ipv4: null, ipv6Prefix: '2a01:4f9:5a:1c8c', member: 'justavps-hel1-5', onlineCapacity: false },
  { server: 2985438, ipv4: '148.251.79.137', ipv6Prefix: null, member: 'justavps-hel1-6', onlineCapacity: true },
] as const;

const env = loadEnv(['.env', '.env.local', 'apps/v2-api/.env.local']);
const robotUser = env.HETZNER_ROBOT_USER || process.env.HETZNER_ROBOT_USER;
const robotPassword = env.HETZNER_ROBOT_PASSWORD || process.env.HETZNER_ROBOT_PASSWORD;
if (!robotUser || !robotPassword) throw new Error('Missing HETZNER_ROBOT_USER/HETZNER_ROBOT_PASSWORD');
const auth = `Basic ${Buffer.from(`${robotUser}:${robotPassword}`).toString('base64')}`;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const mode = arg('--mode') as Mode || 'status';
  const target = arg('--server');
  const execute = process.argv.includes('--execute');
  const confirm = arg('--confirm');
  const rescueOs = arg('--os') || 'linux';
  const resetType = arg('--reset') || 'hw';
  const jumpHost = arg('--jump') || '135.181.129.188';
  const fingerprint = arg('--fingerprint') || '0a:db:9f:08:87:87:e1:f0:81:9a:07:e1:d0:67:54:56';

  if (!['status', 'rescue-reset', 'probe-ipv6-ssh'].includes(mode)) {
    throw new Error(`Unknown --mode ${mode}`);
  }

  const selected = HOSTS.filter((host) => !target || String(host.server) === target);
  if (selected.length === 0) throw new Error(`No host matches --server ${target}`);

  if (mode === 'rescue-reset') {
    const unsafe = selected.filter((host) => host.onlineCapacity);
    if (unsafe.length > 0) {
      throw new Error(`Refusing to reset online capacity hosts: ${unsafe.map((h) => h.server).join(', ')}`);
    }
    if (!execute || confirm !== 'RESET IPV6 RESCUE HOSTS') {
      console.log('DRY RUN: add --execute --confirm "RESET IPV6 RESCUE HOSTS" to activate Rescue + reset non-capacity targets.');
    }
  }

  for (const host of selected) {
    console.log(`\n## ${host.server} ${host.member}`);
    if (mode === 'status') {
      console.log('server', redact(await robot('GET', `/server/${host.server}`)));
      console.log('rescue', redact(await robot('GET', `/boot/${host.server}/rescue`)));
      console.log('reset', redact(await robot('GET', `/reset/${host.server}`)));
    }

    if (mode === 'rescue-reset') {
      console.log('target', { server: host.server, ipv4: host.ipv4, ipv6Prefix: host.ipv6Prefix, member: host.member });
      if (!execute || confirm !== 'RESET IPV6 RESCUE HOSTS') continue;
      const rescue = await robot('POST', `/boot/${host.server}/rescue`, {
        os: rescueOs,
        arch: '64',
        'authorized_key[]': [fingerprint],
      });
      console.log('rescue activated', redact(rescue));
      const reset = await robot('POST', `/reset/${host.server}`, { type: resetType });
      console.log('reset requested', redact(reset));
    }

    if (mode === 'probe-ipv6-ssh') {
      if (!host.ipv6Prefix) {
        console.log('skip: no IPv6 prefix');
        continue;
      }
      const result = probeIpv6Ssh(host.ipv6Prefix, jumpHost);
      console.log('probe', result);
    }
  }
}

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadEnv(paths: string[]) {
  const out: Record<string, string> = {};
  for (const path of paths) {
    if (!fs.existsSync(path)) continue;
    for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const [key, ...rest] = line.split('=');
      out[key] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}

async function robot(method: string, path: string, params?: Record<string, string | string[]>) {
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const res = await fetch(`https://robot-ws.your-server.de${path}`, {
    method,
    headers: {
      Authorization: auth,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(redact(payload))}`);
  return payload;
}

function flatten(params: Record<string, string | string[]>) {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => pairs.push([key, item]));
    else pairs.push([key, value]);
  }
  return pairs;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = /password|secret|token/i.test(key) ? '[REDACTED]' : redact(inner);
    }
    return out;
  }
  return value;
}

function probeIpv6Ssh(prefix: string, jump: string) {
  const script = `import socket\nprefix=${JSON.stringify(prefix)}\nsuffixes=['','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f','10','20','42','64','100','101','200','ffff']\nfor suf in suffixes:\n    ip=prefix+'::'+suf if suf else prefix+'::'\n    s=socket.socket(socket.AF_INET6,socket.SOCK_STREAM); s.settimeout(1.0)\n    try:\n        s.connect((ip,22,0,0)); print('OPEN '+ip); raise SystemExit(0)\n    except Exception as e:\n        print('closed '+ip+' '+type(e).__name__+' '+str(e)[:48])\n    finally:\n        s.close()\nprint('NO_OPEN')\n`;
  const result = spawnSync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-i', `${process.env.HOME}/.ssh/justavps_host`,
    `root@${jump}`,
    'python3', '-',
  ], { input: script, text: true, encoding: 'utf8' });
  return { exitCode: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
