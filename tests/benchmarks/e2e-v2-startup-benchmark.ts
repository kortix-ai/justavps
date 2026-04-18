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
import { machineBenchmarks, machines, users } from '../../src/server/db/schema';
import { ensureUserAccountGraph } from "@/server/auth/accounts";
import { hashPassword } from "@/server/core/crypto";
import { createMachineV2, deleteMachineV2 } from "@/server/v2/services/machines";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.BASE_URL || 'http://localhost:4100';
const TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || '135.181.129.188';
const TARGET_HOST_ID = process.env.E2E_BAREMETAL_HOST_ID || undefined;
const TARGET_IMAGE_ID = process.env.E2E_IMAGE_ID || undefined;
const RUNNER_HOST = `root@${TARGET_HOST_IP}`;
const SSH_KEY = process.env.E2E_BAREMETAL_SSH_KEY || `${process.env.HOME}/.ssh/justavps_host`;
const SCENARIO = process.env.E2E_BENCHMARK_SCENARIO === 'warm' ? 'warm' : 'cold';

const state: {
  email: string;
  password: string;
  userId: string | null;
  accountId: string | null;
  machineId: string | null;
  warmPoolPerCpuBefore: string | null;
} = {
  email: `e2e-bench-${SCENARIO}-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  machineId: null,
  warmPoolPerCpuBefore: null,
};

type MachinePollView = { status: string; provisioning_stage: string | null; machine_mode?: string };

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

async function createHarnessUser() {
  const passwordHash = await hashPassword(state.password);
  const [user] = await db.insert(users).values({
    email: state.email,
    passwordHash,
    name: 'E2E Startup Benchmark Harness',
    isAdmin: true,
  }).returning();
  const account = await ensureUserAccountGraph(user);
  state.userId = user.id;
  state.accountId = account.id;
}

async function waitForWarmPoolReady(timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await requestJson<{ warm_pool?: { ready: number; target: number } }>(`http://${TARGET_HOST_IP}:7779/healthz`, {}, 30_000);
    const ready = res.data?.warm_pool?.ready ?? 0;
    const target = res.data?.warm_pool?.target ?? 0;
    if (target > 0 && ready >= target) return;
    await sleep(1_000);
  }
  throw new Error('Warm pool never became ready');
}

async function configureWarmPool() {
  const { stdout: envOut } = await sshHost("bash -lc \"grep '^WARM_POOL_PER_CPU=' /etc/justavps-runnerd.env | cut -d= -f2 || true\"");
  state.warmPoolPerCpuBefore = envOut.trim() || '1';
  const nextValue = SCENARIO === 'cold' ? '0' : '1';
  await sshHost(`bash -lc "if grep -q '^WARM_POOL_PER_CPU=' /etc/justavps-runnerd.env; then sed -i 's/^WARM_POOL_PER_CPU=.*/WARM_POOL_PER_CPU=${nextValue}/' /etc/justavps-runnerd.env; else echo 'WARM_POOL_PER_CPU=${nextValue}' >> /etc/justavps-runnerd.env; fi; systemctl restart justavps-runnerd"`, 180_000);
  if (SCENARIO === 'warm') await waitForWarmPoolReady();
}

async function cleanup() {
  if (state.machineId) {
    try { await deleteMachineV2({ accountId: state.accountId!, machineId: state.machineId }); } catch {}
  }
  if (state.accountId) {
    try { await db.delete(machineBenchmarks).where(eq(machineBenchmarks.accountId, state.accountId)); } catch {}
  }
  if (state.warmPoolPerCpuBefore !== null) {
    await sshHost(`bash -lc "sed -i 's/^WARM_POOL_PER_CPU=.*/WARM_POOL_PER_CPU=${state.warmPoolPerCpuBefore}/' /etc/justavps-runnerd.env || echo 'WARM_POOL_PER_CPU=${state.warmPoolPerCpuBefore}' >> /etc/justavps-runnerd.env; systemctl restart justavps-runnerd"`, 180_000).catch(() => {});
  }
}

async function main() {
  console.log(`=== JustAVPS V2 startup benchmark (${SCENARIO}) ===`);
  await createHarnessUser();
  await configureWarmPool();

  const createStart = Date.now();
  const create = await createMachineV2({
    accountId: state.accountId!,
    userId: state.userId!,
    isAdmin: true,
    requestUrl: BASE_URL,
    input: {
      vcpu: 2,
      ram_gb: 4,
      disk_gb: 40,
      region: 'hel1',
      machine_mode: 'vm',
      name: `e2e-${SCENARIO}-${Date.now()}`,
      ...(TARGET_HOST_ID ? { host_id: TARGET_HOST_ID } : {}),
      ...(TARGET_IMAGE_ID ? { image_id: TARGET_IMAGE_ID } : {}),
    },
  });
  if (create.kind !== 'machine') throw new Error(`unexpected create result: ${JSON.stringify(create)}`);
  state.machineId = create.machine.id;

  for (;;) {
    const [machine] = await db.select({
      status: machines.status,
      provisioning_stage: machines.provisioningStage,
      machine_mode: machines.machineMode,
    }).from(machines).where(eq(machines.id, state.machineId!)).limit(1) as unknown as Array<MachinePollView>;
    if (machine?.status === 'ready') break;
    if (machine?.status === 'error') throw new Error(`Machine failed: ${JSON.stringify(machine)}`);
    await sleep(250);
  }

  console.log(`[result] ${SCENARIO} ready in ${Date.now() - createStart}ms`);
  const rows = await db.select({
    machine_mode: machineBenchmarks.machineMode,
    machine_benchmark_scenario: machineBenchmarks.scenario,
    total_ms: machineBenchmarks.totalMs,
    created_at: machineBenchmarks.createdAt,
  }).from(machineBenchmarks).where(eq(machineBenchmarks.accountId, state.accountId!));
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup();
    process.exit(1);
  });
