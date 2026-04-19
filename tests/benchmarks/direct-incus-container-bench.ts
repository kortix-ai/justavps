#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || '135.181.129.188';
const SSH_KEY = process.env.E2E_BAREMETAL_SSH_KEY || `${process.env.HOME}/.ssh/justavps_host`;
const RUNNER_HOST = `root@${TARGET_HOST_IP}`;

async function ssh(command: string, timeoutMs = 300_000) {
  const { stdout, stderr } = await execFileAsync(
    'ssh',
    ['-i', SSH_KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', RUNNER_HOST, command],
    { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
  );
  return { stdout, stderr };
}

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function bench(name: string, extraArgs: string[]) {
  const args = [
    'incus', 'launch', 'justavps-golden-container', name,
    '-c', 'security.privileged=false',
    '-c', 'security.idmap.isolated=true',
    '-c', 'security.nesting=false',
    '-c', 'security.syscalls.intercept.mount=false',
    '-c', 'security.syscalls.intercept.setxattr=false',
    '-c', 'limits.cpu=2',
    '-c', 'limits.memory=4GiB',
    '-d', 'root,size=20GiB',
    ...extraArgs,
  ];
  const launchCmd = args.map(shQuote).join(' ');
  const script = [
    'set -e',
    'ts=$(date +%s%3N)',
    launchCmd,
    'launch_end=$(date +%s%3N)',
    'ip=""',
    'for i in $(seq 1 200); do ip=$(incus list ' + shQuote(name) + ' --format csv -c 4 | tr -d "[:space:]"); [ -n "$ip" ] && break; sleep 0.025; done',
    'ip_end=$(date +%s%3N)',
    'printf "launch_ms=%s ip_ready_ms=%s ip=%s\n" "$((launch_end-ts))" "$((ip_end-ts))" "$ip"',
    'incus delete ' + shQuote(name) + ' --force >/dev/null 2>&1 || true',
  ].join('; ');
  const { stdout } = await ssh(`bash -lc ${shQuote(script)}`);
  return stdout.trim();
}

async function main() {
  const base = `bench-direct-${Date.now()}`;
  console.log('dynamic');
  console.log(await bench(`${base}-dyn`, []));
  console.log('static');
  console.log(await bench(`${base}-static`, ['-d', 'eth0,ipv4.address=10.189.108.250']));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
