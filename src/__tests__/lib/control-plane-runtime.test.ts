import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureProvisionerServiceWorkerMock = vi.fn();
const runProvisionerServicePassMock = vi.fn(async () => ({ acquired: true }));
const runWebhookDispatcherServicePassMock = vi.fn(async () => ({ acquired: true }));
const runAuthCacheServicePassMock = vi.fn(async () => ({ acquired: true }));
const runRoutingRepairServicePassMock = vi.fn(async () => ({ acquired: true }));
const runTelemetryRetentionServicePassMock = vi.fn(async () => ({ acquired: true }));
const runWatchdogServicePassMock = vi.fn(async () => ({ acquired: true }));
const runFleetAuditorServicePassMock = vi.fn(async () => ({ acquired: true }));
const dbExecuteMock = vi.fn(async () => []);
const resetDbConnectionMock = vi.fn(async () => undefined);

vi.mock('@/server/lib/control-plane/provisioner', () => ({
  ensureProvisionerServiceWorker: ensureProvisionerServiceWorkerMock,
  runProvisionerServicePass: runProvisionerServicePassMock,
}));

vi.mock('@/server/lib/control-plane/webhook-dispatcher', () => ({
  runWebhookDispatcherServicePass: runWebhookDispatcherServicePassMock,
}));

vi.mock('@/server/lib/control-plane/auth-cache', () => ({
  runAuthCacheServicePass: runAuthCacheServicePassMock,
}));

vi.mock('@/server/lib/control-plane/routing', () => ({
  runRoutingRepairServicePass: runRoutingRepairServicePassMock,
}));

vi.mock('@/server/lib/control-plane/telemetry', () => ({
  runTelemetryRetentionServicePass: runTelemetryRetentionServicePassMock,
}));

vi.mock('@/server/lib/control-plane/watchdog', () => ({
  runWatchdogServicePass: runWatchdogServicePassMock,
}));

vi.mock('@/server/lib/control-plane/fleet-auditor', () => ({
  runFleetAuditorServicePass: runFleetAuditorServicePassMock,
}));

vi.mock('@/server/db', () => ({
  db: {
    execute: dbExecuteMock,
  },
  resetDbConnection: resetDbConnectionMock,
}));

describe('control-plane runtime', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    dbExecuteMock.mockResolvedValue([]);
    resetDbConnectionMock.mockResolvedValue(undefined);
    delete process.env.CONTROL_PLANE_RUNTIME_DISABLED;
    delete process.env.VITEST;
    Object.assign(process.env, { NODE_ENV: 'development' });
  });

  afterEach(async () => {
    const mod = await import('@/server/lib/control-plane/runtime');
    mod.resetControlPlaneRuntimeForTests();
    vi.useRealTimers();
    delete process.env.CONTROL_PLANE_RUNTIME_DISABLED;
    process.env.VITEST = 'true';
  });

  it('starts background loops only once', async () => {
    const mod = await import('@/server/lib/control-plane/runtime');
    mod.ensureControlPlaneRuntimeStarted();
    mod.ensureControlPlaneRuntimeStarted();
    await vi.advanceTimersByTimeAsync(0);

    expect(ensureProvisionerServiceWorkerMock).toHaveBeenCalledTimes(1);
    expect(runProvisionerServicePassMock).toHaveBeenCalledTimes(1);
    expect(runWebhookDispatcherServicePassMock).toHaveBeenCalledTimes(1);
    expect(runAuthCacheServicePassMock).toHaveBeenCalledTimes(1);
    expect(runAuthCacheServicePassMock).toHaveBeenCalledWith({ leaseMs: 120_000, limit: 500 });
    expect(runRoutingRepairServicePassMock).toHaveBeenCalledTimes(1);
    expect(runTelemetryRetentionServicePassMock).toHaveBeenCalledTimes(1);
    expect(runWatchdogServicePassMock).toHaveBeenCalledTimes(1);
    expect(runFleetAuditorServicePassMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runProvisionerServicePassMock).toHaveBeenCalled();
    expect(runWebhookDispatcherServicePassMock).toHaveBeenCalled();
    expect(runAuthCacheServicePassMock).toHaveBeenCalledTimes(2);
    expect(runAuthCacheServicePassMock.mock.calls).toEqual([
      [{ leaseMs: 120_000, limit: 500 }],
      [{ leaseMs: 120_000, limit: 500 }],
    ]);
    expect(runRoutingRepairServicePassMock).toHaveBeenCalled();
    expect(runTelemetryRetentionServicePassMock).toHaveBeenCalledTimes(2);
  });

  it('does not start when runtime is disabled', async () => {
    process.env.CONTROL_PLANE_RUNTIME_DISABLED = 'true';
    const mod = await import('@/server/lib/control-plane/runtime');
    mod.ensureControlPlaneRuntimeStarted();

    expect(ensureProvisionerServiceWorkerMock).not.toHaveBeenCalled();
    expect(runProvisionerServicePassMock).not.toHaveBeenCalled();
  });

  it('skips loop passes while the database probe is unavailable', async () => {
    dbExecuteMock.mockRejectedValue(new Error('db unavailable'));

    const mod = await import('@/server/lib/control-plane/runtime');
    mod.ensureControlPlaneRuntimeStarted();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runProvisionerServicePassMock).not.toHaveBeenCalled();
    expect(runWebhookDispatcherServicePassMock).not.toHaveBeenCalled();
    expect(resetDbConnectionMock).toHaveBeenCalled();
  });
});
