import { ensureProvisionerServiceWorker, runProvisionerServicePass } from './provisioner';
import { runRoutingRepairServicePass } from './routing';
import { runTelemetryRetentionServicePass } from './telemetry';
import { runWatchdogServicePass } from './watchdog';
import { runFleetAuditorServicePass } from './fleet-auditor';
import { runWebhookDispatcherServicePass } from './webhook-dispatcher';
import { runAuthCacheServicePass } from './auth-cache';
import { db, resetDbConnection } from '@/server/db';

declare global {
  var __justavpsControlPlaneRuntimeStarted: boolean | undefined;
  var __justavpsControlPlaneRuntimeTimers: NodeJS.Timeout[] | undefined;
  var __justavpsControlPlaneRuntimeDbUnavailableLoggedAt: number | undefined;
}

const CONTROL_PLANE_DB_PROBE_TIMEOUT_MS = 5_000;

function isRuntimeDisabled() {
  return process.env.NODE_ENV === 'test'
    || process.env.VITEST === 'true'
    || process.env.CONTROL_PLANE_RUNTIME_DISABLED === 'true';
}

function registerLoop(intervalMs: number, task: () => Promise<void>) {
  void runLoopTask(task).catch((error) => {
    console.error('[CONTROL-PLANE-RUNTIME] initial loop error:', error);
  });

  const timer = setInterval(() => {
    void runLoopTask(task).catch((error) => {
      console.error('[CONTROL-PLANE-RUNTIME] loop error:', error);
    });
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  globalThis.__justavpsControlPlaneRuntimeTimers = [
    ...(globalThis.__justavpsControlPlaneRuntimeTimers ?? []),
    timer,
  ];
}

async function probeRuntimeDatabase() {
  const attempt = async () => Promise.race([
    db.execute('select 1'),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`control-plane db probe timed out after ${CONTROL_PLANE_DB_PROBE_TIMEOUT_MS}ms`)), CONTROL_PLANE_DB_PROBE_TIMEOUT_MS)),
  ]);

  try {
    await attempt();
    return true;
  } catch {
    await resetDbConnection().catch(() => {});
    try {
      await attempt();
      return true;
    } catch (retryError) {
      const now = Date.now();
      if (!globalThis.__justavpsControlPlaneRuntimeDbUnavailableLoggedAt || now - globalThis.__justavpsControlPlaneRuntimeDbUnavailableLoggedAt > 60_000) {
        globalThis.__justavpsControlPlaneRuntimeDbUnavailableLoggedAt = now;
        console.error('[CONTROL-PLANE-RUNTIME] database unavailable, skipping loop pass:', retryError);
      }
      return false;
    }
  }
}

async function runLoopTask(task: () => Promise<void>) {
  const dbOk = await probeRuntimeDatabase();
  if (!dbOk) return;
  await task();
}

export function ensureControlPlaneRuntimeStarted() {
  if (isRuntimeDisabled()) return;
  if (globalThis.__justavpsControlPlaneRuntimeStarted) return;

  globalThis.__justavpsControlPlaneRuntimeStarted = true;
  ensureProvisionerServiceWorker();

  registerLoop(2_000, async () => {
    await runProvisionerServicePass({ limit: 10, leaseMs: 20_000 });
  });

  registerLoop(2_000, async () => {
    await runWebhookDispatcherServicePass({ limit: 50, leaseMs: 20_000 });
  });

  registerLoop(5_000, async () => {
    await runRoutingRepairServicePass(25, { leaseMs: 20_000 });
  });

  registerLoop(60_000, async () => {
    await runWatchdogServicePass({ leaseMs: 45_000 });
  });

  registerLoop(5 * 60_000, async () => {
    await runTelemetryRetentionServicePass({ leaseMs: 45_000, limit: 1_000 });
  });

  registerLoop(5 * 60_000, async () => {
    await runAuthCacheServicePass({ leaseMs: 120_000, limit: 500 });
  });

  registerLoop(60_000, async () => {
    await runFleetAuditorServicePass({ leaseMs: 45_000, maxHosts: 10 });
  });
}

export function resetControlPlaneRuntimeForTests() {
  for (const timer of globalThis.__justavpsControlPlaneRuntimeTimers ?? []) {
    clearInterval(timer);
  }
  globalThis.__justavpsControlPlaneRuntimeTimers = [];
  globalThis.__justavpsControlPlaneRuntimeStarted = false;
  globalThis.__justavpsControlPlaneRuntimeDbUnavailableLoggedAt = undefined;
}
