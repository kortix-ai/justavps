#!/usr/bin/env npx tsx

import { and, eq } from 'drizzle-orm';

import { db } from '../../../src/server/db';
import { apiKeys, hostCapacityReservations, machines } from '../../../src/server/db/schema';
import { apiRequest, createAdminHarnessUser, DEFAULT_BASE_URL, DEFAULT_API_BASE, ensureApiHealthy, getTargetHost, HarnessIdentityState, reconcileLocalHostCapacity, requestJson, waitFor } from './lib/harness';

const BASE_URL = DEFAULT_BASE_URL;
const API_BASE = DEFAULT_API_BASE;

type MachineView = { id: string; slug: string; status: string; ready_at: string | null; provisioning_stage: string | null; };

const state: HarnessIdentityState & {
  machineId: string | null;
} = {
  email: `e2e-v2-placement-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  machineId: null,
};

async function cleanup() {
  if (state.machineId) {
    try { await apiRequest(state, `/machines/${state.machineId}`, { method: 'DELETE' }); } catch {}
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
  console.log('=== JustAVPS V2 placement/capacity E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);

  await ensureApiHealthy(BASE_URL);

  await createAdminHarnessUser(state, 'E2E V2 Placement Admin');
  const host = await getTargetHost();
  await reconcileLocalHostCapacity(host.id);
  console.log(`[host] using host=${host.id} total=${host.totalVcpu}/${host.totalMemoryGb}/${host.totalDiskGb}`);

  const create = await apiRequest<MachineView>(state, '/machines', {
    method: 'POST',
    body: JSON.stringify({
      region: host.region,
      host_id: host.id,
      machine_mode: 'container',
      docker_image: 'alpine:3.20',
      vcpu: 1,
      ram_gb: 1,
      disk_gb: 10,
      name: `e2e-placement-${Date.now()}`,
      enable_backups: false,
    }),
  });
  state.machineId = create.data.id;
  console.log(`[machine] created id=${state.machineId}`);

  const reservedLease = await waitFor(
    'reservation created',
    async () => db.select().from(hostCapacityReservations).where(and(eq(hostCapacityReservations.machineId, state.machineId!), eq(hostCapacityReservations.reservationType, 'machine_create'))),
    (rows) => rows.length > 0,
    30_000,
    1_000,
  );
  console.log(`[lease] initial state=${reservedLease[0]!.state}`);

  const committedLease = await waitFor(
    'reservation committed',
    async () => db.select().from(hostCapacityReservations).where(and(eq(hostCapacityReservations.machineId, state.machineId!), eq(hostCapacityReservations.reservationType, 'machine_create'))),
    (rows) => rows.length > 0 && rows[0]!.state === 'committed',
    180_000,
    5_000,
  );
  console.log(`[lease] committed reservation=${committedLease[0]!.id}`);

  const placedMachine = await waitFor(
    'machine placed after reservation commit',
    () => apiRequest<MachineView>(state, `/machines/${state.machineId}`),
    (res) => ['provisioning', 'ready'].includes(res.data.status) && Boolean(res.data.provisioning_stage),
    60_000,
    5_000,
  );
  console.log(`[machine] placed slug=${placedMachine.data.slug} status=${placedMachine.data.status} stage=${placedMachine.data.provisioning_stage}`);

  const tooLargeVcpu = Math.min((host.totalVcpu ?? 32) + 1, 128);
  const tooLargeMemory = Math.min((host.totalMemoryGb ?? 64) + 1, 512);
  const tooLargeDisk = Math.min((host.totalDiskGb ?? 1000) + 1, 2000);
  const rejected = await requestJson<{ error: boolean; message: string; details?: { placement_decision?: { outcome: string; summary: string; explanation: string[] } } }>(`${API_BASE}/machines`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      region: host.region,
      host_id: host.id,
      machine_mode: 'container',
      docker_image: 'alpine:3.20',
      vcpu: tooLargeVcpu,
      ram_gb: tooLargeMemory,
      disk_gb: tooLargeDisk,
      name: `e2e-oversell-${Date.now()}`,
      enable_backups: false,
    }),
  }, 120_000);

  if (rejected.status !== 409) {
    throw new Error(`Expected 409 for over-capacity placement, got ${rejected.status} ${JSON.stringify(rejected.data)}`);
  }
  const placement = rejected.data?.details?.placement_decision;
  if (!placement || placement.outcome !== 'rejected') {
    throw new Error(`Expected rejected placement decision details, got ${JSON.stringify(rejected.data)}`);
  }
  console.log(`[placement] rejection verified summary=${placement.summary}`);

  console.log('=== V2 placement/capacity E2E passed ===');
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
