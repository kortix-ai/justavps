#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import nodeHttp from 'node:http';
import https from 'node:https';
import { eq } from 'drizzle-orm';

import { db } from '../../src/server/db';
import { apiKeys, users } from '../../src/server/db/schema';
import { ensureUserAccountGraph } from "@/server/auth/accounts";
import { generateApiKey, hashPassword } from "@/server/core/crypto";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.BASE_URL || 'http://localhost:4100';
const API_V2 = `${BASE_URL}/api/v2`;
const TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || '135.181.129.188';
const TARGET_HOST_ID = process.env.E2E_BAREMETAL_HOST_ID || undefined;
const TARGET_IMAGE_ID = process.env.E2E_IMAGE_ID || undefined;
const RUNNER_HOST = `root@${TARGET_HOST_IP}`;
const SSH_KEY = process.env.E2E_BAREMETAL_SSH_KEY || `${process.env.HOME}/.ssh/justavps_host`;

const state: {
  email: string;
  password: string;
  userId: string | null;
  accountId: string | null;
  apiKey: string | null;
  apiKeyId: string | null;
  machineId: string | null;
  warmPoolPerCpuBefore: string | null;
} = {
  email: `e2e-cold-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  machineId: null,
  warmPoolPerCpuBefore: null,
};

type MachinePollView = {
  status: string;
  provisioning_stage: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sshHost(command: string, timeoutMs = 120_000) {
  const { stdout, stderr } = await execFileAsync(
    'ssh',
    ['-i', SSH_KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', RUNNER_HOST, command],
    { timeout: timeoutMs },
  );
  return { stdout, stderr };
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

function authHeaders() {
  if (!state.apiKey) throw new Error('API key not initialized');
  return { Authorization: `Bearer ${state.apiKey}`, 'Content-Type': 'application/json' };
}

async function http<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const res = await requestJson<T>(`${API_V2}${path}`, {
    method: init.method,
    body: typeof init.body === 'string' ? init.body : undefined,
    headers: { ...authHeaders(), ...((init.headers ?? {}) as Record<string, string>) },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
  return { status: res.status, data: res.data as T };
}

async function createHarnessUser() {
  const passwordHash = await hashPassword(state.password);
  const [user] = await db.insert(users).values({
    email: state.email,
    passwordHash,
    name: 'E2E Cold Harness',
    isAdmin: true,
  }).returning();
  const account = await ensureUserAccountGraph(user);
  const { key, hash, sha256, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({
    ownerId: user.id,
    accountId: account.id,
    name: `e2e-cold-${Date.now()}`,
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
}

async function cleanup() {
  if (state.machineId) {
    try { await http(`/machines/${state.machineId}`, { method: 'DELETE' }); } catch {}
  }
  if (state.apiKeyId) {
    try { await db.delete(apiKeys).where(eq(apiKeys.id, state.apiKeyId)); } catch {}
  }
  if (state.warmPoolPerCpuBefore !== null) {
    await sshHost(`bash -lc "sed -i 's/^WARM_POOL_PER_CPU=.*/WARM_POOL_PER_CPU=${state.warmPoolPerCpuBefore}/' /etc/justavps-runnerd.env || echo 'WARM_POOL_PER_CPU=${state.warmPoolPerCpuBefore}' >> /etc/justavps-runnerd.env; systemctl restart justavps-runnerd"`, 180_000).catch(() => {});
  }
}

async function main() {
  console.log('=== JustAVPS V2 cold benchmark ===');
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`E2E_BAREMETAL_HOST_ID=${TARGET_HOST_ID ?? '(auto)'}`);
  console.log(`E2E_BAREMETAL_HOST_IP=${TARGET_HOST_IP}`);
  console.log(`E2E_BAREMETAL_SSH_KEY=${SSH_KEY}`);
  console.log(`E2E_IMAGE_ID=${TARGET_IMAGE_ID ?? '(default)'}`);
  await createHarnessUser();

  const { stdout: envOut } = await sshHost("bash -lc \"grep '^WARM_POOL_PER_CPU=' /etc/justavps-runnerd.env | cut -d= -f2 || true\"");
  state.warmPoolPerCpuBefore = envOut.trim() || '1';
  console.log(`[setup] previous WARM_POOL_PER_CPU=${state.warmPoolPerCpuBefore}`);

  console.log('[setup] disabling warm pool to force cold path...');
  await sshHost("bash -lc \"if grep -q '^WARM_POOL_PER_CPU=' /etc/justavps-runnerd.env; then sed -i 's/^WARM_POOL_PER_CPU=.*/WARM_POOL_PER_CPU=0/' /etc/justavps-runnerd.env; else echo 'WARM_POOL_PER_CPU=0' >> /etc/justavps-runnerd.env; fi; systemctl restart justavps-runnerd\"", 180_000);
  await sleep(2_000);

  const createStart = Date.now();
  const create = await http<{ id: string; slug: string; status: string }>('/machines', {
    method: 'POST',
    body: JSON.stringify({ vcpu: 2, ram_gb: 4, disk_gb: 40, region: 'hel1', name: `e2e-cold-${Date.now()}`, ...(TARGET_HOST_ID ? { host_id: TARGET_HOST_ID } : {}), ...(TARGET_IMAGE_ID ? { image_id: TARGET_IMAGE_ID } : {}) }),
  });
  state.machineId = create.data.id;
  console.log(`[machine] create accepted id=${state.machineId} slug=${create.data.slug} in ${Date.now() - createStart}ms`);

  let last = '';
  for (;;) {
    const { data } = await http<MachinePollView>(`/machines/${state.machineId}`);
    const line = `${data.status} | ${data.provisioning_stage ?? ''}`;
    if (line !== last) {
      console.log(`[machine] +${Date.now() - createStart}ms ${line}`);
      last = line;
    }
    if (data.status === 'ready') {
      console.log(`[result] READY in ${Date.now() - createStart}ms`);
      break;
    }
    if (data.status === 'error') {
      throw new Error(`Cold benchmark machine failed: ${JSON.stringify(data)}`);
    }
    await sleep(250);
  }

  console.log('=== JustAVPS V2 cold benchmark PASSED ===');
}

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
