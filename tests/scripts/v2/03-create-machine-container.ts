#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
import nodeHttp from 'node:http';
import https from 'node:https';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { and, eq } from 'drizzle-orm';

import { db } from '../../../src/server/db';
import { apiKeys, baremetalHosts, hostCapacityReservations, machines, users } from '../../../src/server/db/schema';
import { ensureUserAccountGraph } from '@/server/auth/accounts';
import { generateApiKey, hashPassword } from '@/server/core/crypto';
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from './lib/checkpoints';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4100';
const API_BASE = `${BASE_URL}/api/v2`;
const TARGET_HOST_ID = process.env.E2E_BAREMETAL_HOST_ID || undefined;
const TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || '135.181.129.188';
const CHECKPOINT_SUITE = 'e2e-v2-create-machine-container';

type MachineView = {
  id: string;
  slug: string;
  status: string;
  provisioning_stage: string | null;
  ready_at: string | null;
  health: { last_heartbeat_at: string | null } | null;
  connectivity: { urls: { proxy: string; terminal: string; port_template: string } };
};

type HostRow = typeof baremetalHosts.$inferSelect;
type SnapshotView = { id: string; name: string; status: string };
type SnapshotListResponse = {
  snapshots: SnapshotView[];
  restore_executions: unknown[];
  summary: Record<string, unknown>;
};

