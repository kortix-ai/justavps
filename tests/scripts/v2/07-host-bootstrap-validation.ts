#!/usr/bin/env npx tsx

import { eq } from 'drizzle-orm';

import { db } from '../../../src/server/db';
import { apiKeys, baremetalHosts } from '../../../src/server/db/schema';
import { apiRequest, createAdminHarnessUser, DEFAULT_BASE_URL, ensureApiHealthy, HarnessIdentityState } from './lib/harness';

const BASE_URL = DEFAULT_BASE_URL;

type HostView = {
  id: string;
  status: string;
  drift_status: string | null;
  scheduler: {
    schedulable: boolean | null;
    unschedulable_reason: string | null;
    updated_at: string | null;
    updated_by: string | null;
  };
  bootstrap_validation: {
    status: string | null;
    bootstrap_version: string | null;
    runnerd_version: string | null;
    incus_version: string | null;
    storage_driver: string | null;
    storage_pool: string | null;
    smoke_test_machine_id: string | null;
    smoke_test_result: string | null;
    warm_pool_result: string | null;
    triggered_by: string | null;
  };
  incus_ui: {
    exposure: string | null;
    url: string | null;
    note: string | null;
  };
};

const state: HarnessIdentityState & {
  hostId: string | null;
} = {
  email: `e2e-v2-bootstrap-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  hostId: null,
};

async function cleanup() {
  if (state.hostId) {
    await db.delete(baremetalHosts).where(eq(baremetalHosts.id, state.hostId)).catch(() => undefined);
  }
  if (state.apiKeyId) {
    await db.delete(apiKeys).where(eq(apiKeys.id, state.apiKeyId)).catch(() => undefined);
  }
}

async function main() {
  console.log('=== JustAVPS V2 host bootstrap validation E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);

  await ensureApiHealthy(BASE_URL);
  await createAdminHarnessUser(state, 'E2E V2 Host Bootstrap Validation');

  const hostCreate = await apiRequest<{ host: HostView }>(state, '/admin/fleet/hosts', {
    method: 'POST',
    body: JSON.stringify({
      region: 'eu',
      host_class: `bootstrap-e2e-${Date.now()}`,
      generation: 'gen1',
      location: 'NBG1-DC3',
      name: `bootstrap-host-${Date.now()}`,
      vendor: 'manual',
      public_ipv4: '198.51.100.12',
    }),
  });
  state.hostId = hostCreate.data.host.id;
  console.log(`[host] created id=${state.hostId}`);

  await apiRequest<{ host: HostView }>(state, `/admin/fleet/hosts/${state.hostId}/register`, {
    method: 'POST',
    body: JSON.stringify({
      runner_base_url: 'http://127.0.0.1:4403',
      public_ipv4: '198.51.100.12',
      total_vcpu: 12,
      total_memory_gb: 64,
      total_disk_gb: 900,
      generation: 'gen1',
      status: 'bootstrapping',
    }),
  });

  const validated = await apiRequest<{ host: HostView }>(state, `/admin/fleet/hosts/${state.hostId}/validation-artifact`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'passed',
      bootstrap_version: 'bootstrap-baremetal-host.sh@v1',
      runnerd_version: '1.0.0',
      incus_version: '6.0',
      storage_driver: 'zfs',
      storage_pool: 'local',
      started_at: new Date(Date.now() - 60_000).toISOString(),
      completed_at: new Date().toISOString(),
      smoke_test_machine_id: 'smoke-test-machine-1',
      smoke_test_result: 'passed',
      warm_pool_result: 'passed',
      drift_status: 'in_policy',
      triggered_by: 'bootstrap-script',
      notes: ['runner registration succeeded', 'storage pool healthy'],
    }),
  });

  const configured = await apiRequest<{ host: HostView }>(state, `/admin/fleet/hosts/${state.hostId}/operator-settings`, {
    method: 'POST',
    body: JSON.stringify({
      incus_ui_exposure: 'operator_only',
      incus_ui_url: 'https://198.51.100.12:8443',
      incus_ui_note: 'vpn-only',
    }),
  });

  const listed = await apiRequest<{ hosts: HostView[] }>(state, '/admin/fleet/hosts');
  const host = listed.data.hosts.find((row) => row.id === state.hostId);
  if (!host) throw new Error('Expected host to appear in fleet listing');

  if (validated.data.host.status !== 'active') throw new Error(`Expected active host after validation, got ${validated.data.host.status}`);
  if (host.bootstrap_validation.runnerd_version !== '1.0.0') throw new Error(`Unexpected runnerd version ${host.bootstrap_validation.runnerd_version}`);
  if (host.bootstrap_validation.incus_version !== '6.0') throw new Error(`Unexpected incus version ${host.bootstrap_validation.incus_version}`);
  if (host.bootstrap_validation.storage_driver !== 'zfs') throw new Error(`Unexpected storage driver ${host.bootstrap_validation.storage_driver}`);
  if (host.bootstrap_validation.storage_pool !== 'local') throw new Error(`Unexpected storage pool ${host.bootstrap_validation.storage_pool}`);
  if (host.bootstrap_validation.smoke_test_result !== 'passed') throw new Error(`Unexpected smoke test result ${host.bootstrap_validation.smoke_test_result}`);
  if (host.bootstrap_validation.warm_pool_result !== 'passed') throw new Error(`Unexpected warm pool result ${host.bootstrap_validation.warm_pool_result}`);
  if (host.drift_status !== 'in_policy') throw new Error(`Unexpected drift status ${host.drift_status}`);
  if (host.scheduler.schedulable !== true) throw new Error(`Expected schedulable host, got ${JSON.stringify(host.scheduler)}`);
  if (configured.data.host.incus_ui.exposure !== 'operator_only') throw new Error(`Unexpected Incus UI exposure ${configured.data.host.incus_ui.exposure}`);
  if (configured.data.host.incus_ui.url !== 'https://198.51.100.12:8443') throw new Error(`Unexpected Incus UI URL ${configured.data.host.incus_ui.url}`);

  console.log('[host] bootstrap validation verified');
  console.log('=== JustAVPS V2 host bootstrap validation E2E passed ===');
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
