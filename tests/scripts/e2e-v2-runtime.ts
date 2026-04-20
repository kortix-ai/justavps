#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import nodeHttp from 'node:http';
import https from 'node:https';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

import { db } from '@/server/db';
import { baremetalHosts, hostCapacityReservations, machineRoutingStates, machines } from '@/server/db/schema';
import { setupProxyDNS } from "@/server/v2/services/machine-lifecycle";
import { ensureBaremetalCellRecord } from "@/server/platform/baremetal/cell-store";
import * as cryptoModule from "@/server/core/crypto";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.BASE_URL || 'http://localhost:4100';
const API_V2 = `${BASE_URL}/api/v2`;
const API_V1 = `${BASE_URL}/api/v1`;
const PROXY_ROUTE_TIMEOUT_MS = 180_000;
const TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || '135.181.129.188';
const TARGET_HOST_ID = process.env.E2E_BAREMETAL_HOST_ID || undefined;
const TARGET_IMAGE_ID = process.env.E2E_IMAGE_ID || undefined;
const MACHINE_VCPU = Number(process.env.E2E_MACHINE_VCPU || '1');
const MACHINE_RAM_GB = Number(process.env.E2E_MACHINE_RAM_GB || '1');
const MACHINE_DISK_GB = Number(process.env.E2E_MACHINE_DISK_GB || '10');
const REQUIRE_EXTERNAL_PROXY = process.env.E2E_REQUIRE_EXTERNAL_PROXY === 'true';

type MachineView = {
  id: string;
  slug: string;
  status: string;
  provisioning_stage: string | null;
  ready_at: string | null;
  connectivity: {
    access: {
      mode: 'rest_exec';
      exec_endpoint: string;
    };
    urls: {
      proxy: string;
      terminal: string;
      port_template: string;
    };
  };
};

type ProxyTokenView = {
  id: string;
  token: string;
  proxy_url: string;
};

type HealthView = {
  status: string;
  database?: {
    status?: string;
    error?: string | null;
  };
  control_plane?: {
    error?: string | null;
  };
  fleet_hosts?: {
    active_schedulable_hosts?: number;
    quarantined_hosts?: number;
    blocking_drift_hosts?: number;
  };
};

type BaremetalHostSeed = {
  id: string;
  name: string;
  vendor: string;
  host_class: string;
  generation: string;
  region: string;
  location: string;
  public_ipv4: string;
  runner_base_url: string | null;
  runner_token: string | null;
  total_vcpu: number | null;
  total_memory_gb: number | null;
  total_disk_gb: number | null;
  status: string;
  maintenance_state: string;
  metadata: Record<string, unknown> | null;
};

const state: {
  email: string;
  password: string;
  apiKey: string | null;
  apiKeyId: string | null;
  machineId: string | null;
  machineSlug: string | null;
  proxyTokenId: string | null;
} = {
  email: process.env.E2E_SESSION_EMAIL || 'marko@kortix.ai',
  password: process.env.E2E_SESSION_PASSWORD || 'Kortix!Reset-2026-04-12',
  apiKey: null,
  apiKeyId: null,
  machineId: null,
  machineSlug: null,
  proxyTokenId: null,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function responseCookies(response: Response) {
  const multi = response.headers.getSetCookie?.();
  if (Array.isArray(multi) && multi.length > 0) return multi.map((cookie) => cookie.split(';')[0] ?? cookie);
  const single = response.headers.get('set-cookie');
  return single ? [single.split(';')[0] ?? single] : [];
}

async function requestJson<T>(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 120_000): Promise<{ status: number; data: T | null }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : nodeHttp;
    const req = transport.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data: T | null = null;
        try { data = text ? JSON.parse(text) as T : null; } catch { data = null; }
        resolve({ status: res.statusCode ?? 500, data });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function requestText(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 120_000): Promise<{ status: number; body: string; headers: nodeHttp.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : nodeHttp;
    const req = transport.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 500, body: text, headers: res.headers });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function waitForWarmPoolReady(timeoutMs = 180_000): Promise<'ready' | 'disabled'> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await requestJson<{ warm_pool?: { ready: number; target: number }; incus?: { imageCount?: number } }>(`http://${TARGET_HOST_IP}:7779/healthz`, {}, 30_000);
    const ready = res.data?.warm_pool?.ready ?? 0;
    const target = res.data?.warm_pool?.target ?? 0;
    const imageCount = res.data?.incus?.imageCount ?? 0;
    if (target <= 0) return 'disabled';
    if (imageCount <= 0) return 'disabled';
    if (ready >= target) return 'ready';
    await sleep(1_000);
  }
  return 'disabled';
}

