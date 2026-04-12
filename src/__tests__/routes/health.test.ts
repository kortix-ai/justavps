import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listControlPlaneServiceStatesMock = vi.fn();
const dbExecuteMock = vi.fn();
const dbSelectMock = vi.fn();
const dbSelectFromMock = vi.fn<() => Promise<Array<Record<string, unknown>>>>(() => Promise.resolve([]));
const resetDbConnectionMock = vi.fn();

vi.mock('@/server/lib/control-plane/runtime', () => ({
  ensureControlPlaneRuntimeStarted: vi.fn(),
}));

vi.mock('@/server/lib/control-plane/service-state', () => ({
  CONTROL_PLANE_SERVICE_STALE_AFTER_MS: 10 * 60 * 1000,
  CONTROL_PLANE_SERVICE_PROFILES: {
    provisioner: { critical: true, mode: 'periodic', description: 'p' },
    webhook_dispatcher: { critical: true, mode: 'periodic', description: 'w' },
    routing: { critical: true, mode: 'periodic', description: 'r' },
    watchdog: { critical: true, mode: 'periodic', description: 'wd' },
    fleet_auditor: { critical: true, mode: 'periodic', description: 'fa' },
    telemetry: { critical: true, mode: 'periodic', description: 't' },
    auth_cache: { critical: true, mode: 'periodic', description: 'ac' },
    allocator: { critical: false, mode: 'event_driven', description: 'alloc' },
  },
  listControlPlaneServiceStates: listControlPlaneServiceStatesMock,
  isControlPlaneServiceStale: (row: { leaseOwner?: string | null; leaseExpiresAt?: Date | null; lastCompletedAt?: Date | null }, now = Date.now()) => {
    if (row.leaseOwner && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now) return false;
    return !row.lastCompletedAt || now - row.lastCompletedAt.getTime() > 10 * 60 * 1000;
  },
}));

vi.mock('@/server/db', () => ({
  db: {
    execute: dbExecuteMock,
    select: dbSelectMock,
  },
  resetDbConnection: resetDbConnectionMock,
}));

