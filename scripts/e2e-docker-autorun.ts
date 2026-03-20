#!/usr/bin/env npx tsx
import 'dotenv/config';

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:4101/api';
const APP_URL = BASE_URL.replace(/\/api$/, '');
const PROVISION_TIMEOUT_MS = 5 * 60 * 1000;
const CLOUD_INIT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;
const PROXY_POLL_INTERVAL_MS = 5_000;
const PROXY_RETRIES = 24;
const REQUIRE_PROXY = process.env.E2E_REQUIRE_PROXY === '1';

let apiKey = process.env.E2E_API_KEY || 'sk_live_invalid';
let sessionCookieHeader = '';
let sessionApiKeyId = '';
let machineId = '';
let machineSlug = '';
let machineIp = '';
let sshKeyPath = '';

type JsonRecord = Record<string, unknown>;

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  return { status: res.status, data: await res.json().catch(() => null as unknown) };
}

async function apiPost(path: string, body: JsonRecord) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null as unknown) };
}

async function apiDelete(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: authHeaders() });
  return { status: res.status };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function savePrivateKey(slug: string, privateKey: string) {
  const path = `/tmp/e2e_ssh_${slug}`;
  writeFileSync(path, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`, { mode: 0o600 });
  return path;
}

function ssh(cmd: string, timeoutSec = 15): string | null {
  if (!machineIp || !sshKeyPath) return null;
  try {
    return execSync(
      `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=${timeoutSec} root@${machineIp} '${cmd}'`,
      { timeout: (timeoutSec + 5) * 1000, encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
}

function proxyUrl(path = '/', port?: number): string {
  const prefix = port ? `${port}--` : '';
  return `https://${prefix}${machineSlug}.kortix.cloud${path}`;
}

function proxyGet(path: string, port?: number): { status: string; body: string } {
  try {
    const raw = execSync(
      `curl -sk -w "\n%{http_code}" -H "Authorization: Bearer ${apiKey}" "${proxyUrl(path, port)}"`,
      { encoding: 'utf8', timeout: 20_000 },
    ).trim();
    const lines = raw.split('\n');
    return {
      status: lines[lines.length - 1] || '000',
      body: lines.slice(0, -1).join('\n'),
    };
  } catch {
    return { status: '000', body: '' };
  }
}

async function createSessionBackedApiKey() {
  const csrfRes = await fetch(`${APP_URL}/api/auth/csrf`);
  const csrf = await csrfRes.json() as { csrfToken: string };
  const cookies = csrfRes.headers.getSetCookie?.() || [];

  const loginRes = await fetch(`${APP_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies.join('; '),
    },
    body: `email=e2e-prod@justavps.com&password=testpassword123&csrfToken=${csrf.csrfToken}`,
    redirect: 'manual',
  });

  const sessionCookies = loginRes.headers.getSetCookie?.() || [];
  sessionCookieHeader = [...cookies, ...sessionCookies].join('; ');

  const createKeyRes = await fetch(`${BASE_URL}/v1/api-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookieHeader,
    },
    body: JSON.stringify({ name: `docker-autorun-e2e-${Date.now()}` }),
  });
  const keyData = await createKeyRes.json().catch(() => null) as { id?: string; key?: string; message?: string } | null;

  if (!createKeyRes.ok || !keyData?.id || !keyData.key) {
    throw new Error(`Failed to create session-backed API key: ${keyData?.message || createKeyRes.status}`);
  }

  sessionApiKeyId = keyData.id;
  apiKey = keyData.key;
}

async function ensureApiKey() {
  const health = await apiGet('/v1/machines');
  if (health.status === 200) return;
  console.log('[E2E] Default API key invalid, creating one via session login...');
  await createSessionBackedApiKey();
  const retry = await apiGet('/v1/machines');
  if (retry.status !== 200) {
    throw new Error(`API auth failed after session-backed key creation (${retry.status})`);
  }
}