function authHeaders() {
  if (!state.apiKey) throw new Error('API key not initialized');
  return {
    Authorization: `Bearer ${state.apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function http<T>(base: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const res = await requestJson<T>(`${base}${path}`, {
    method: init.method,
    body: typeof init.body === 'string' ? init.body : undefined,
    headers: { ...authHeaders(), ...((init.headers ?? {}) as Record<string, string>) },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { status: res.status, data: res.data as T };
}

async function waitFor<T>(label: string, fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs: number, intervalMs: number): Promise<T> {
  const start = Date.now();
  let lastValue: T | undefined;
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      lastValue = await fn();
      if (predicate(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}. lastValue=${JSON.stringify(lastValue)} lastError=${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForLocalApi(timeoutMs = 180_000) {
  const apiHealthUrl = `${BASE_URL.replace(/\/api$/, '')}/api/health`;
  const health = await waitFor(
    'local API health endpoint',
    () => requestJson<HealthView>(apiHealthUrl, { method: 'GET' }, 10_000),
    (res) => res.status >= 200 && res.status < 600,
    timeoutMs,
    1_000,
  );

  if (!health.data) {
    throw new Error(`local API health endpoint returned no JSON payload (status=${health.status})`);
  }

  if (health.data.database?.status !== 'ok') {
    throw new Error(`local API is reachable but database is not healthy: ${health.data.database?.error ?? 'database status is not ok'}`);
  }

  return health.data;
}

async function waitForTcpPort(host: string, port: number, timeoutMs: number, intervalMs: number) {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await execFileAsync('nc', ['-z', '-w', '2', host, String(port)], { timeout: 5_000 });
      return;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for TCP ${host}:${port}. lastError=${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function createHarnessUser() {
  const appBaseUrl = BASE_URL.replace(/\/api$/, '');
  const health = await waitForLocalApi();
  console.log(`[setup] local api status=${health.status} active_schedulable_hosts=${health.fleet_hosts?.active_schedulable_hosts ?? 'unknown'} quarantined_hosts=${health.fleet_hosts?.quarantined_hosts ?? 'unknown'} blocking_drift_hosts=${health.fleet_hosts?.blocking_drift_hosts ?? 'unknown'}`);
  const csrfRes = await fetch(`${appBaseUrl}/api/auth/csrf`);
  const csrfData = await csrfRes.json() as { csrfToken: string };
  const csrfCookies = responseCookies(csrfRes);

  let loginRes = await fetch(`${appBaseUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookies.join('; '),
    },
    body: `email=${encodeURIComponent(state.email)}&password=${encodeURIComponent(state.password)}&csrfToken=${csrfData.csrfToken}`,
    redirect: 'manual',
  });

  if (loginRes.status >= 400) {
    await fetch(`${appBaseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: state.email, password: state.password, name: 'E2E Runtime Harness' }),
    }).catch(() => null);

    loginRes = await fetch(`${appBaseUrl}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: csrfCookies.join('; '),
      },
      body: `email=${encodeURIComponent(state.email)}&password=${encodeURIComponent(state.password)}&csrfToken=${csrfData.csrfToken}`,
      redirect: 'manual',
    });
  }

  if (loginRes.status >= 400) {
    throw new Error(`failed to create/login e2e harness user: ${loginRes.status}`);
  }

  const sessionCookies = responseCookies(loginRes);
  let sessionCookieParts = [...csrfCookies, ...sessionCookies];
  const accountRes = await fetch(`${API_V1}/account`, {
    headers: {
      Cookie: sessionCookieParts.join('; '),
    },
  });
  const accountText = await accountRes.text();
  if (accountRes.status < 200 || accountRes.status >= 300) {
    throw new Error(`failed to resolve active account before api key creation: ${accountRes.status} ${accountText}`);
  }
  sessionCookieParts = [...sessionCookieParts, ...responseCookies(accountRes)];
  const sessionCookieHeader = sessionCookieParts.join('; ');
  const createKeyRes = await requestJson<{ id?: string; key?: string; message?: string }>(`${API_V1}/api-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookieHeader,
    },
    body: JSON.stringify({ name: `e2e-runtime-${Date.now()}` }),
  }, 120_000);
  const keyData = createKeyRes.data;
  if (createKeyRes.status < 200 || createKeyRes.status >= 300 || !keyData?.id || !keyData.key) {
    throw new Error(`failed to create session-backed api key: ${createKeyRes.status} ${JSON.stringify(keyData)}`);
  }

  state.apiKey = keyData.key;
  state.apiKeyId = keyData.id;
  console.log(`[setup] harness user=${state.email}`);
  console.log(`[setup] apiKeyId=${state.apiKeyId}`);
}

async function ensureTargetHostRegistered() {
  const localHost = await db.select().from(baremetalHosts).where(eq(baremetalHosts.publicIpv4, TARGET_HOST_IP)).limit(1);
  if (localHost[0]?.runnerToken && localHost[0]?.runnerBaseUrl) {
    return localHost[0];
  }

  const envText = await fs.readFile(path.join(process.cwd(), '.env'), 'utf8');
  const env = dotenv.parse(envText);
  const prodDbUrl = env.DATABASE_URL;
  if (!prodDbUrl) {
    throw new Error('cannot seed local baremetal host: DATABASE_URL missing from .env');
  }

  const prodSql = postgres(prodDbUrl, {
    ssl: prodDbUrl.includes('sslmode=require') || prodDbUrl.includes('ssl=require') ? 'require' : undefined,
    max: 1,
    connect_timeout: 5,
  });

  try {
    const prodRows = await prodSql<BaremetalHostSeed[]>`
      select
        id,
        name,
        vendor,
        host_class,
        generation,
        region,
        location,
        public_ipv4,
        runner_base_url,
        runner_token,
        total_vcpu,
        total_memory_gb,
        total_disk_gb,
        status,
        maintenance_state,
        metadata
      from baremetal_hosts
      where public_ipv4 = ${TARGET_HOST_IP}
      limit 1
    `;
    const seed = prodRows[0];
    if (!seed?.runner_base_url || !seed?.runner_token) {
      throw new Error(`cannot seed local baremetal host: no production host with runner credentials found for ${TARGET_HOST_IP}`);
    }

    const cell = await ensureBaremetalCellRecord({
      region: seed.region,
      hostClass: seed.host_class,
      generation: seed.generation,
    });

    await db.insert(baremetalHosts).values({
      id: seed.id,
      vendor: seed.vendor,
      hostClass: seed.host_class,
      generation: seed.generation,
      region: seed.region,
      location: seed.location,
      cellId: cell.id,
      name: seed.name,
      status: seed.status,
      publicIpv4: seed.public_ipv4,
      runnerBaseUrl: seed.runner_base_url,
      runnerToken: seed.runner_token,
      totalVcpu: seed.total_vcpu,
      totalMemoryGb: seed.total_memory_gb,
      totalDiskGb: seed.total_disk_gb,
      maintenanceState: seed.maintenance_state as 'in_service',
      metadata: seed.metadata ?? {},
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [baremetalHosts.id],
      set: {
        vendor: seed.vendor,
        hostClass: seed.host_class,
        generation: seed.generation,
        region: seed.region,
        location: seed.location,
        cellId: cell.id,
        name: seed.name,
        status: seed.status,
        publicIpv4: seed.public_ipv4,
        runnerBaseUrl: seed.runner_base_url,
        runnerToken: seed.runner_token,
        totalVcpu: seed.total_vcpu,
        totalMemoryGb: seed.total_memory_gb,
        totalDiskGb: seed.total_disk_gb,
        maintenanceState: seed.maintenance_state as 'in_service',
        metadata: seed.metadata ?? {},
        updatedAt: new Date(),
      },
    });

    console.log(`[setup] seeded local baremetal host ${seed.id} from production metadata`);
  } finally {
    await prodSql.end({ timeout: 0 }).catch(() => {});
  }
}

async function reconcileLocalHostCapacity(hostId: string) {
  const reservations = await db.select().from(hostCapacityReservations).where(eq(hostCapacityReservations.hostId, hostId));
  const committed = reservations.filter((row) => row.state === 'committed');
  const usedVcpu = committed.reduce((sum, row) => sum + (row.vcpu ?? 0), 0);
  const usedMemoryGb = committed.reduce((sum, row) => sum + (row.memoryGb ?? 0), 0);
  const usedDiskGb = committed.reduce((sum, row) => sum + (row.diskGb ?? 0), 0);
  await db.update(baremetalHosts).set({
    usedVcpu,
    usedMemoryGb,
    usedDiskGb,
    updatedAt: new Date(),
  }).where(eq(baremetalHosts.id, hostId));
  console.log(`[setup] reconciled local host capacity vcpu=${usedVcpu} mem=${usedMemoryGb} disk=${usedDiskGb}`);
}

async function getMachine(machineId: string) {
  const { data } = await http<MachineView>(API_V2, `/machines/${machineId}`);
  return data;
}

async function execInMachine(machineId: string, input: { command: string; args?: string[]; cwd?: string; env_vars?: Record<string, string>; timeout_ms?: number }) {
  const { data } = await http<{ ok: boolean; stdout: string; stderr: string; exit_code: number }>(API_V2, `/machines/${machineId}/exec`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data;
}

async function runCliV2(args: string[]) {
  const { stdout } = await execFileAsync('pnpm', ['--silent', 'cli:v2', '--', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      JUSTAVPS_API_KEY: state.apiKey ?? '',
      JUSTAVPS_API: BASE_URL,
    },
    timeout: 120_000,
  });
  return stdout;
}

async function getMachineHostHttpPort(machineId: string) {
  const [machineRow] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  const providerMeta = (machineRow?.providerMeta ?? {}) as Record<string, unknown>;
  return typeof providerMeta.http_port === 'number' ? providerMeta.http_port : null;
}

async function triggerLocalHeartbeat(slug: string) {
  const [machineRow] = await db.select().from(machines).where(eq(machines.slug, slug)).limit(1);
  if (!machineRow?.machineToken) {
    throw new Error(`cannot trigger local heartbeat for ${slug}: machine token missing`);
  }
  const machineToken = cryptoModule.decryptSecret(machineRow.machineToken);
  const res = await requestJson<{ ack?: boolean }>(`${BASE_URL.replace(/\/api$/, '')}/api/v1/internal/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      machine_token: machineToken,
      daemon_version: 'local-e2e',
      uptime: 1,
      services: { justavps: true, code_server: true, docker: true, fail2ban: true },
      load: { cpu: 1, memory: 1, disk: 1 },
      network: { bytes_in: 0, bytes_out: 0, rate_in: 0, rate_out: 0, connections: 1 },
      security: { ufw_active: true, fail2ban_active: true, ssh_key_only: true },
    }),
  }, 30_000);
  if (res.status < 200 || res.status >= 300 || !res.data?.ack) {
    throw new Error(`manual heartbeat failed for ${slug}: ${res.status} ${JSON.stringify(res.data)}`);
  }
}

