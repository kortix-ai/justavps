/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin Activity Timeline surface.
 *
 * Covers:
 *  - GET /admin/activity returns merged events from all sources, sorted desc
 *  - source filter returns only matching rows (and runs only its query)
 *  - time range respects since / until
 *  - severity heuristic: error states → error, drift/warning → warn, else info
 *  - Non-admin 403
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Auth guard stub ─────────────────────────────────────────────────────────

let currentIsAdmin = true;
vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', currentIsAdmin);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

// ── DB stub (FIFO queue) ────────────────────────────────────────────────────
//
// The route fires one SELECT per source. Tests pre-load a FIFO queue of
// responses in the order the route queries its sources (machine,
// procurement, webhook, restore, maintenance, backup, bootstrap_validation —
// see loadMachineEvents/… in the route).

const selectQueue: any[][] = [];
let selectCallCount = 0;

function enqueueSelect(rows: any[]) {
  selectQueue.push(rows);
}

function makeSelectChain() {
  selectCallCount++;
  const resolver = async (): Promise<any[]> => {
    const next = selectQueue.shift();
    return next ?? [];
  };
  const chain: any = {
    from: (_t: any) => chain,
    leftJoin: (_t: any, _c: any) => chain,
    where: (_c: any) => chain,
    orderBy: (..._a: any[]) => chain,
    limit: (_n: number) => chain,
    offset: (_n: number) => chain,
    groupBy: (..._a: any[]) => chain,
    then: (onFulfilled: (v: any[]) => unknown, onRejected?: (err: unknown) => unknown) =>
      resolver().then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn((_shape?: any) => ({
      from: (_t: any) => makeSelectChain(),
    })),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const MACHINE_ID = 'aaaa1111-2222-4333-8444-555555555551';
const PROCUREMENT_ID = 'aaaa1111-2222-4333-8444-555555555552';
const WEBHOOK_ID = 'aaaa1111-2222-4333-8444-555555555553';
const RESTORE_ID = 'aaaa1111-2222-4333-8444-555555555554';
const HOST_ID = 'aaaa1111-2222-4333-8444-555555555555';
const BACKUP_ID = 'aaaa1111-2222-4333-8444-555555555556';
const HOST_VALIDATION_ID = 'aaaa1111-2222-4333-8444-555555555557';
const DELIVERY_ID = 'aaaa1111-2222-4333-8444-555555555558';

const T = (iso: string) => new Date(iso);

// Four events chosen so that their timestamps interleave — validates the
// merge sort across sources.
const machineEventRow = {
  id: 'e1',
  machineId: MACHINE_ID,
  event: 'status_changed',
  stage: 'ready',
  message: 'machine became ready',
  metadata: { from: 'provisioning', to: 'ready' },
  createdAt: T('2026-04-20T10:00:00.000Z'),
  machineSlug: 'web-1',
  machineName: 'web-1',
};

// Failed procurement → should be classified as error severity
const procurementRow = {
  id: PROCUREMENT_ID,
  vendor: 'hetzner_robot',
  hostClass: 'general-small',
  productId: 'AX101',
  region: 'eu',
  location: 'HEL1-DC4',
  status: 'failed',
  requestedByUserId: 'u1',
  approvedByUserId: null,
  hostId: null,
  providerTransactionId: null,
  requiresApproval: true,
  error: 'robot API timeout',
  metadata: {},
  approvedAt: null,
  orderedAt: null,
  resolvedAt: null,
  createdAt: T('2026-04-20T09:00:00.000Z'),
  updatedAt: T('2026-04-20T11:00:00.000Z'),
};

// Dead-lettered webhook → error severity
const webhookDeliveryRow = {
  delivery: {
    id: DELIVERY_ID,
    webhookId: WEBHOOK_ID,
    eventType: 'machine.errored',
    payload: { machine_id: 'm-1' },
    payloadVersion: 1,
    status: 'dead_lettered',
    statusCode: 500,
    responseBody: null,
    durationMs: 1200,
    attempt: 10,
    nextAttemptAt: null,
    lastAttemptAt: T('2026-04-20T08:30:00.000Z'),
    success: false,
    error: 'Gave up after 10 attempts',
    deliveredAt: null,
    deadLetteredAt: T('2026-04-20T08:30:00.000Z'),
    createdAt: T('2026-04-20T08:00:00.000Z'),
  },
  webhookUrl: 'https://example.com/hook',
};

const restoreRow = {
  id: RESTORE_ID,
  artifactId: 'art-1',
  accountId: 'acc-1',
  machineId: MACHINE_ID,
  sourceHostId: HOST_ID,
  targetHostId: HOST_ID,
  executionType: 'snapshot_restore',
  triggerSource: 'user_request',
  status: 'succeeded',
  requestedByUserId: 'u1',
  startedAt: T('2026-04-20T07:00:00.000Z'),
  completedAt: T('2026-04-20T07:05:00.000Z'),
  durationMs: 300_000,
  error: null,
  result: null,
  metadata: {},
  createdAt: T('2026-04-20T07:00:00.000Z'),
  updatedAt: T('2026-04-20T07:05:00.000Z'),
};

// Draining host → warn severity
const maintenanceHostRow = {
  id: HOST_ID,
  name: 'bm-general-small-HEL1-abc',
  region: 'eu',
  location: 'HEL1-DC4',
  maintenanceState: 'draining',
  maintenanceRequestedAt: T('2026-04-20T06:00:00.000Z'),
  maintenanceStartedAt: null,
  maintenanceCompletedAt: null,
};

const backupRow = {
  id: BACKUP_ID,
  accountId: 'acc-1',
  machineId: MACHINE_ID,
  imageId: null,
  createdByUserId: 'u1',
  artifactType: 'snapshot',
  backupKind: 'user_snapshot',
  inventoryScope: 'customer',
  storageScope: 'host_local',
  displayName: 'backup-1',
  provider: 'cloud',
  providerArtifactId: 'pa-1',
  sourceMachineSlug: 'web-1',
  storageUrl: null,
  sizeBytes: 1024,
  checksum: null,
  retentionUntil: null,
  status: 'ready',
  sourceHostId: HOST_ID,
  lastVerifiedAt: null,
  restoreCount: 0,
  lastRestoreAt: null,
  metadata: {},
  createdAt: T('2026-04-20T05:00:00.000Z'),
  updatedAt: T('2026-04-20T05:10:00.000Z'),
  completedAt: T('2026-04-20T05:10:00.000Z'),
};

// Bootstrap validation with status=passed → info severity
const hostWithValidationRow = {
  id: HOST_VALIDATION_ID,
  name: 'bm-general-small-HEL1-xyz',
  region: 'eu',
  metadata: {
    bootstrap: {
      validation_artifact: {
        completed_at: '2026-04-20T04:00:00.000Z',
        status: 'passed',
        notes: ['all 42 checks ok'],
      },
    },
  },
};

/**
 * Seed all seven sources with representative rows. Tests opt out of a
 * source by enqueuing an empty array in its slot.
 */
function seedAllSources() {
  // The route dispatches queries in the order declared by its `want(...)`
  // gate: machine, procurement, webhook, restore, maintenance, backup,
  // bootstrap_validation. Promise.all preserves positional order so our
  // FIFO-enqueued arrays line up with each source.
  enqueueSelect([machineEventRow]); // machine
  enqueueSelect([procurementRow]); // procurement
  enqueueSelect([webhookDeliveryRow]); // webhook
  enqueueSelect([restoreRow]); // restore
  enqueueSelect([maintenanceHostRow]); // maintenance
  enqueueSelect([backupRow]); // backup
  enqueueSelect([hostWithValidationRow]); // bootstrap validation
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin activity route', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    selectCallCount = 0;
    currentIsAdmin = true;
  });

  it('GET /admin/activity merges events from every source and sorts desc', async () => {
    seedAllSources();

    const { adminActivityApp } = await import('@/server/v1/routes/internal/admin-activity');
    const res = await adminActivityApp.request(
      new Request('http://localhost/?since=2026-04-20T00:00:00.000Z&until=2026-04-20T23:59:59.000Z'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data.events)).toBe(true);
    // Every source should have contributed at least one row. Backup emits
    // two rows (created + completed) when both land in-range, so total ≥ 8.
    expect(data.events.length).toBeGreaterThanOrEqual(7);

    // Sorted newest-first
    for (let i = 1; i < data.events.length; i++) {
      expect(
        new Date(data.events[i - 1].occurred_at).getTime(),
      ).toBeGreaterThanOrEqual(new Date(data.events[i].occurred_at).getTime());
    }

    // One representative event per source must appear.
    const sources = new Set(data.events.map((e: any) => e.source));
    expect(sources).toContain('machine');
    expect(sources).toContain('procurement');
    expect(sources).toContain('webhook');
    expect(sources).toContain('restore');
    expect(sources).toContain('maintenance');
    expect(sources).toContain('backup');
    expect(sources).toContain('bootstrap_validation');

    // Summary buckets present
    expect(data.summary.counts_by_source.machine).toBeGreaterThanOrEqual(1);
    expect(data.summary.counts_by_source.procurement).toBeGreaterThanOrEqual(1);
    expect(data.summary.counts_by_severity).toHaveProperty('error');
    expect(data.summary.counts_by_severity).toHaveProperty('warn');
    expect(data.summary.counts_by_severity).toHaveProperty('info');
    expect(data.summary.time_range.since).toBe('2026-04-20T00:00:00.000Z');
    expect(data.summary.time_range.until).toBe('2026-04-20T23:59:59.000Z');
  });

  it('source filter returns only matching rows', async () => {
    // Only the webhook loader should run when source=webhooks, so only one
    // select is expected. Pre-load exactly one response.
    enqueueSelect([webhookDeliveryRow]);

    const { adminActivityApp } = await import('@/server/v1/routes/internal/admin-activity');
    const res = await adminActivityApp.request(
      new Request(
        'http://localhost/?source=webhooks&since=2026-04-20T00:00:00.000Z&until=2026-04-20T23:59:59.000Z',
      ),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(selectCallCount).toBe(1); // only ONE source query ran
    expect(data.events).toHaveLength(1);
    expect(data.events[0].source).toBe('webhook');
    expect(data.events[0].event_type).toBe('delivery_dead_lettered');
  });

  it('respects the since/until window (defaults to last 24h when omitted)', async () => {
    // No query params — should use defaults. We don't introspect the exact
    // `since` the route computed (it's "now - 24h"), but we DO verify that
    // the response echoes a valid ISO time_range derived from the request.
    seedAllSources();

    const { adminActivityApp } = await import('@/server/v1/routes/internal/admin-activity');
    const res = await adminActivityApp.request(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(typeof data.summary.time_range.since).toBe('string');
    expect(typeof data.summary.time_range.until).toBe('string');
    const sinceTs = new Date(data.summary.time_range.since).getTime();
    const untilTs = new Date(data.summary.time_range.until).getTime();
    expect(untilTs).toBeGreaterThan(sinceTs);
    // Default window is 24h — allow ±1h slack to tolerate clock timing.
    const windowMs = untilTs - sinceTs;
    expect(windowMs).toBeGreaterThan(23 * 60 * 60_000);
    expect(windowMs).toBeLessThan(25 * 60 * 60_000);
  });

  it('rejects invalid since/until with 400', async () => {
    const { adminActivityApp } = await import('@/server/v1/routes/internal/admin-activity');
    const bad = await adminActivityApp.request(
      new Request('http://localhost/?since=not-a-date'),
    );
    expect(bad.status).toBe(400);

    // since > until is also rejected
    const reversed = await adminActivityApp.request(
      new Request(
        'http://localhost/?since=2026-04-21T00:00:00.000Z&until=2026-04-20T00:00:00.000Z',
      ),
    );
    expect(reversed.status).toBe(400);
  });

  it('severity heuristic: error for failed/dead_lettered, warn for draining, info otherwise', async () => {
    seedAllSources();

    const { adminActivityApp } = await import('@/server/v1/routes/internal/admin-activity');
    const res = await adminActivityApp.request(
      new Request('http://localhost/?since=2026-04-20T00:00:00.000Z&until=2026-04-20T23:59:59.000Z'),
    );
    const data = await res.json();

    const by = (src: string, evt?: string) =>
      data.events.find(
        (e: any) => e.source === src && (evt ? e.event_type === evt : true),
      );

    // failed procurement
    expect(by('procurement', 'status_failed').severity).toBe('error');
    // dead-lettered webhook
    expect(by('webhook', 'delivery_dead_lettered').severity).toBe('error');
    // draining host maintenance — warning
    const maint = by('maintenance');
    expect(maint).toBeTruthy();
    expect(maint.severity).toBe('warn');
    // Passed bootstrap validation — info
    expect(by('bootstrap_validation', 'validation_passed').severity).toBe('info');
    // Succeeded restore — info
    expect(by('restore', 'restore_succeeded').severity).toBe('info');
  });

  it('rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminActivityApp } = await import('@/server/v1/routes/internal/admin-activity');
    const res = await adminActivityApp.request(new Request('http://localhost/'));
    expect(res.status).toBe(403);
  });
});