let state: {
  email: string;
  password: string;
  userId: string | null;
  accountId: string | null;
  apiKey: string | null;
  apiKeyId: string | null;
  machineId: string | null;
  snapshotId: string | null;
  phase: 'init' | 'user_ready' | 'machine_created' | 'machine_ready' | 'snapshot_created' | 'done';
} = {
  email: `e2e-v2-container-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  machineId: null,
  snapshotId: null,
  phase: 'init',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson<T>(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 15 * 60_000): Promise<{ status: number; data: T | null }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : nodeHttp;
    const req = transport.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
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
  return {
    Authorization: `Bearer ${state.apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function http<T>(path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  const res = await requestJson<T>(`${API_BASE}${path}`, {
    method: init.method,
    body: init.body,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { status: res.status, data: res.data as T };
}

async function runProvisionerPass() {
  await http('/admin/fleet/control-plane/run', {
    method: 'POST',
    body: JSON.stringify({ services: ['provisioner'] }),
  });
}

async function fetchText(url: string, timeoutMs = 30_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { status: res.status, text };
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

async function createHarnessUser() {
  if (state.apiKey && state.apiKeyId && state.userId && state.accountId) return;
  const passwordHash = await hashPassword(state.password);
  const [user] = await db.insert(users).values({
    email: state.email,
    passwordHash,
    name: 'E2E V2 Container Admin',
    isAdmin: true,
  }).returning();

  const account = await ensureUserAccountGraph(user);
  const { key, hash, sha256, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({
    ownerId: user.id,
    accountId: account.id,
    name: `e2e-v2-container-${Date.now()}`,
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
  state.phase = 'user_ready';
  await saveCheckpoint(CHECKPOINT_SUITE, state);
}

async function getTargetHost(): Promise<HostRow> {
  const [explicit] = TARGET_HOST_ID
    ? await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, TARGET_HOST_ID)).limit(1)
    : [];
  if (explicit) return explicit;
  const [byIp] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.publicIpv4, TARGET_HOST_IP)).limit(1);
  if (byIp) return byIp;
  const rows = await db.select().from(baremetalHosts);
  const active = rows.find((row) => row.status === 'active' && row.runnerBaseUrl && (((row.metadata as Record<string, unknown> | null)?.scheduler as Record<string, unknown> | undefined)?.schedulable === true));
  if (!active) throw new Error('No active schedulable host found for container machine test');
  return active;
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
}

async function cleanup() {
  if (state.snapshotId && state.machineId) {
    try { await http(`/snapshots/${state.machineId}/${state.snapshotId}`, { method: 'DELETE' }); } catch {}
  }
  if (state.machineId) {
    try { await http(`/machines/${state.machineId}`, { method: 'DELETE' }); } catch {}
    try {
      await waitFor(
        'machine deleted',
        async () => db.select({ status: machines.status }).from(machines).where(eq(machines.id, state.machineId!)),
        (rows) => rows.length > 0 && rows[0].status === 'deleted',
        180_000,
        5_000,
      );
    } catch {}
  }
  if (state.apiKeyId) {
    await db.delete(apiKeys).where(eq(apiKeys.id, state.apiKeyId)).catch(() => undefined);
  }
}

async function main() {
  console.log('=== JustAVPS V2 create-machine-container E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);

  state = await loadCheckpoint(CHECKPOINT_SUITE, state);
  if (state.phase !== 'init') {
    console.log(`[checkpoint] resuming from phase=${state.phase}`);
  }

  const health = await requestJson<{ status?: string }>(`${BASE_URL}/api/health`, {}, 30_000);
  if (health.status < 200 || health.status >= 300) throw new Error(`Local API health failed: ${health.status}`);

  await createHarnessUser();
  const host = await getTargetHost();
  await reconcileLocalHostCapacity(host.id);
  console.log(`[host] using host=${host.id}`);

  if (!state.machineId) {
    const create = await http<MachineView>('/machines', {
      method: 'POST',
      body: JSON.stringify({
        region: host.region,
        host_id: host.id,
        machine_mode: 'container',
        docker_image: 'nginx:alpine',
        vcpu: 1,
        ram_gb: 1,
        disk_gb: 10,
        name: `e2e-container-${Date.now()}`,
        enable_backups: false,
      }),
    });
    state.machineId = create.data.id;
    state.phase = 'machine_created';
    await saveCheckpoint(CHECKPOINT_SUITE, state);
    console.log(`[machine] created id=${state.machineId}`);
  } else {
    console.log(`[machine] reusing existing machine id=${state.machineId}`);
  }

  const ready = await waitFor(
    'container machine readiness',
    async () => {
      await runProvisionerPass();
      return http<MachineView>(`/machines/${state.machineId}`);
    },
    (res) => res.data.status === 'ready' && Boolean(res.data.ready_at),
    5 * 60_000,
    5_000,
  );
  console.log(`[machine] ready stage=${ready.data.provisioning_stage}`);
  state.phase = 'machine_ready';
  await saveCheckpoint(CHECKPOINT_SUITE, state);

  const machineRow = (await db.select().from(machines).where(eq(machines.id, state.machineId!)))[0];
  if (!machineRow) throw new Error('Machine row missing after ready');
  const machineMeta = (machineRow.providerMeta ?? {}) as Record<string, unknown>;
  const httpPort = typeof machineMeta.http_port === 'number' ? machineMeta.http_port : machineRow.httpPort;
  const publicIpv4 = machineRow.publicIpv4 ?? host.publicIpv4;
  if (!publicIpv4 || !httpPort) throw new Error(`Missing public route for container machine: ip=${publicIpv4} port=${httpPort}`);

  const serviceReady = await waitFor(
    'nginx service availability',
    () => fetchText(`http://${publicIpv4}:${httpPort}`),
    (res) => res.status === 200 && /nginx/i.test(res.text),
    120_000,
    5_000,
  );
  console.log(`[machine] http verified status=${serviceReady.status}`);

  if (!state.snapshotId) {
    const snapshotCreate = await http<SnapshotView>(`/snapshots/${state.machineId}`, {
      method: 'POST',
      body: JSON.stringify({ name: `container-snap-${Date.now()}` }),
    });
    state.snapshotId = snapshotCreate.data.id;
    state.phase = 'snapshot_created';
    await saveCheckpoint(CHECKPOINT_SUITE, state);
    console.log(`[snapshot] create requested id=${state.snapshotId}`);
  } else {
    console.log(`[snapshot] reusing id=${state.snapshotId}`);
  }

  await waitFor(
    'container snapshot ready',
    async () => {
      const list = await http<SnapshotListResponse>(`/snapshots/${state.machineId}`);
      return list.data.snapshots;
    },
    (rows) => rows.some((snapshot) => snapshot.id === state.snapshotId && snapshot.status === 'ready'),
    120_000,
    5_000,
  );
  console.log('[snapshot] ready verified');

  await http(`/machines/${state.machineId}/stop`, { method: 'POST' });
  await waitFor('machine stopped', () => http<MachineView>(`/machines/${state.machineId}`), (res) => res.data.status === 'stopped', 120_000, 5_000);
  console.log('[machine] stop verified');

  const afterStop = await fetchText(`http://${publicIpv4}:${httpPort}`, 10_000).catch(() => ({ status: 0, text: '' }));
  if (afterStop.status === 200) {
    throw new Error('Expected container HTTP endpoint to stop responding after stop');
  }
  console.log('[machine] stop closed HTTP path');

  await http(`/machines/${state.machineId}/start`, { method: 'POST' });
  await waitFor('machine started', () => http<MachineView>(`/machines/${state.machineId}`), (res) => res.data.status === 'ready', 180_000, 5_000);
  console.log('[machine] start verified');
  await waitFor(
    'nginx after start',
    () => fetchText(`http://${publicIpv4}:${httpPort}`),
    (res) => res.status === 200 && /nginx/i.test(res.text),
    120_000,
    5_000,
  );

  await http(`/machines/${state.machineId}/reboot`, { method: 'POST' });
  await waitFor(
    'machine rebooted',
    () => http<MachineView>(`/machines/${state.machineId}`),
    (res) => res.data.status === 'ready',
    2 * 60_000,
    5_000,
  );
  await waitFor(
    'nginx after reboot',
    () => fetchText(`http://${publicIpv4}:${httpPort}`),
    (res) => res.status === 200 && /nginx/i.test(res.text),
    120_000,
    5_000,
  );
  console.log('[machine] reboot verified');

  await http(`/snapshots/${state.machineId}/${state.snapshotId}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  await waitFor(
    'nginx after snapshot restore',
    () => fetchText(`http://${publicIpv4}:${httpPort}`),
    (res) => res.status === 200 && /nginx/i.test(res.text),
    120_000,
    5_000,
  );
  console.log('[snapshot] restore verified');

  await http(`/snapshots/${state.machineId}/${state.snapshotId}`, { method: 'DELETE' });
  await waitFor(
    'snapshot deleted',
    async () => {
      const list = await http<SnapshotListResponse>(`/snapshots/${state.machineId}`);
      return list.data.snapshots;
    },
    (rows) => rows.some((snapshot) => snapshot.id === state.snapshotId && snapshot.status === 'deleted'),
    120_000,
    5_000,
  );
  console.log('[snapshot] delete verified');
  state.snapshotId = null;

  const reservationRows = await db.select().from(hostCapacityReservations).where(and(eq(hostCapacityReservations.machineId, state.machineId), eq(hostCapacityReservations.reservationType, 'machine_create')));
  if (reservationRows.length === 0 || reservationRows[0]!.state !== 'committed') {
    throw new Error(`Expected committed host capacity reservation, got ${JSON.stringify(reservationRows)}`);
  }
  console.log('[lease] committed reservation verified');

  state.phase = 'done';
  await saveCheckpoint(CHECKPOINT_SUITE, state);
  console.log('=== V2 create-machine-container E2E passed ===');
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(1);
});

process.on('uncaughtException', async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});

main()
  .then(async () => {
    await cleanup();
    await clearCheckpoint(CHECKPOINT_SUITE);
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    console.error(`[checkpoint] preserved at .e2e-checkpoints/${CHECKPOINT_SUITE}.json for resume`);
    process.exit(1);
  });
