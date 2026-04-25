#!/usr/bin/env npx tsx

import { eq } from 'drizzle-orm';

import { db } from '../../../src/server/db';
import { apiKeys, machines } from '../../../src/server/db/schema';
import { apiRequest, createAdminHarnessUser, DEFAULT_BASE_URL, ensureApiHealthy, getTargetHost, HarnessIdentityState, reconcileLocalHostCapacity, waitFor } from './lib/harness';
import { checkpointFilePath, clearCheckpoint, loadCheckpoint, saveCheckpoint, shouldKeepE2EState } from './lib/checkpoints';

const BASE_URL = DEFAULT_BASE_URL;
const CHECKPOINT_SUITE = 'e2e-v2-external-proxy';

type MachineView = {
  id: string;
  slug: string;
  status: string;
  ready_at: string | null;
  health: { last_heartbeat_at: string | null } | null;
  connectivity: {
    urls: { proxy: string; terminal: string; port_template: string };
  };
};

const state: HarnessIdentityState & {
  machineId: string | null;
  phase: 'init' | 'user_ready' | 'machine_created' | 'machine_ready' | 'done';
} = {
  email: `e2e-v2-proxy-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
  machineId: null,
  phase: 'init',
};

async function requestText(url: string, headers?: Record<string, string>, timeoutMs = 30_000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.text();
  return { status: res.status, body };
}

async function runControlPlane(stateInput: HarnessIdentityState, services: Array<'routing' | 'auth_cache' | 'provisioner'>) {
  return apiRequest<{
    provisioner: { acquired: boolean };
    auth_cache: { acquired: boolean; synced: number };
    routing_repair: { acquired: boolean; repaired: number };
  }>(stateInput, '/admin/fleet/control-plane/run', {
    method: 'POST',
    body: JSON.stringify({ services }),
  });
}

async function cleanup() {
  if (shouldKeepE2EState()) return;
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
  console.log('=== JustAVPS V2 external proxy + daemon E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);

  Object.assign(state, await loadCheckpoint(CHECKPOINT_SUITE, state));
  if (state.phase !== 'init') {
    console.log(`[checkpoint] resuming from phase=${state.phase}`);
  }

  await ensureApiHealthy(BASE_URL);
  await createAdminHarnessUser(state, 'E2E V2 External Proxy');
  if (state.phase === 'init') {
    state.phase = 'user_ready';
    await saveCheckpoint(CHECKPOINT_SUITE, state);
  }

  const host = await getTargetHost();
  await reconcileLocalHostCapacity(host.id);

  if (!state.machineId) {
    const create = await apiRequest<MachineView>(state, '/machines', {
      method: 'POST',
      body: JSON.stringify({
        region: host.region,
        host_id: host.id,
        plan: 'custom',
        billing_mode: 'flat_monthly',
        billing_interval: 'monthly',
        vcpu: 1,
        ram_gb: 1,
        disk_gb: 10,
        name: `e2e-proxy-${Date.now()}`,
        enable_backups: false,
      }),
    });
    state.machineId = create.data.id;
    state.phase = 'machine_created';
    await saveCheckpoint(CHECKPOINT_SUITE, state);
    console.log(`[machine] created id=${state.machineId}`);
  } else {
    console.log(`[machine] reusing id=${state.machineId}`);
  }

  const machine = await waitFor(
    'machine ready',
    async () => {
      await runControlPlane(state, ['provisioner', 'routing', 'auth_cache']);
      return apiRequest<MachineView>(state, `/machines/${state.machineId}`);
    },
    (res) => res.data.status === 'ready' && Boolean(res.data.ready_at) && Boolean(res.data.health?.last_heartbeat_at),
    15 * 60_000,
    10_000,
  );
  state.phase = 'machine_ready';
  await saveCheckpoint(CHECKPOINT_SUITE, state);

  const proxyHeaders = {
    Authorization: `Bearer ${state.apiKey}`,
    Accept: 'text/html',
  };

  const proxyRoot = await waitFor(
    'external proxy root',
    async () => {
      await runControlPlane(state, ['routing', 'auth_cache']);
      return requestText(machine.data.connectivity.urls.proxy, proxyHeaders, 30_000);
    },
    (res) => res.status === 200 && /html|code-server|justavps/i.test(res.body),
    15 * 60_000,
    10_000,
  );
  console.log(`[proxy] root verified status=${proxyRoot.status}`);

  const terminal = await waitFor(
    'external proxy terminal',
    async () => {
      await runControlPlane(state, ['routing', 'auth_cache']);
      return requestText(machine.data.connectivity.urls.terminal, proxyHeaders, 30_000);
    },
    (res) => res.status === 200 && /html|terminal|xterm/i.test(res.body),
    15 * 60_000,
    10_000,
  );
  console.log(`[proxy] terminal verified status=${terminal.status}`);

  const machineHeartbeat = await apiRequest<MachineView>(state, `/machines/${state.machineId}`);
  if (!machineHeartbeat.data.health?.last_heartbeat_at) {
    throw new Error('Expected machine heartbeat to prove daemon callback path is live');
  }
  console.log(`[daemon] heartbeat verified at ${machineHeartbeat.data.health.last_heartbeat_at}`);

  console.log('=== JustAVPS V2 external proxy + daemon E2E passed ===');
  state.phase = 'done';
  await saveCheckpoint(CHECKPOINT_SUITE, state);
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
    if (shouldKeepE2EState()) {
      console.log(`[checkpoint] preserved at ${checkpointFilePath(CHECKPOINT_SUITE)} (E2E_KEEP_STATE=true)`);
    } else {
      await cleanup();
      await clearCheckpoint(CHECKPOINT_SUITE);
    }
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup();
    process.exit(1);
  });
