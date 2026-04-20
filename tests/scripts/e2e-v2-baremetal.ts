#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
import nodeHttp from 'node:http';
import https from 'node:https';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { and, eq } from 'drizzle-orm';

import { db } from '../../src/server/db';
import { apiKeys, baremetalHosts, hostCapacityReservations, images, machines, users } from '../../src/server/db/schema';
import { ensureUserAccountGraph } from "@/server/auth/accounts";
import { generateApiKey, hashPassword } from "@/server/core/crypto";

const BASE_URL = process.env.BASE_URL || 'http://localhost:4100';
const API_BASE = `${BASE_URL}/api/v2`;
const MACHINE_CALLBACK_URL = process.env.MACHINE_CALLBACK_URL || '';
const TARGET_HOST_ID = process.env.E2E_BAREMETAL_HOST_ID || undefined;
const TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || '135.181.129.188';
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
  health: { last_heartbeat_at: string | null } | null;
  connectivity: {
    access: { mode: 'rest_exec'; exec_endpoint: string };
    urls: { proxy: string; terminal: string; port_template: string };
  };
};

type SnapshotView = { id: string; name: string; status: string; created_at: string };
type ImageView = { id: string; name: string; status: string };

const state: {
  email: string;
  password: string;
  userId: string | null;
  accountId: string | null;
  apiKey: string | null;
  apiKeyId: string | null;
  machineId: string | null;
  machineSlug: string | null;
  snapshotId: string | null;
  imageId: string | null;
} = {
  email: `e2e-v2-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  machineId: null,
  machineSlug: null,
  snapshotId: null,
  imageId: null,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson<T>(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 15 * 60_000): Promise<{ status: number; data: T | null }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : nodeHttp;
    const req = transport.request(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
    }, (res: nodeHttp.IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data: T | null = null;
        try {
          data = text ? JSON.parse(text) as T : null;
        } catch {
          data = null;
        }
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

async function http<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const res = await requestJson<T>(`${API_BASE}${path}`, {
    method: init.method,
    body: typeof init.body === 'string' ? init.body : undefined,
    headers: {
      ...authHeaders(),
      ...((init.headers ?? {}) as Record<string, string>),
    },
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

  const detail = lastError
    ? ` last error=${lastError instanceof Error ? lastError.message : String(lastError)}`
    : ` last value=${JSON.stringify(lastValue)}`;
  throw new Error(`Timed out waiting for ${label}.${detail}`);
}

async function createHarnessUser() {
  const passwordHash = await hashPassword(state.password);
  const [user] = await db.insert(users).values({
    email: state.email,
    passwordHash,
    name: 'E2E V2 Admin',
    isAdmin: true,
  }).returning();

  const account = await ensureUserAccountGraph(user);
  const { key, hash, sha256, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({
    ownerId: user.id,
    accountId: account.id,
    name: `e2e-v2-${Date.now()}`,
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

  console.log(`[setup] user=${state.email}`);
  console.log(`[setup] account=${account.id}`);
}

async function cleanup() {
  if (state.imageId && state.accountId) {
    try {
      await http(`/images/${state.imageId}`, { method: 'DELETE' });
    } catch {}
  }

  if (state.machineId && state.accountId) {
    try {
      await http(`/machines/${state.machineId}`, { method: 'DELETE' });
    } catch {}

    try {
      await waitFor(
        'machine deletion',
        async () => db.select({ status: machines.status }).from(machines).where(eq(machines.id, state.machineId!)),
        (rows) => rows.length === 0 || rows[0]?.status === 'deleted',
        120_000,
        5_000,
      );
    } catch {}
  }

  if (state.apiKeyId) {
    try {
      await db.delete(apiKeys).where(eq(apiKeys.id, state.apiKeyId));
    } catch {}
  }
}

async function getMachine(machineId: string) {
  const { data } = await http<MachineView>(`/machines/${machineId}`);
  return data;
}

async function listSnapshots(machineId: string) {
  const { data } = await http<{ snapshots: SnapshotView[] }>(`/snapshots/${machineId}`);
  return data.snapshots;
}

async function listImages() {
  const { data } = await http<{ images: ImageView[] }>('/images');
  return data.images;
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

async function main() {
  console.log('=== JustAVPS V2 baremetal E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`MACHINE_CALLBACK_URL=${MACHINE_CALLBACK_URL}`);
  console.log(`E2E_BAREMETAL_HOST_ID=${TARGET_HOST_ID ?? '(auto)'}`);
  console.log(`E2E_IMAGE_ID=${TARGET_IMAGE_ID ?? '(default)'}`);
  console.log(`E2E_MACHINE=${MACHINE_VCPU}vCPU/${MACHINE_RAM_GB}GB/${MACHINE_DISK_GB}GB`);

  if (!MACHINE_CALLBACK_URL || /dev\.justavps\.com/.test(MACHINE_CALLBACK_URL)) {
    throw new Error(`MACHINE_CALLBACK_URL is not ready for local callback validation: ${MACHINE_CALLBACK_URL || '(empty)'}`);
  }

  const health = await requestJson<{ status?: string }>(`${BASE_URL}/api/health`, {}, 30_000);
  if (health.status < 200 || health.status >= 300) throw new Error(`Local API health failed: ${health.status}`);

  const [targetHost] = TARGET_HOST_ID
    ? await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, TARGET_HOST_ID)).limit(1)
    : await db.select().from(baremetalHosts).where(eq(baremetalHosts.publicIpv4, TARGET_HOST_IP)).limit(1);
  if (targetHost?.id) {
    await reconcileLocalHostCapacity(targetHost.id);
  }

  await createHarnessUser();

  const create = await http<MachineView>('/machines', {
    method: 'POST',
    body: JSON.stringify({
      plan: 'custom',
      region: 'hel1',
      name: `e2e-v2-${Date.now()}`,
      billing_mode: 'flat_monthly',
      billing_interval: 'monthly',
      vcpu: MACHINE_VCPU,
      ram_gb: MACHINE_RAM_GB,
      disk_gb: MACHINE_DISK_GB,
      ...(TARGET_HOST_ID ? { host_id: TARGET_HOST_ID } : {}),
      ...(TARGET_IMAGE_ID ? { image_id: TARGET_IMAGE_ID } : {}),
    }),
  });

  if (create.status !== 202) throw new Error(`Expected 202 from machine create, got ${create.status}`);
  state.machineId = create.data.id;
  state.machineSlug = create.data.slug;
  console.log(`[machine] created id=${state.machineId} slug=${state.machineSlug}`);

  const ready = await waitFor(
    'machine readiness via real heartbeat',
    () => getMachine(state.machineId!),
    (machine) => machine.status === 'ready' && Boolean(machine.ready_at) && Boolean(machine.health?.last_heartbeat_at),
    15 * 60_000,
    10_000,
  );
  console.log(`[machine] ready exec=${ready.connectivity.access.exec_endpoint} proxy=${ready.connectivity.urls.proxy}`);
  console.log(`[machine] heartbeat=${ready.health?.last_heartbeat_at}`);

  await http(`/machines/${state.machineId}/stop`, { method: 'POST' });
  await waitFor('machine stopped', () => getMachine(state.machineId!), (machine) => machine.status === 'stopped', 120_000, 5_000);
  console.log('[machine] stop verified');

  await http(`/machines/${state.machineId}/start`, { method: 'POST' });
  const afterStart = await waitFor('machine restarted', () => getMachine(state.machineId!), (machine) => machine.status === 'ready', 180_000, 5_000);
  console.log(`[machine] start verified heartbeat=${afterStart.health?.last_heartbeat_at}`);

  const heartbeatBeforeReboot = afterStart.health?.last_heartbeat_at ?? null;
  await http(`/machines/${state.machineId}/reboot`, { method: 'POST' });
  const afterReboot = await waitFor(
    'post-reboot heartbeat',
    () => getMachine(state.machineId!),
    (machine) => machine.status === 'ready' && !!machine.health?.last_heartbeat_at && machine.health.last_heartbeat_at !== heartbeatBeforeReboot,
    5 * 60_000,
    10_000,
  );
  console.log(`[machine] reboot verified heartbeat=${afterReboot.health?.last_heartbeat_at}`);

  const snapshotName = `e2e-snap-${Date.now()}`;
  const snapshotCreate = await http<SnapshotView>(`/snapshots/${state.machineId}`, {
    method: 'POST',
    body: JSON.stringify({ name: snapshotName }),
  });
  state.snapshotId = snapshotCreate.data.id;
  console.log(`[snapshot] create requested id=${state.snapshotId}`);

  const readySnapshot = await waitFor(
    'snapshot ready',
    () => listSnapshots(state.machineId!),
    (snapshots) => snapshots.some((snapshot) => snapshot.id === state.snapshotId && snapshot.status === 'ready'),
    10 * 60_000,
    10_000,
  );
  console.log(`[snapshot] ready count=${readySnapshot.length}`);

  await http(`/snapshots/${state.machineId}/${state.snapshotId}/restore`, { method: 'POST' });
  console.log('[snapshot] restore verified');

  await http(`/snapshots/${state.machineId}/${state.snapshotId}`, { method: 'DELETE' });
  await waitFor(
    'snapshot deletion',
    () => listSnapshots(state.machineId!),
    (snapshots) => !snapshots.some((snapshot) => snapshot.id === state.snapshotId),
    120_000,
    5_000,
  );
  console.log('[snapshot] delete verified');
  state.snapshotId = null;

  const imageName = `e2e-image-${Date.now()}`;
  const imageCreate = await http<ImageView>('/images', {
    method: 'POST',
    body: JSON.stringify({ machine_id: state.machineId, name: imageName }),
  });
  state.imageId = imageCreate.data.id;
  console.log(`[image] create requested id=${state.imageId}`);

  await waitFor(
    'image ready',
    () => listImages(),
    (allImages) => allImages.some((image) => image.id === state.imageId && image.status === 'ready'),
    10 * 60_000,
    10_000,
  );
  console.log('[image] ready');

  await http(`/images/${state.imageId}`, { method: 'DELETE' });
  await waitFor(
    'image deletion',
    () => listImages(),
    (allImages) => !allImages.some((image) => image.id === state.imageId),
    120_000,
    5_000,
  );
  console.log('[image] delete verified');
  state.imageId = null;

  await http(`/machines/${state.machineId}`, { method: 'DELETE' });
  await waitFor(
    'machine marked deleted',
    async () => db.select({ status: machines.status }).from(machines).where(eq(machines.id, state.machineId!)),
    (rows) => rows.length > 0 && rows[0].status === 'deleted',
    180_000,
    5_000,
  );
  console.log('[machine] delete verified');
  state.machineId = null;

  const dbImages = await db.select({ id: images.id, status: images.status }).from(images).where(and(eq(images.accountId, state.accountId!), eq(images.ownerId, state.userId!)));
  if (dbImages.some((image) => image.status !== 'deleted')) {
    throw new Error(`Unexpected non-deleted images remain for harness account: ${JSON.stringify(dbImages)}`);
  }

  console.log('=== V2 baremetal E2E passed ===');
  console.log(`HARNESS_EMAIL=${state.email}`);
  console.log(`HARNESS_PASSWORD=${state.password}`);
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
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup();
    process.exit(1);
  });
