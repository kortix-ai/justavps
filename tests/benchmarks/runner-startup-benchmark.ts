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
const OVERRIDE_IMAGE = process.env.RUNNER_BENCH_IMAGE || '';
const STATIC_IPV4 = process.env.RUNNER_BENCH_STATIC_IPV4 || '';

type Scenario = 'vm-cold' | 'vm-warm' | 'container-cold';
const SCENARIO = (process.env.RUNNER_BENCH_SCENARIO || 'vm-cold') as Scenario;

async function sshHost(command: string, timeoutMs = 120_000) {
  const { stdout, stderr } = await execFileAsync(
    'ssh',
    ['-i', SSH_KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', RUNNER_HOST, command],
    { timeout: timeoutMs },
  );
  return { stdout, stderr };
}

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function requestJson<T>(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 300_000): Promise<{ status: number; data: T | null }> {
  const headerArgs = Object.entries(init.headers ?? {})
    .map(([key, value]) => `-H ${shQuote(`${key}: ${value}`)}`)
    .join(' ');
  const bodyArg = init.body ? `--data ${shQuote(init.body)}` : '';
  const method = init.method ?? 'GET';
  const command = `curl -sS -X ${method} ${headerArgs} ${bodyArg} -w '\n%{http_code}' http://127.0.0.1:7779${path}`;
  const { stdout } = await sshHost(`bash -lc ${shQuote(command)}`, timeoutMs);
  const lines = stdout.trimEnd().split('\n');
  const statusLine = lines.pop() ?? '500';
  const text = lines.join('\n');
  let data: T | null = null;
  try { data = text ? JSON.parse(text) as T : null; } catch { data = null; }
  return { status: Number(statusLine), data };
}

async function runnerToken() {
  const { stdout } = await sshHost("bash -lc \"grep '^RUNNERD_TOKEN=' /etc/justavps-runnerd.env | cut -d= -f2-\"");
  const token = stdout.trim();
  if (!token) throw new Error('RUNNERD_TOKEN not found on host');
  return token;
}

async function configureWarmPool(enabled: boolean) {
  const value = enabled ? '1' : '0';
  await sshHost(`bash -lc "if grep -q '^WARM_POOL_PER_CPU=' /etc/justavps-runnerd.env; then sed -i 's/^WARM_POOL_PER_CPU=.*/WARM_POOL_PER_CPU=${value}/' /etc/justavps-runnerd.env; else echo 'WARM_POOL_PER_CPU=${value}' >> /etc/justavps-runnerd.env; fi; systemctl restart justavps-runnerd"`, 180_000);
}

async function waitForWarmPool() {
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    const res = await requestJson<{ warm_pool?: { ready: number; target: number } }>('/healthz');
    const ready = res.data?.warm_pool?.ready ?? 0;
    const target = res.data?.warm_pool?.target ?? 0;
    if (target > 0 && ready >= target) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('warm pool not ready');
}

async function main() {
  const token = await runnerToken();
  const instanceName = `justavps-bench-${SCENARIO}-${Date.now()}`;
  const machineMode = SCENARIO === 'container-cold' ? 'container' : 'vm';
  const image = OVERRIDE_IMAGE || 'justavps-golden';

  if (SCENARIO === 'vm-warm') {
    await configureWarmPool(true);
    await waitForWarmPool();
  } else if (SCENARIO === 'vm-cold') {
    await configureWarmPool(false);
  }

  const started = Date.now();
  const create = await requestJson<{
    instanceId: string;
    privateIpv4: string | null;
    metadata?: { benchmark?: { scenario?: string; total_ms?: number | null }; machine_mode?: string };
    error?: string;
  }>('/v1/instances', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instanceName,
      machineSlug: instanceName.replace(/^justavps-/, ''),
      image,
      machineMode,
      ...(STATIC_IPV4 ? { containerIpv4Address: STATIC_IPV4 } : {}),
      region: 'eu',
      serverType: 'custom',
      vcpu: 2,
      memoryGb: 4,
      diskGb: 20,
      cloudInitUserData: '',
    }),
  }, 600_000);

  console.log(JSON.stringify({
    scenario: SCENARIO,
    image,
    static_ipv4: STATIC_IPV4 || null,
    status: create.status,
    wall_clock_ms: Date.now() - started,
    payload: create.data,
  }, null, 2));

  if (create.status >= 200 && create.status < 300 && create.data?.instanceId) {
    await requestJson(`/v1/instances/${encodeURIComponent(create.data.instanceId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, 120_000).catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
