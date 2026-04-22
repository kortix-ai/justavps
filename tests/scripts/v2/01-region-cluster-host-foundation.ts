#!/usr/bin/env npx tsx

import { eq } from 'drizzle-orm';

import { db } from '../../../src/server/db';
import { apiKeys, baremetalHosts } from '../../../src/server/db/schema';
import { apiRequest, createAdminHarnessUser, DEFAULT_BASE_URL, ensureApiHealthy, HarnessIdentityState } from './lib/harness';

const BASE_URL = DEFAULT_BASE_URL;

type CreatedHost = {
  id: string;
  cluster: {
    id: string;
    name: string;
    region: string;
    incus_cluster_name: string;
    incus_member_name: string;
  };
  status: string;
  last_heartbeat_at: string | null;
  scheduler: {
    schedulable: boolean | null;
    unschedulable_reason: string | null;
  };
  total_vcpu: number | null;
  total_memory_gb: number | null;
  total_disk_gb: number | null;
};

type ClusterView = {
  id: string;
  region: string;
  host_count: number;
  incus_cluster_name: string;
};

const state: HarnessIdentityState & {
  hostId: string | null;
} = {
  email: `e2e-v2-topology-${Date.now()}@test.justavps.local`,
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
  console.log('=== JustAVPS V2 region/host foundation E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);

  await ensureApiHealthy(BASE_URL);

  await createAdminHarnessUser(state, 'E2E V2 Topology Admin');

  const hostCreate = await apiRequest<{ host: CreatedHost }>(state, '/admin/fleet/hosts', {
    method: 'POST',
    body: JSON.stringify({
      region: 'eu',
      host_class: `starter-e2e-${Date.now()}`,
      generation: 'gen1',
      location: 'NBG1-DC3',
      name: `e2e-topology-host-${Date.now()}`,
      vendor: 'manual',
      public_ipv4: '198.51.100.10',
    }),
  });
  state.hostId = hostCreate.data.host.id;
  console.log(`[host] created id=${state.hostId}`);

  const bootstrap = await apiRequest<{ host: { id: string; runner_token: string } }>(state, `/admin/fleet/hosts/${state.hostId}/bootstrap-config`);
  if (!bootstrap.data.host.runner_token) throw new Error('Expected bootstrap config to include runner token');
  console.log('[host] bootstrap config verified');

  const register = await apiRequest<{ host: CreatedHost }>(state, `/admin/fleet/hosts/${state.hostId}/register`, {
    method: 'POST',
    body: JSON.stringify({
      runner_base_url: 'http://127.0.0.1:4401',
      public_ipv4: '198.51.100.10',
      total_vcpu: 32,
      total_memory_gb: 128,
      total_disk_gb: 2000,
      generation: 'gen1',
      status: 'bootstrapping',
      metadata: { bootstrap_source: 'e2e' },
    }),
  });

  if (register.data.host.status !== 'bootstrapping') {
    throw new Error(`Expected host to remain bootstrapping after register, got ${register.data.host.status}`);
  }
  console.log('[host] registration verified');

  const heartbeat = await apiRequest<{ host: CreatedHost }>(state, `/admin/fleet/hosts/${state.hostId}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify({
      incus_ok: true,
      zfs_ok: true,
      runner_ok: true,
      drift_status: 'in_policy',
      instance_count: 0,
      image_count: 2,
      alerts: [],
    }),
  });

  if (heartbeat.data.host.status !== 'active') {
    throw new Error(`Expected active host after healthy heartbeat, got ${heartbeat.data.host.status}`);
  }
  if (heartbeat.data.host.scheduler.schedulable !== true) {
    throw new Error(`Expected host to be schedulable after heartbeat, got ${JSON.stringify(heartbeat.data.host.scheduler)}`);
  }
  console.log('[host] heartbeat verified');

  const topology = await apiRequest<{ hosts: CreatedHost[]; clusters: ClusterView[] }>(state, '/admin/fleet/hosts');
  const listedHost = topology.data.hosts.find((host) => host.id === state.hostId);
  if (!listedHost) throw new Error('Expected host to appear in topology list');
  if (listedHost.scheduler.schedulable !== true) throw new Error('Expected listed host to be schedulable');
  if (!listedHost.last_heartbeat_at) throw new Error('Expected listed host to have last heartbeat timestamp');
  if (listedHost.cluster.region !== 'eu') throw new Error(`Expected host cluster to stay in eu, got ${listedHost.cluster.region}`);
  if (!listedHost.cluster.incus_cluster_name) throw new Error('Expected host cluster to include incus cluster name');
  const cluster = topology.data.clusters.find((item) => item.id === listedHost.cluster.id);
  if (!cluster) throw new Error('Expected derived cluster to appear in topology list');
  if (cluster.host_count < 1) throw new Error(`Expected cluster host count >= 1, got ${cluster.host_count}`);
  console.log(`[topology] hosts=${topology.data.hosts.length}`);
  console.log(`[cluster] ${listedHost.cluster.id} members=${cluster.host_count}`);

  console.log('=== V2 region/host foundation E2E passed ===');
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
