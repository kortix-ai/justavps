import dotenv from 'dotenv';

dotenv.config({ path: '../../.env', quiet: true });
dotenv.config({ path: '../../.env.local', override: true, quiet: true });
dotenv.config({ quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const { serve } = await import('@hono/node-server');
const { createApp, runDueAutoBackups } = await import('./app.js');
const { loadConfig, normalizeClusterConfig } = await import('./config.js');
const { getPrisma } = await import('./db/client.js');
const { startLifecycleSweeper } = await import('./lifecycle.js');
const { startNodeProvisioningWorker } = await import('./services/nodeProvisioning.js');
const { startEconomicsWorkers } = await import('./workers/index.js');
const { startManagedDaemonEnsurer } = await import('./services/managedDaemon.js');
const { IncusClient } = await import('./incus/client.js');
const { registerMachinePtyWebSocket } = await import('./pty-websocket.js');

const config = loadConfig();

// Hydrate dynamically-registered clusters from DB. These were added via
// POST /admin/clusters at runtime in a previous boot. Merged with env
// clusters; DB takes precedence on id collision (operator's latest edit
// wins over the static env JSON).
if (config.databaseConfigured) {
  try {
    const dbClusters = await getPrisma().incusCluster.findMany();
    for (const row of dbClusters) {
      const raw = row.config as Record<string, unknown> | null;
      if (!raw || !raw.endpoint) continue;
      try {
        const normalized = normalizeClusterConfig({ ...raw, id: row.id });
        const idx = config.clusters.findIndex((c) => c.id === row.id);
        if (idx >= 0) config.clusters[idx] = normalized;
        else config.clusters.push(normalized);
      } catch (e) {
        console.warn(`[v2-api] could not hydrate cluster ${row.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } catch (e) {
    console.warn('[v2-api] cluster hydration skipped:', e instanceof Error ? e.message : e);
  }
}

const app = createApp(config);

const server = serve({ fetch: app.fetch, port: config.port });
registerMachinePtyWebSocket(server, config);

// Lifecycle sweeper runs in the same process — it's idempotent and cheap, so
// no need for a separate worker. Disabled by default; opt in with
// V2_LIFECYCLE_SWEEPER=on.
startLifecycleSweeper(config, (cluster) => new IncusClient(cluster));

// Node-provisioning worker — drives pending NodeProvisioningRun rows. Off
// by default; opt in with V2_NODE_PROVISIONING_WORKER=on. Operators can
// also kick a run manually via POST /admin/nodes/runs/:id/drive.
startNodeProvisioningWorker(config);

// Economics workers — utilization snapshot, cost-tick, autoscale proposer.
// Each is opt-in via env (V2_SNAPSHOT_WORKER=on / V2_COST_TICK_WORKER=on /
// V2_AUTOSCALE_WORKER=on). Off by default until verified against a real DB.
startEconomicsWorkers(config);
startManagedDaemonEnsurer({
  config,
  findCluster: (id) => config.clusters.find((cluster) => cluster.id === id) ?? null,
  clientFor: (cluster) => new IncusClient(cluster),
});

if (process.env.V2_AUTO_BACKUP_WORKER === 'on') {
  const tickMs = Number(process.env.V2_AUTO_BACKUP_TICK_MS || 15 * 60_000);
  setInterval(() => {
    runDueAutoBackups(config)
      .then((result) => {
        if (result.created.length || result.pruned.length || result.errors.length) {
          console.log(`[v2-api] auto-backup sweep: scanned=${result.scanned} created=${result.created.length} pruned=${result.pruned.reduce((sum, item) => sum + item.backup_names.length, 0)} errors=${result.errors.length}`);
        }
      })
      .catch((error) => console.error('[v2-api] auto-backup sweep failed:', error instanceof Error ? error.stack : error));
  }, tickMs);
  console.log(`[v2-api] auto-backup worker started (tick=${tickMs}ms, policy=daily/7d)`);
}

console.log(`[v2-api] listening on :${config.port} with ${config.clusters.length} Incus cluster(s)`);
