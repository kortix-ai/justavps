#!/usr/bin/env npx tsx

import { eq } from 'drizzle-orm';

import { db } from '../../../src/server/db';
import { apiKeys, baremetalHosts, baremetalProcurements } from '../../../src/server/db/schema';
import { apiRequest, createAdminHarnessUser, DEFAULT_BASE_URL, ensureApiHealthy, HarnessIdentityState } from './lib/harness';

const BASE_URL = DEFAULT_BASE_URL;

type HostView = { id: string; status: string; region: string; host_class: string; scheduler: { schedulable: boolean | null } };
type Recommendation = { id: string; region: string | null; host_class: string | null; summary: string };
type Procurement = { id: string; status: string; requires_approval: boolean; region: string; host_class: string };

const state: HarnessIdentityState & {
  hostId: string | null;
  procurementId: string | null;
} = {
  email: `e2e-v2-procurement-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  hostId: null,
  procurementId: null,
};

async function cleanup() {
  if (state.procurementId) {
    await db.delete(baremetalProcurements).where(eq(baremetalProcurements.id, state.procurementId)).catch(() => undefined);
  }
  if (state.hostId) {
    await db.delete(baremetalHosts).where(eq(baremetalHosts.id, state.hostId)).catch(() => undefined);
  }
  if (state.apiKeyId) {
    await db.delete(apiKeys).where(eq(apiKeys.id, state.apiKeyId)).catch(() => undefined);
  }
}

async function main() {
  console.log('=== JustAVPS V2 capacity/procurement E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);

  await ensureApiHealthy(BASE_URL);

  await createAdminHarnessUser(state, 'E2E V2 Procurement Admin');

  const HOST_CLASS = `general-small-e2e-${Date.now()}`;
  const REGION = 'eu';

  const hostCreate = await apiRequest<{ host: HostView }>(state, `/admin/fleet/hosts`, {
    method: 'POST',
    body: JSON.stringify({ region: REGION, host_class: HOST_CLASS, generation: 'gen1', location: 'NBG1-DC3', name: `e2e-capacity-host-${Date.now()}`, vendor: 'manual', public_ipv4: '198.51.100.11' }),
  });
  state.hostId = hostCreate.data.host.id;
  console.log(`[host] created id=${state.hostId}`);

  await apiRequest<{ host: HostView }>(state, `/admin/fleet/hosts/${state.hostId}/register`, {
    method: 'POST',
    body: JSON.stringify({ runner_base_url: 'http://127.0.0.1:4402', public_ipv4: '198.51.100.11', total_vcpu: 2, total_memory_gb: 4, total_disk_gb: 40, generation: 'gen1', status: 'bootstrapping' }),
  });
  await apiRequest<{ host: HostView }>(state, `/admin/fleet/hosts/${state.hostId}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify({ incus_ok: true, zfs_ok: true, runner_ok: true, drift_status: 'in_policy', instance_count: 0, image_count: 0, alerts: [] }),
  });

  const recommendations = await apiRequest<{ recommendations: Recommendation[] }>(state, '/admin/fleet/procurement-recommendations');
  const recommendation = recommendations.data.recommendations.find((item) => item.region === REGION && item.host_class === HOST_CLASS);
  if (!recommendation) {
    console.log('[recommendation] no recommendation found (may be expected without reserve policy)');
  } else {
    console.log(`[recommendation] found id=${recommendation.id}`);
  }

  const procurement = await apiRequest<{ procurement: Procurement }>(state, '/admin/fleet/procurements', {
    method: 'POST',
    body: JSON.stringify({
      vendor: 'hetzner_robot',
      host_class: HOST_CLASS,
      generation: 'gen1',
      procurement_purpose: 'reserve_replenishment',
      product_id: 'AX41-NVMe',
      region: REGION,
      location: 'NBG1-DC1',
      requires_approval: true,
    }),
  });
  state.procurementId = procurement.data.procurement.id;
  if (procurement.data.procurement.status !== 'requested' || procurement.data.procurement.requires_approval !== true) {
    throw new Error(`Unexpected procurement payload: ${JSON.stringify(procurement.data.procurement)}`);
  }
  console.log(`[procurement] created id=${state.procurementId}`);

  const procurements = await apiRequest<{ procurements: Procurement[] }>(state, '/admin/fleet/procurements');
  if (!procurements.data.procurements.some((item) => item.id === state.procurementId)) {
    throw new Error('Expected created procurement to appear in procurement listing');
  }
  console.log('[procurement] listing verified');

  console.log('=== V2 capacity/procurement E2E passed ===');
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