async function waitForMachineReady() {
  const start = Date.now();
  while (Date.now() - start < PROVISION_TIMEOUT_MS) {
    const { data } = await apiGet(`/v1/machines/${machineId}`);
    const machine = data as JsonRecord | null;
    if (machine?.status === 'ready') {
      machineIp = String(machine.ip || '');
      console.log(`[E2E] Machine ready: ${machineSlug} (${machineIp})`);
      return;
    }
    if (machine?.status === 'error') {
      throw new Error(`Machine entered error state: ${String(machine.provisioning_stage || 'unknown')}`);
    }
    if (machine?.ip && !machineIp) {
      machineIp = String(machine.ip);
      console.log(`[E2E] Machine IP assigned: ${machineIp} stage=${String(machine.provisioning_stage || 'unknown')}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Machine did not become ready within 5 minutes');
}

async function waitForSSHReady() {
  const attempts = Math.ceil(CLOUD_INIT_TIMEOUT_MS / 10_000);
  for (let i = 0; i < attempts; i++) {
    if (ssh('echo OK') === 'OK') {
      console.log(`[E2E] SSH reachable after ${i * 10}s`);
      return;
    }
    await sleep(10_000);
  }
  throw new Error('SSH never became reachable');
}

async function waitForCloudInitDone() {
  const attempts = Math.ceil(CLOUD_INIT_TIMEOUT_MS / 10_000);
  for (let i = 0; i < attempts; i++) {
    const status = ssh('cloud-init status 2>/dev/null | grep -o "done\\|running\\|error"');
    if (status === 'done') {
      console.log(`[E2E] cloud-init finished after ${i * 10}s`);
      return;
    }
    if (status === 'error') {
      throw new Error(`cloud-init failed: ${ssh('tail -50 /var/log/cloud-init-output.log')}`);
    }
    await sleep(10_000);
  }
  throw new Error('cloud-init did not finish within 5 minutes');
}

async function verifyDockerWorkload() {
  const dockerService = ssh('systemctl is-active docker');
  const workloadService = ssh('systemctl is-active justavps-docker');
  const daemonService = ssh('systemctl is-active justavps-daemon');
  if (dockerService !== 'active') throw new Error(`docker service is ${dockerService}`);
  if (workloadService !== 'active') throw new Error(`justavps-docker service is ${workloadService}`);
  if (daemonService !== 'active') throw new Error(`justavps-daemon service is ${daemonService}`);

  const runtime = ssh('docker inspect justavps-workload --format "{{.Path}} {{json .Args}}"');
  console.log(`[E2E] Docker runtime: ${runtime}`);
  if (!runtime?.includes('python')) throw new Error(`unexpected runtime path: ${runtime}`);
  if (!runtime.includes('["-m","http.server","8000"]')) {
    throw new Error(`unexpected runtime args: ${runtime}`);
  }

  const localBody = ssh('curl -sf http://localhost:8000/ | tr -d "\n" | head -c 160');
  console.log(`[E2E] localhost:8000 body: ${localBody}`);
  if (!localBody?.includes('Directory listing')) {
    throw new Error(`local Docker HTTP check failed: ${localBody}`);
  }

  const publicResponse = await fetch(`http://${machineIp}:8000/`);
  const publicBody = (await publicResponse.text()).slice(0, 160);
  console.log(`[E2E] public ${machineIp}:8000 -> ${publicResponse.status} ${publicBody}`);
  if (publicResponse.status !== 200 || !publicBody.includes('Directory listing')) {
    throw new Error(`public Docker HTTP check failed: ${publicResponse.status} ${publicBody}`);
  }

  let proxied = { status: '000', body: '' };
  for (let i = 0; i < PROXY_RETRIES; i++) {
    proxied = proxyGet('/', 8000);
    if (proxied.status === '200') break;
    await sleep(PROXY_POLL_INTERVAL_MS);
  }
  console.log(`[E2E] proxied 8000--${machineSlug}: ${proxied.status} ${proxied.body.slice(0, 160)}`);
  if (proxied.status !== '200' || !proxied.body.includes('Directory listing')) {
    const message = `proxied Docker HTTP check failed (${proxied.status})`;
    if (REQUIRE_PROXY) {
      throw new Error(`${message}: ${proxied.body.slice(0, 160)}`);
    }
    console.warn(`[E2E] Warning: ${message}: ${proxied.body.slice(0, 160)}`);
  }
}

async function cleanup() {
  if (machineId) {
    console.log(`[E2E] Cleaning up machine ${machineSlug} (${machineId})`);
    await apiDelete(`/v1/machines/${machineId}`).catch(() => null);
    machineId = '';
  }
  if (sshKeyPath) {
    try { execSync(`rm -f ${sshKeyPath}`); } catch {}
    sshKeyPath = '';
  }
  if (sessionApiKeyId && sessionCookieHeader) {
    await fetch(`${BASE_URL}/v1/api-keys/${sessionApiKeyId}`, {
      method: 'DELETE',
      headers: { Cookie: sessionCookieHeader },
    }).catch(() => null);
    sessionApiKeyId = '';
  }
}

async function main() {
  console.log('== Docker auto-run E2E ==');
  console.log(`Base URL: ${BASE_URL}`);

  await ensureApiKey();

  const create = await apiPost('/v1/machines', {
    provider: 'hetzner',
    server_type: 'cpx22',
    region: 'hel1',
    name: 'e2e-docker-python-http',
    docker_image: 'python:3.12-alpine',
    entrypoint: 'python',
    command: '-m http.server 8000',
  });

  if (create.status !== 202) {
    throw new Error(`Machine create failed: ${create.status} ${JSON.stringify(create.data)}`);
  }

  const machine = create.data as JsonRecord;
  machineId = String(machine.id || '');
  machineSlug = String(machine.slug || '');
  const sshKey = machine.ssh_key as JsonRecord | null;
  const privateKey = String(sshKey?.private_key || '');
  if (!machineId || !machineSlug || !privateKey) {
    throw new Error(`Create response missing machine metadata: ${JSON.stringify(machine)}`);
  }

  sshKeyPath = savePrivateKey(machineSlug, privateKey);
  console.log(`[E2E] Machine created: ${machineSlug} (${machineId})`);

  await waitForMachineReady();
  await waitForSSHReady();
  await waitForCloudInitDone();
  await verifyDockerWorkload();

  console.log('[E2E] Docker auto-run passed.');
}

process.on('SIGINT', () => {
  void cleanup().finally(() => process.exit(1));
});

main()
  .catch(async (error) => {
    console.error('[E2E] Failure:', error);
    await cleanup();
    process.exit(1);
  })
  .then(async () => {
    await cleanup();
    process.exit(0);
  });
