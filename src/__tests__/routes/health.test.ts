import { beforeEach, describe, expect, it, vi } from 'vitest';

const listControlPlaneServiceStatesMock = vi.fn();
const dbExecuteMock = vi.fn();

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
  },
}));

describe('app health route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
      status: 'ok',
      service: 'justavps-api',
      database: { status: 'ok' },
      config_audit: { status: expect.stringMatching(/ok|warning|degraded/) },
      control_plane: {
        services: expect.arrayContaining([
          expect.objectContaining({ service: 'provisioner', scope: 'machine_create', lease_owner: null }),
          expect.objectContaining({ service: 'routing', scope: 'repair', lease_owner: 'routing:lease-1' }),
        ]),
      },
    });
  });

  it('returns degraded from /api/readyz when critical control-plane services are stale', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
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
      control_plane: { stale_services: expect.arrayContaining(['provisioner']) },
    });
  });

  it('returns ready from /api/readyz when db and critical services are healthy', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
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
      control_plane: { stale_services: [] },
    });
  });

  it('treats a recently leased critical service as ready even before last_completed_at advances', async () => {
    dbExecuteMock.mockResolvedValueOnce([]);
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
      control_plane: { stale_services: [] },
    });
  });
});
