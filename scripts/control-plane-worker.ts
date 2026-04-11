import { config as dotenvConfig } from 'dotenv';

dotenvConfig();
dotenvConfig({ path: '.env.local', override: true });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the control-plane worker');
}

process.env.CONTROL_PLANE_RUNTIME_DISABLED = 'false';

async function logServiceState(label: string) {
  const { listControlPlaneServiceStates } = await import('@/server/lib/control-plane/service-state');
  const rows = await listControlPlaneServiceStates();
  console.log(`[control-plane-worker] ${label} services=${rows.length}`);
  for (const row of rows) {
    console.log(`[control-plane-worker] ${row.service}:${row.scope} lease=${row.leaseOwner ?? 'idle'} lastCompleted=${row.lastCompletedAt?.toISOString() ?? 'never'}`);
  }
}

async function main() {
  const { ensureControlPlaneRuntimeStarted } = await import('@/server/lib/control-plane/runtime');
  ensureControlPlaneRuntimeStarted();
  await logServiceState('started');

  const keepAlive = setInterval(() => {
    void logServiceState('heartbeat').catch((error) => {
      console.error('[control-plane-worker] state log failed:', error);
    });
  }, 60_000);

  const shutdown = (signal: string) => {
    clearInterval(keepAlive);
    console.log(`[control-plane-worker] received ${signal}, exiting`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((error) => {
  console.error('[control-plane-worker] failed to start:', error);
  process.exit(1);
});