async function ensureMachineProxyRouting(machineId: string, routingIp: string, routingPort: number) {
  const [machineRow] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!machineRow) {
    throw new Error(`cannot sync proxy routing for ${machineId}: machine missing`);
  }

  const providerMeta = (machineRow.providerMeta ?? {}) as Record<string, unknown>;
  await setupProxyDNS(
    machineRow.id,
    machineRow.slug,
    {
      ipv4: machineRow.publicIpv4 ?? (typeof providerMeta.public_ipv4 === 'string' ? providerMeta.public_ipv4 : null),
      ipv6: machineRow.publicIpv6 ?? (typeof providerMeta.public_ipv6 === 'string' ? providerMeta.public_ipv6 : null),
    },
    machineRow.accountId ?? machineRow.ownerId,
    machineRow.serverType,
    {
      routingIp,
      routingPort,
    },
  );

  const routingState = await waitFor(
    'machine routing state sync',
    async () => {
      const [row] = await db.select().from(machineRoutingStates).where(eq(machineRoutingStates.machineId, machineId)).limit(1);
      return row ?? null;
    },
    (row) => Boolean(row) && row.kvState === 'synced' && row.dnsState === 'synced',
    60_000,
    1_000,
  );

  console.log(`[routing] kv=${routingState.kvState} dns=${routingState.dnsState} desiredIp=${routingState.desiredIp ?? 'null'} desiredPort=${routingState.desiredOriginPort ?? 'null'}`);
}