describe('app health route', () => {
  const originalAuthSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dbSelectMock.mockReturnValue({ from: dbSelectFromMock });
    dbSelectFromMock.mockResolvedValue([]);
    resetDbConnectionMock.mockResolvedValue(undefined);
    process.env.AUTH_SECRET = originalAuthSecret;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns control-plane service summary in /api/health', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([
      {
        service: 'provisioner',
        scope: 'machine_create',
        leaseOwner: null,
        lastCompletedAt: new Date('2026-04-11T09:00:00.000Z'),
      },
      {
        service: 'routing',
        scope: 'repair',
        leaseOwner: 'routing:lease-1',
        lastCompletedAt: null,
      },
    ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: expect.stringMatching(/ok|warning|degraded/),
      service: 'justavps-api',
      database: { status: 'ok' },
      fleet_hosts: expect.objectContaining({ total_hosts: 0, active_schedulable_hosts: 0, pending_validation_hosts: 0, blocking_drift_hosts: 0 }),
      config_audit: { status: expect.stringMatching(/ok|warning|degraded/) },
      control_plane: {
        services: expect.arrayContaining([
          expect.objectContaining({ service: 'provisioner', scope: 'machine_create', lease_owner: null }),
          expect.objectContaining({ service: 'routing', scope: 'repair', lease_owner: 'routing:lease-1' }),
        ]),
      },
    });
  });

  it('returns warning from /api/health when hosts are pending validation without blocking drift', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([
      { id: 'host-1', name: 'bm-host-1', status: 'bootstrapping', metadata: {} },
    ]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      fleet_hosts: expect.objectContaining({ active_schedulable_hosts: 0, pending_validation_hosts: 1, quarantined_hosts: 0, blocking_drift_hosts: 0 }),
      config_audit: expect.objectContaining({ status: 'degraded' }),
    });
    expect(body.config_audit.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'fleet_no_schedulable_capacity', severity: 'error', message: 'No schedulable active hosts are available for new placements' }),
    ]));
  });

  it('returns warning from /api/health when hosts are quarantined without blocking drift', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([
      { id: 'host-1', name: 'bm-host-1', region: 'hel1', hostClass: 'general-small', generation: 'gen1', cellId: 'cell-1', status: 'active', maintenanceState: 'in_service', totalVcpu: 12, totalMemoryGb: 64, totalDiskGb: 900, usedVcpu: 4, usedMemoryGb: 12, usedDiskGb: 120, metadata: { scheduler: { schedulable: false, unschedulableReason: 'manual quarantine' }, bootstrap: { validation_artifact: { status: 'passed' } } } },
    ]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      fleet_hosts: expect.objectContaining({ active_schedulable_hosts: 0, quarantined_hosts: 1, blocking_drift_hosts: 0 }),
    });
    expect(body.config_audit.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'fleet_no_schedulable_capacity', severity: 'error', message: 'No schedulable active hosts are available for new placements' }),
      expect.objectContaining({ key: 'fleet_cell_no_schedulable_capacity', severity: 'error', message: '1 sellable cell(s) have zero schedulable active hosts' }),
      expect.objectContaining({ key: 'fleet_host_quarantined', severity: 'warning', message: '1 host(s) are quarantined from scheduling' }),
    ]));
  });

  it('surfaces blocking host drift in /api/health config audit', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([
      { id: 'host-1', name: 'bm-host-1', metadata: { bootstrap: { drift_status: 'blocking_drift' } } },
    ]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.config_audit).toMatchObject({ status: 'degraded' });
    expect(body.fleet_hosts).toMatchObject({ total_hosts: 1, active_schedulable_hosts: 0, pending_validation_hosts: 1, blocking_drift_hosts: 1 });
    expect(body.config_audit.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'fleet_host_blocking_drift', severity: 'error', message: '1 host(s) have blocking bootstrap drift' }),
      expect.objectContaining({ key: 'fleet_host_pending_validation', severity: 'warning', message: '1 host(s) are awaiting bootstrap validation' }),
    ]));
  });

  it('returns degraded from /api/health when the database is unavailable', async () => {
    dbExecuteMock.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(new Error('db down'));
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      database: { status: 'error' },
    });
    expect(body.config_audit.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'database_connectivity', severity: 'error', message: 'Database connectivity check failed' }),
    ]));
  });

  it('returns degraded from /api/health when the database probe reports a timeout', async () => {
    dbExecuteMock.mockRejectedValueOnce(new Error('database probe timed out after 5000ms')).mockRejectedValueOnce(new Error('database probe timed out after 5000ms'));
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      database: { status: 'error', error: expect.stringContaining('database probe timed out') },
      fleet_hosts: expect.objectContaining({ total_hosts: 0 }),
    });
    expect(body.config_audit.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'database_connectivity', severity: 'error', message: 'Database connectivity check failed' }),
    ]));
    expect(resetDbConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('recovers /api/health after resetting a stale database connection', async () => {
    dbExecuteMock.mockRejectedValueOnce(new Error('stale connection')).mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/health'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: expect.stringMatching(/ok|warning|degraded/),
      database: { status: 'ok', error: null },
    });
    expect(resetDbConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('returns degraded from /api/readyz when critical control-plane services are stale', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([
      {
        service: 'provisioner',
        scope: 'machine_create',
        leaseOwner: null,
        lastCompletedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/readyz'));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      database: { status: 'ok' },
      fleet_hosts: expect.objectContaining({ active_schedulable_hosts: 0, quarantined_hosts: 0, blocking_drift_hosts: 0 }),
      control_plane: { error: null, stale_services: expect.arrayContaining(['provisioner']) },
      config_audit: { error_count: 0 },
      blockers: { quarantined_hosts: 0, blocking_drift_hosts: 0, config_audit_errors: 0 },
    });
  });

  it('returns ready from /api/readyz when db and critical services are healthy', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([
      { service: 'provisioner', scope: 'machine_create', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'webhook_dispatcher', scope: 'webhook_deliver', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'routing', scope: 'repair', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'watchdog', scope: 'global', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'fleet_auditor', scope: 'baremetal', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'telemetry', scope: 'retention', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'auth_cache', scope: 'api_keys', leaseOwner: null, lastCompletedAt: new Date() },
    ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/readyz'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ready',
      database: { status: 'ok' },
      fleet_hosts: expect.objectContaining({ active_schedulable_hosts: 0, quarantined_hosts: 0, blocking_drift_hosts: 0 }),
      control_plane: { error: null, stale_services: [] },
      config_audit: { error_count: 0 },
      blockers: { quarantined_hosts: 0, blocking_drift_hosts: 0, config_audit_errors: 0 },
    });
  });

  it('treats a recently leased critical service as ready even before last_completed_at advances', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([
      { service: 'provisioner', scope: 'machine_create', leaseOwner: null, leaseExpiresAt: null, lastStartedAt: new Date(), lastCompletedAt: new Date() },
      { service: 'webhook_dispatcher', scope: 'webhook_deliver', leaseOwner: null, leaseExpiresAt: null, lastStartedAt: new Date(), lastCompletedAt: new Date() },
      { service: 'routing', scope: 'repair', leaseOwner: null, leaseExpiresAt: null, lastStartedAt: new Date(), lastCompletedAt: new Date() },
      { service: 'watchdog', scope: 'global', leaseOwner: null, leaseExpiresAt: null, lastStartedAt: new Date(), lastCompletedAt: new Date() },
      { service: 'fleet_auditor', scope: 'baremetal', leaseOwner: null, leaseExpiresAt: null, lastStartedAt: new Date(), lastCompletedAt: new Date() },
      { service: 'telemetry', scope: 'retention', leaseOwner: null, leaseExpiresAt: null, lastStartedAt: new Date(), lastCompletedAt: new Date() },
      { service: 'auth_cache', scope: 'api_keys', leaseOwner: 'auth-cache-lease', leaseExpiresAt: new Date(Date.now() + 60_000), lastStartedAt: new Date(), lastCompletedAt: new Date(Date.now() - 60 * 60 * 1000) },
    ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/readyz'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ready',
      fleet_hosts: expect.objectContaining({ active_schedulable_hosts: 0, quarantined_hosts: 0, blocking_drift_hosts: 0 }),
      control_plane: { error: null, stale_services: [] },
      config_audit: { error_count: 0 },
      blockers: { quarantined_hosts: 0, blocking_drift_hosts: 0, config_audit_errors: 0 },
    });
  });

  it('returns degraded from /api/readyz when hosts are quarantined without blocking drift', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([
      {
        id: 'host-1',
        name: 'bm-host-1',
        status: 'active',
        metadata: { scheduler: { schedulable: false, unschedulableReason: 'manual quarantine' }, bootstrap: { validation_artifact: { status: 'passed' } } },
      },
    ]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([
      { service: 'provisioner', scope: 'machine_create', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'webhook_dispatcher', scope: 'webhook_deliver', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'routing', scope: 'repair', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'watchdog', scope: 'global', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'fleet_auditor', scope: 'baremetal', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'telemetry', scope: 'retention', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'auth_cache', scope: 'api_keys', leaseOwner: null, lastCompletedAt: new Date() },
    ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/readyz'));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      fleet_hosts: expect.objectContaining({ total_hosts: 1, active_schedulable_hosts: 0, quarantined_hosts: 1, blocking_drift_hosts: 0 }),
      config_audit: { error_count: 1 },
      blockers: { quarantined_hosts: 1, blocking_drift_hosts: 0, config_audit_errors: 1 },
      control_plane: { error: null, stale_services: [] },
    });
  });

  it('returns degraded from /api/readyz when hosts have blocking drift', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([
      {
        id: 'host-1',
        name: 'bm-host-1',
        status: 'active',
        metadata: { bootstrap: { drift_status: 'blocking_drift', validation_artifact: { status: 'failed' } } },
      },
    ]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([
      { service: 'provisioner', scope: 'machine_create', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'webhook_dispatcher', scope: 'webhook_deliver', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'routing', scope: 'repair', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'watchdog', scope: 'global', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'fleet_auditor', scope: 'baremetal', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'telemetry', scope: 'retention', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'auth_cache', scope: 'api_keys', leaseOwner: null, lastCompletedAt: new Date() },
    ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/readyz'));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      fleet_hosts: expect.objectContaining({ total_hosts: 1, active_schedulable_hosts: 1, quarantined_hosts: 0, blocking_drift_hosts: 1 }),
      config_audit: { error_count: 1 },
      blockers: { quarantined_hosts: 0, blocking_drift_hosts: 1, config_audit_errors: 1 },
      control_plane: { error: null, stale_services: [] },
    });
  });

  it('returns degraded from /api/readyz when config audit has non-fleet errors', async () => {
    process.env.AUTH_SECRET = '';
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock.mockResolvedValueOnce([
      { service: 'provisioner', scope: 'machine_create', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'webhook_dispatcher', scope: 'webhook_deliver', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'routing', scope: 'repair', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'watchdog', scope: 'global', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'fleet_auditor', scope: 'baremetal', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'telemetry', scope: 'retention', leaseOwner: null, lastCompletedAt: new Date() },
      { service: 'auth_cache', scope: 'api_keys', leaseOwner: null, lastCompletedAt: new Date() },
    ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/readyz'));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      fleet_hosts: expect.objectContaining({ active_schedulable_hosts: 0, quarantined_hosts: 0, blocking_drift_hosts: 0 }),
      control_plane: { error: null, stale_services: [] },
      config_audit: { error_count: 1 },
      blockers: { quarantined_hosts: 0, blocking_drift_hosts: 0, config_audit_errors: 1 },
    });
  });

  it('returns degraded from /api/readyz when control-plane service listing times out', async () => {
    vi.useFakeTimers();
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock.mockImplementationOnce(() => new Promise(() => {}));

    const { app } = await import('@/server/app');
    const resPromise = app.request(new Request('http://localhost/api/readyz'));
    await vi.advanceTimersByTimeAsync(5_100);
    const res = await resPromise;

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'degraded',
      database: { status: 'ok' },
      control_plane: { error: null, stale_services: expect.arrayContaining(['provisioner']) },
    });
    expect(resetDbConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('recovers /api/readyz after resetting a stale control-plane service-state connection', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
    dbSelectFromMock.mockResolvedValueOnce([]);
    listControlPlaneServiceStatesMock
      .mockRejectedValueOnce(new Error('stale service-state connection'))
      .mockResolvedValueOnce([
        { service: 'provisioner', scope: 'machine_create', leaseOwner: null, lastCompletedAt: new Date() },
        { service: 'webhook_dispatcher', scope: 'webhook_deliver', leaseOwner: null, lastCompletedAt: new Date() },
        { service: 'routing', scope: 'repair', leaseOwner: null, lastCompletedAt: new Date() },
        { service: 'watchdog', scope: 'global', leaseOwner: null, lastCompletedAt: new Date() },
        { service: 'fleet_auditor', scope: 'baremetal', leaseOwner: null, lastCompletedAt: new Date() },
        { service: 'telemetry', scope: 'retention', leaseOwner: null, lastCompletedAt: new Date() },
        { service: 'auth_cache', scope: 'api_keys', leaseOwner: null, lastCompletedAt: new Date() },
      ]);

    const { app } = await import('@/server/app');
    const res = await app.request(new Request('http://localhost/api/readyz'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ready',
      database: { status: 'ok', error: null },
      control_plane: { error: null, stale_services: [] },
      blockers: { config_audit_errors: 0 },
    });
    expect(resetDbConnectionMock).toHaveBeenCalledTimes(1);
  });
});
