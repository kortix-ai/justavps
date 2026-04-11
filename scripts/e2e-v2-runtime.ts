#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import nodeHttp from 'node:http';
import https from 'node:https';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

import { db } from '../src/server/db';
import { apiKeys, users } from '../src/server/db/schema';
import { ensureUserAccountGraph } from '../src/server/lib/accounts';
import { generateApiKey, hashPassword } from '../src/server/lib/crypto';

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.BASE_URL || 'http://localhost:4100';
const API_V2 = `${BASE_URL}/api/v2`;
const API_V1 = `${BASE_URL}/api/v1`;
const TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || '135.181.129.188';
const TARGET_HOST_ID = process.env.E2E_BAREMETAL_HOST_ID || undefined;
const TARGET_IMAGE_ID = process.env.E2E_IMAGE_ID || undefined;
const MACHINE_VCPU = Number(process.env.E2E_MACHINE_VCPU || '1');
const MACHINE_RAM_GB = Number(process.env.E2E_MACHINE_RAM_GB || '1');
const MACHINE_DISK_GB = Number(process.env.E2E_MACHINE_DISK_GB || '10');

type MachineView = {
  id: string;
  slug: string;
  status: string;
  provisioning_stage: string | null;
  ready_at: string | null;
  connectivity: {
    ssh_host: string | null;
    ssh_port: number | null;
    ssh_command: string | null;
    ssh_setup_command: string | null;
    ssh_private_key: string | null;
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

const state: {
  email: string;
  password: string;
  userId: string | null;
  accountId: string | null;
  apiKey: string | null;
  apiKeyId: string | null;
  machineId: string | null;
  machineSlug: string | null;
  proxyTokenId: string | null;
  keyPath: string | null;
} = {
  email: `e2e-runtime-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  machineId: null,
  machineSlug: null,
  proxyTokenId: null,
  keyPath: null,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
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

async function requestText(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 120_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : nodeHttp;
    const req = transport.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 500, body: text });
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
  const passwordHash = await hashPassword(state.password);
  const [user] = await db.insert(users).values({
    email: state.email,
    passwordHash,
    name: 'E2E Runtime Harness',
    isAdmin: true,
  }).returning();
  const account = await ensureUserAccountGraph(user);
  const { key, hash, sha256, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({
    ownerId: user.id,
    accountId: account.id,
    name: `e2e-runtime-${Date.now()}`,
    keyPrefix: prefix,
    keyHash: hash,
    keySha256: sha256,
    scope: 'account',
    permissions: ['*'],
  }).returning();
  state.userId = user.id;
  state.accountId = account.id;
  state.apiKey = key;
  state.apiKeyId = apiKey.id;
  console.log(`[setup] harness user=${state.email}`);
  console.log(`[setup] account=${account.id}`);
}

async function getMachine(machineId: string) {
  const { data } = await http<MachineView>(API_V2, `/machines/${machineId}`);
  return data;
}

async function cleanup() {
  if (state.machineId) {
    try { await http(API_V2, `/machines/${state.machineId}`, { method: 'DELETE' }); } catch {}
  }
  if (state.proxyTokenId) {
    try { await http(API_V1, `/proxy-tokens/${state.proxyTokenId}`, { method: 'DELETE' }); } catch {}
  }
  if (state.keyPath) {
    try { await fs.unlink(state.keyPath); } catch {}
  }
  if (state.apiKeyId) {
    try { await db.delete(apiKeys).where(eq(apiKeys.id, state.apiKeyId)); } catch {}
  }
}

async function main() {
  console.log('=== JustAVPS V2 runtime E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`E2E_BAREMETAL_HOST_ID=${TARGET_HOST_ID ?? '(auto)'}`);
  console.log(`E2E_BAREMETAL_HOST_IP=${TARGET_HOST_IP}`);
  console.log(`E2E_IMAGE_ID=${TARGET_IMAGE_ID ?? '(default)'}`);
  console.log(`E2E_MACHINE=${MACHINE_VCPU}vCPU/${MACHINE_RAM_GB}GB/${MACHINE_DISK_GB}GB`);
  await createHarnessUser();

  const warmPoolState = await waitForWarmPoolReady();
  console.log(
    warmPoolState === 'ready'
      ? '[setup] warm pool is full'
      : '[setup] warm pool disabled; validating cold-fallback runtime path',
  );
  const machineReadyTimeoutMs = warmPoolState === 'ready' ? 30_000 : 180_000;
  const machineReadyPollMs = warmPoolState === 'ready' ? 150 : 1_000;

  const createStart = Date.now();
  const create = await http<MachineView>(API_V2, '/machines', {
    method: 'POST',
    body: JSON.stringify({ vcpu: MACHINE_VCPU, ram_gb: MACHINE_RAM_GB, disk_gb: MACHINE_DISK_GB, region: 'hel1', name: `e2e-runtime-${Date.now()}`, ...(TARGET_HOST_ID ? { host_id: TARGET_HOST_ID } : {}), ...(TARGET_IMAGE_ID ? { image_id: TARGET_IMAGE_ID } : {}) }),
  });
  state.machineId = create.data.id;
  state.machineSlug = create.data.slug;
  console.log(`[machine] create accepted id=${state.machineId} slug=${state.machineSlug} in ${Date.now() - createStart}ms`);

  const ready = await waitFor(
    'machine ready',
    () => getMachine(state.machineId!),
    (m) => m.status === 'ready' && Boolean(m.connectivity?.ssh_port) && Boolean(m.connectivity?.ssh_private_key),
    machineReadyTimeoutMs,
    machineReadyPollMs,
  );
  console.log(`[machine] ready in ${Date.now() - createStart}ms`);
  console.log(`[machine] ssh_host=${ready.connectivity.ssh_host} ssh_port=${ready.connectivity.ssh_port}`);
  console.log(`[machine] proxy=${ready.connectivity.urls.proxy}`);

  const sshGateway = ready.connectivity.ssh_host ?? TARGET_HOST_IP;
  if (!sshGateway) throw new Error('Missing ssh host for runtime verification');
  if (!ready.connectivity.ssh_port) throw new Error('Missing ssh port for runtime verification');

  // Write returned private key to temp file
  const tmpKey = path.join(os.tmpdir(), `justavps_${ready.slug}`);
  await fs.writeFile(tmpKey, `${ready.connectivity.ssh_private_key}\n`, { mode: 0o600 });
  state.keyPath = tmpKey;

  await waitForTcpPort(sshGateway, ready.connectivity.ssh_port, warmPoolState === 'ready' ? 20_000 : 60_000, 1_000);
  console.log('[ssh] port is reachable');

  // SSH check
  await execFileAsync('ssh', [
    '-i', tmpKey,
    '-p', String(ready.connectivity.ssh_port),
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'BatchMode=yes',
    `root@${sshGateway}`,
    `bash -lc ${shQuote('echo SSH_OK; hostname')}`,
  ], { timeout: 30_000 });
  console.log('[ssh] gateway ssh works');

  // Start a real app on port 8080 inside the machine
  await execFileAsync('ssh', [
    '-i', tmpKey,
    '-p', String(ready.connectivity.ssh_port),
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'BatchMode=yes',
    `root@${sshGateway}`,
    `bash -lc ${shQuote("mkdir -p /tmp/site && printf '<h1>Hello world</h1>\\n' > /tmp/site/index.html && systemctl stop justavps-e2e-8080.service 2>/dev/null || true && systemd-run --unit justavps-e2e-8080 --property=Restart=no /usr/bin/python3 -m http.server 8080 -d /tmp/site >/dev/null 2>&1 && sleep 1 && curl -sf http://127.0.0.1:8080/ >/dev/null")}`,
  ], { timeout: 45_000 });
  console.log('[guest] app on 8080 is serving');

  // Create proxy token normally through the API
  const tokenResp = await http<ProxyTokenView>(API_V1, '/proxy-tokens', {
    method: 'POST',
    body: JSON.stringify({ machine_id: state.machineId, label: 'e2e-runtime', ports: [80, 8080], expires_in_seconds: 3600 }),
  });
  state.proxyTokenId = tokenResp.data.id;
  console.log(`[proxy-token] created id=${state.proxyTokenId}`);
  console.log(`[proxy-token] url=${tokenResp.data.proxy_url}`);

  const appShareUrl = `https://8080--${ready.slug}.kortix-dev.cloud?__proxy_token=${tokenResp.data.token}`;
  const terminalShareUrl = `https://${ready.slug}.kortix-dev.cloud/_terminal?__proxy_token=${tokenResp.data.token}`;

  // Verify public share URL end-to-end (first response sets cookie + redirects)
  const first = await waitFor(
    'proxy token initial redirect',
    () => requestJson<null>(appShareUrl, {}, 30_000),
    (res) => res.status === 302,
    20_000,
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
    // Follow the clean URL with the auth cookie set.
    const followed = await requestText(cleanProxyUrl, {
      method: 'GET',
      headers: { Cookie: `__justavps_pt=${tokenResp.data.token}` },
    }, 30_000);
    if (followed.status < 200 || followed.status >= 300 || !followed.body.includes('Hello world')) {
      throw new Error(`public share URL did not return expected body after redirect: status=${followed.status} body=${followed.body.slice(0, 200)}`);
    }
  } else if (publicResp.status < 200 || publicResp.status >= 300 || !publicResp.body.includes('Hello world')) {
    throw new Error(`public share URL did not return expected body: status=${publicResp.status} body=${publicResp.body.slice(0, 200)}`);
  }
  console.log('[proxy] public tokenized URL returns Hello world');

  // Verify terminal URL with proxy token directly in query string
  const terminalFirst = await requestJson<null>(terminalShareUrl, {}, 30_000);
  if (terminalFirst.status !== 302) {
    throw new Error(`terminal URL did not return initial redirect: status=${terminalFirst.status}`);
  }
  const cleanTerminalUrl = terminalShareUrl.replace(/\?__proxy_token=.*$/, '');
  const terminalResp = await requestText(cleanTerminalUrl, {
    method: 'GET',
    headers: { Cookie: `__justavps_pt=${tokenResp.data.token}` },
  }, 30_000);
  if (terminalResp.status < 200 || terminalResp.status >= 300) {
    throw new Error(`terminal URL not reachable: status=${terminalResp.status} body=${terminalResp.body.slice(0, 200)}`);
  }
  console.log('[terminal] terminal path reachable');

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