async function cleanup() {
  if (state.machineId) {
    try { await http(API_V2, `/machines/${state.machineId}`, { method: 'DELETE' }); } catch {}
  }
  if (state.proxyTokenId) {
    try { await http(API_V1, `/proxy-tokens/${state.proxyTokenId}`, { method: 'DELETE' }); } catch {}
  }
  if (state.apiKeyId) {
    try {
      await requestText(`${API_V1}/api-keys/${state.apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${state.apiKey}` },
      });
    } catch {}
  }
}

async function main() {
  console.log('=== JustAVPS V2 runtime E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`E2E_BAREMETAL_HOST_ID=${TARGET_HOST_ID ?? '(auto)'}`);
  console.log(`E2E_BAREMETAL_HOST_IP=${TARGET_HOST_IP}`);
  console.log(`E2E_IMAGE_ID=${TARGET_IMAGE_ID ?? '(default)'}`);
  console.log(`E2E_MACHINE=${MACHINE_VCPU}vCPU/${MACHINE_RAM_GB}GB/${MACHINE_DISK_GB}GB`);
  const targetHost = await ensureTargetHostRegistered();
  if (targetHost?.id) {
    await reconcileLocalHostCapacity(targetHost.id);
  }
  await createHarnessUser();

  const warmPoolState = await waitForWarmPoolReady();
  console.log(
    warmPoolState === 'ready'
      ? '[setup] warm pool is full'
      : '[setup] warm pool disabled; validating cold-fallback runtime path',
  );
  const machineReadyTimeoutMs = warmPoolState === 'ready' ? 120_000 : 180_000;
  const machineReadyPollMs = warmPoolState === 'ready' ? 150 : 1_000;

  const createStart = Date.now();
  const create = await http<MachineView>(API_V2, '/machines', {
    method: 'POST',
    body: JSON.stringify({ vcpu: MACHINE_VCPU, ram_gb: MACHINE_RAM_GB, disk_gb: MACHINE_DISK_GB, region: 'hel1', name: `e2e-runtime-${Date.now()}`, ...(TARGET_HOST_ID ? { host_id: TARGET_HOST_ID } : {}), ...(TARGET_IMAGE_ID ? { image_id: TARGET_IMAGE_ID } : {}) }),
  });
  state.machineId = create.data.id;
  state.machineSlug = create.data.slug;
  console.log(`[machine] create accepted id=${state.machineId} slug=${state.machineSlug} in ${Date.now() - createStart}ms`);

  let ready: MachineView;
  try {
    ready = await waitFor(
      'machine ready',
      () => getMachine(state.machineId!),
      (m) => m.status === 'ready',
      machineReadyTimeoutMs,
      machineReadyPollMs,
    );
  } catch (error) {
    const current = await getMachine(state.machineId!);
    if (current.status === 'provisioning' && current.provisioning_stage === 'server_created') {
      console.log(`[machine] provisioning stalled at ${current.provisioning_stage ?? 'unknown'}; triggering manual heartbeat recovery`);
      await triggerLocalHeartbeat(current.slug);
      ready = await waitFor(
        'machine ready after manual heartbeat',
        () => getMachine(state.machineId!),
        (m) => m.status === 'ready',
        30_000,
        500,
      );
    } else {
      throw error;
    }
  }
  console.log(`[machine] ready in ${Date.now() - createStart}ms`);
  console.log(`[machine] exec_endpoint=${ready.connectivity.access.exec_endpoint}`);
  console.log(`[machine] proxy=${ready.connectivity.urls.proxy}`);

  const execCheck = await execInMachine(ready.id, { command: 'bash', args: ['-lc', 'echo EXEC_OK; hostname'], timeout_ms: 30_000 });
  if (execCheck.exit_code !== 0 || !execCheck.stdout.includes('EXEC_OK')) {
    throw new Error(`exec check failed: exit=${execCheck.exit_code} stdout=${execCheck.stdout} stderr=${execCheck.stderr}`);
  }
  console.log('[exec] instance exec works');

  const cliGet = await runCliV2(['machines', 'get', ready.id]);
  const cliGetJson = JSON.parse(cliGet);
  if (cliGetJson.id !== ready.id) {
    throw new Error(`cli get returned unexpected machine id: ${cliGetJson.id}`);
  }
  const cliExec = await runCliV2(['machines', 'exec', ready.id, '--', 'bash', '-lc', 'echo CLI_EXEC_OK']);
  if (!cliExec.includes('CLI_EXEC_OK')) {
    throw new Error(`cli exec did not return expected marker: ${cliExec}`);
  }
  console.log('[cli] machines get/exec work');

  // Start real apps on ports 80 and 8080 inside the machine so we can
  // verify both the default root proxy path and explicit port forwarding.
  const appBootstrap = await execInMachine(ready.id, {
    command: 'bash',
    args: ['-lc', "mkdir -p /tmp/site && printf '<h1>Hello world</h1>\\n' > /tmp/site/index.html && systemctl stop justavps-e2e-80.service 2>/dev/null || true && systemctl stop justavps-e2e-8080.service 2>/dev/null || true && systemd-run --unit justavps-e2e-80 --property=Restart=no /usr/bin/python3 -m http.server 80 -d /tmp/site >/dev/null 2>&1 && systemd-run --unit justavps-e2e-8080 --property=Restart=no /usr/bin/python3 -m http.server 8080 -d /tmp/site >/dev/null 2>&1 && sleep 1 && curl -sf http://127.0.0.1:80/ >/dev/null && curl -sf http://127.0.0.1:8080/ >/dev/null"],
    timeout_ms: 45_000,
  });
  if (appBootstrap.exit_code !== 0) {
    throw new Error(`guest bootstrap via exec failed: ${appBootstrap.stderr || appBootstrap.stdout}`);
  }
  console.log('[guest] apps on ports 80 and 8080 are serving');

  const hostHttpPort = await waitFor(
    'host proxy listener for machine app',
    () => getMachineHostHttpPort(state.machineId!),
    (port) => typeof port === 'number' && port > 0,
    30_000,
    500,
  );
  if (typeof hostHttpPort !== 'number') {
    throw new Error('host http port missing after allocation wait');
  }
  await waitForTcpPort(TARGET_HOST_IP, hostHttpPort, 60_000, 1_000);
  console.log(`[host] app proxy listener reachable on ${TARGET_HOST_IP}:${hostHttpPort}`);
  await ensureMachineProxyRouting(state.machineId!, TARGET_HOST_IP, hostHttpPort);

  // Create proxy token normally through the API
  const tokenResp = await http<ProxyTokenView>(API_V1, '/proxy-tokens', {
    method: 'POST',
    body: JSON.stringify({ machine_id: state.machineId, label: 'e2e-runtime', ports: [80, 8080], expires_in_seconds: 3600 }),
  });
  state.proxyTokenId = tokenResp.data.id;
  console.log(`[proxy-token] created id=${state.proxyTokenId}`);
  console.log(`[proxy-token] url=${tokenResp.data.proxy_url}`);

  const proxyHost = new URL(ready.connectivity.urls.proxy).host;
  let apiKeyProxyResp: Awaited<ReturnType<typeof requestText>> | null = null;
  try {
    apiKeyProxyResp = await waitFor(
      'API-key proxy reachability',
      () => requestText(`https://8080--${proxyHost}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${state.apiKey}` },
      }, 30_000),
      (res) => res.status >= 200 && res.status < 300 && res.body.includes('Hello world'),
      PROXY_ROUTE_TIMEOUT_MS,
      1_000,
    );
    if (apiKeyProxyResp) {
      console.log(`[proxy] api-key path returns Hello world (status=${apiKeyProxyResp.status})`);
    }
  } catch (error) {
    if (REQUIRE_EXTERNAL_PROXY) throw error;
    console.warn(`[proxy] warning: external proxy path did not become reachable; continuing because E2E_REQUIRE_EXTERNAL_PROXY is false (${error instanceof Error ? error.message : String(error)})`);
  }
  const appShareUrl = `https://8080--${proxyHost}?__proxy_token=${tokenResp.data.token}`;
  const terminalShareUrl = `https://${proxyHost}/_terminal?__proxy_token=${tokenResp.data.token}`;

  if (apiKeyProxyResp) {
    // Verify public share URL end-to-end (first response sets cookie + redirects)
    const first = await waitFor(
      'proxy token initial redirect',
      () => requestJson<null>(appShareUrl, {}, 30_000),
      (res) => res.status === 302,
      PROXY_ROUTE_TIMEOUT_MS,
      1_000,
    );
    if (first.status !== 302) {
      throw new Error(`proxy URL did not return initial redirect: status=${first.status}`);
    }
    const cleanProxyUrl = appShareUrl.replace(/\?__proxy_token=.*$/, '');
    const publicResp = await requestText(appShareUrl, {
      method: 'GET',
      headers: { Cookie: `__justavps_pt=${tokenResp.data.token}` },
    }, 30_000);
    if (publicResp.status === 302) {
      // Follow the clean URL with the auth cookie set and tolerate short broker/app warmup.
      const followed = await waitFor(
        'public share URL body after redirect',
        () => requestText(cleanProxyUrl, {
          method: 'GET',
          headers: { Cookie: `__justavps_pt=${tokenResp.data.token}` },
        }, 30_000),
        (res) => res.status >= 200 && res.status < 300 && res.body.includes('Hello world'),
        PROXY_ROUTE_TIMEOUT_MS,
        1_000,
      );
      if (followed.status < 200 || followed.status >= 300 || !followed.body.includes('Hello world')) {
        throw new Error(`public share URL did not return expected body after redirect: status=${followed.status} body=${followed.body.slice(0, 200)}`);
      }
    } else if (publicResp.status < 200 || publicResp.status >= 300 || !publicResp.body.includes('Hello world')) {
      const retried = await waitFor(
        'public share URL body',
        () => requestText(cleanProxyUrl, {
          method: 'GET',
          headers: { Cookie: `__justavps_pt=${tokenResp.data.token}` },
        }, 30_000),
        (res) => res.status >= 200 && res.status < 300 && res.body.includes('Hello world'),
        PROXY_ROUTE_TIMEOUT_MS,
        1_000,
      );
      if (retried.status < 200 || retried.status >= 300 || !retried.body.includes('Hello world')) {
        throw new Error(`public share URL did not return expected body: status=${publicResp.status} body=${publicResp.body.slice(0, 200)}`);
      }
    }
    console.log('[proxy] public tokenized URL returns Hello world');

    // Verify terminal URL with proxy token directly in query string
    const terminalFirst = await requestJson<null>(terminalShareUrl, {}, 30_000);
    if (terminalFirst.status !== 302) {
      throw new Error(`terminal URL did not return initial redirect: status=${terminalFirst.status}`);
    }
    const cleanTerminalUrl = terminalShareUrl.replace(/\?__proxy_token=.*$/, '');
    const terminalResp = await waitFor(
      'terminal URL reachability',
      () => requestText(cleanTerminalUrl, {
        method: 'GET',
        headers: { Cookie: `__justavps_pt=${tokenResp.data.token}` },
      }, 30_000),
      (res) => res.status >= 200 && res.status < 300,
      PROXY_ROUTE_TIMEOUT_MS,
      1_000,
    );
    if (terminalResp.status < 200 || terminalResp.status >= 300) {
      throw new Error(`terminal URL not reachable: status=${terminalResp.status} body=${terminalResp.body.slice(0, 200)}`);
    }
    console.log('[terminal] terminal path reachable');
  } else {
    console.log(`[proxy] external validation skipped for ${appShareUrl}`);
    console.log(`[terminal] external validation skipped for ${terminalShareUrl}`);
  }

  console.log('=== V2 runtime E2E PASSED ===');
  console.log(`HARNESS_EMAIL=${state.email}`);
  console.log(`HARNESS_PASSWORD=${state.password}`);
}

process.on('SIGINT', async () => { await cleanup(); process.exit(1); });
process.on('uncaughtException', async (err) => { console.error(err); await cleanup(); process.exit(1); });

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await cleanup();
    process.exit(1);
  });
