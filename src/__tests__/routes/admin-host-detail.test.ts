/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const HOST_ID = 'ed822eae-59ef-4601-8782-a17cc85196ab';
const OTHER_HOST_ID = 'cd5e48c4-1d5a-4a1a-9c99-1fb0f7c8ff2b';
const MACHINE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '11111111-1111-1111-1111-111111111111';

const hostRow = {
  id: HOST_ID,
  vendor: 'hetzner_robot',
  hostClass: 'general-small',
  region: 'eu',
  location: 'HEL1-DC4',
  name: 'bm-general-small-HEL1-ed822eae',
  status: 'active',
  maintenanceState: 'in_service',
  maintenanceRequestedAt: null,
  maintenanceStartedAt: null,
  maintenanceCompletedAt: null,
  providerServerNumber: null,
  providerTransactionId: null,
  publicIpv4: '1.2.3.4',
  publicIpv6: null,
  runnerBaseUrl: 'http://1.2.3.4:7779',
  runnerToken: 'runner-token-xyz',
  totalVcpu: 12,
  totalMemoryGb: 64,
  totalDiskGb: 900,
  usedVcpu: 4,
  usedMemoryGb: 16,
  usedDiskGb: 120,
  lastHeartbeatAt: null,
  metadata: {},
  createdAt: new Date('2026-04-02T09:55:32.536Z'),
  updatedAt: new Date('2026-04-02T09:55:32.536Z'),
};

const machineRow = {
  id: MACHINE_ID,
  slug: 'happy-cat',
  name: 'Happy Cat',
  status: 'ready',
  vcpu: 2,
  ramGb: 4,
  diskGb: 40,
  ip: '10.0.0.2',
  ownerId: USER_ID,
  ownerEmail: 'ops@example.com',
  baremetalHostId: HOST_ID,
  deletedAt: null,
  createdAt: new Date('2026-04-10T10:00:00.000Z'),
  lastHeartbeatAt: new Date('2026-04-11T10:00:00.000Z'),
  provider: 'baremetal',
  providerMeta: {},
};

const reservationRow = {
  id: '00000000-0000-4000-8000-000000000010',
  hostId: HOST_ID,
  machineId: MACHINE_ID,
  reservationType: 'machine_create',
  state: 'committed',
  vcpu: 2,
  memoryGb: 4,
  diskGb: 40,
  expiresAt: null,
  committedAt: new Date('2026-04-10T10:05:00.000Z'),
  releasedAt: null,
  metadata: {},
  createdAt: new Date('2026-04-10T10:00:00.000Z'),
  updatedAt: new Date('2026-04-10T10:05:00.000Z'),
};

const backupArtifactRow = {
  id: '00000000-0000-4000-8000-000000000020',
  accountId: null,
  machineId: MACHINE_ID,
  imageId: null,
  createdByUserId: null,
  artifactType: 'snapshot',
  backupKind: 'user_snapshot',
  inventoryScope: 'customer',
  storageScope: 'host_local',
  displayName: 'nightly-happy-cat',
  provider: 'baremetal',
  providerArtifactId: 'snap-1',
  sourceMachineSlug: 'happy-cat',
  storageUrl: null,
  sizeBytes: 1024 * 1024 * 1024,
  checksum: null,
  retentionUntil: null,
  status: 'ready',
  sourceHostId: HOST_ID,
  lastVerifiedAt: null,
  restoreCount: 0,
  lastRestoreAt: null,
  metadata: {},
  createdAt: new Date('2026-04-11T05:00:00.000Z'),
  updatedAt: new Date('2026-04-11T05:00:00.000Z'),
  completedAt: new Date('2026-04-11T05:01:00.000Z'),
};

const hostImageRow = {
  id: '00000000-0000-4000-8000-000000000030',
  hostId: HOST_ID,
  imageId: null,
  imageAlias: 'ubuntu-24.04',
  imageRef: 'ubuntu/24.04',
  availabilityState: 'local',
  source: 'remote_server:images',
  lastSeenAt: new Date('2026-04-11T06:00:00.000Z'),
  lastRequestedAt: null,
  metadata: {},
  createdAt: new Date('2026-04-10T10:00:00.000Z'),
  updatedAt: new Date('2026-04-11T06:00:00.000Z'),
};

const eventRow = {
  id: '00000000-0000-4000-8000-000000000040',
  machineId: MACHINE_ID,
  accountId: null,
  event: 'status_changed',
  stage: null,
  message: 'machine became ready',
  metadata: {},
  createdAt: new Date('2026-04-11T09:00:00.000Z'),
};

// ─── Mock plumbing ────────────────────────────────────────────────────────

const getStateMock = vi.fn();

const fromChainStore: { queries: Array<{ table: string; rows: unknown[] }> } = { queries: [] };
let whereQueue: unknown[][] = [];
let directQueue: unknown[][] = [];
let joinMachines: unknown[] = [];

function resetMocks() {
  fromChainStore.queries = [];
  whereQueue = [];
  directQueue = [];
  joinMachines = [];
  getStateMock.mockReset();
}

function pushDirect(rows: unknown[]) { directQueue.push(rows); }
function pushWhere(rows: unknown[]) { whereQueue.push(rows); }

// orderBy -> limit (chain used for machineEvents)
const limitMock = vi.fn(() => Promise.resolve(whereQueue.shift() ?? []));
const orderByMock = vi.fn(() => ({ limit: limitMock }));
const whereChainMock = vi.fn(() => ({
  orderBy: orderByMock,
  then: (resolve: any) => resolve(whereQueue.shift() ?? []),
}));

// Base select().from() can be called either directly (thenable) or followed by
// .where() (simple) or .leftJoin().where() (for the machines+users join).
const leftJoinMock = vi.fn(() => ({ where: (..._args: unknown[]) => Promise.resolve(joinMachines) }));
const fromMock = vi.fn(() => ({
  where: whereChainMock,
  leftJoin: leftJoinMock,
  then: (resolve: any) => resolve(directQueue.shift() ?? []),
}));

const updateReturningMock = vi.fn();
const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));

const insertReturningMock = vi.fn();

vi.mock('@/server/platform/baremetal/runner-client', () => ({
  HttpBaremetalRunnerClient: vi.fn(function HttpBaremetalRunnerClient() {
    return { getState: getStateMock };
  }),
}));

vi.mock('@/server/platform/baremetal/reconcile', () => ({
  reconcileBaremetalFleet: vi.fn(),
  reconcileBaremetalHost: vi.fn(),
}));

vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    if ((globalThis as any).__TEST_NON_ADMIN__) {
      c.set('isAdmin', false);
    } else {
      c.set('isAdmin', true);
    }
    c.set('userId', USER_ID);
    return next();
  },
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: fromMock })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturningMock, onConflictDoNothing: vi.fn(() => ({ returning: insertReturningMock })) })) })),
    update: vi.fn(() => ({ set: updateSetMock })),
  },
}));

describe('GET /admin/fleet/hosts/:id (host detail)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetMocks();
    (globalThis as any).__TEST_NON_ADMIN__ = false;
    process.env.HETZNER_ROBOT_USER = 'robot-user';
    process.env.HETZNER_ROBOT_PASSWORD = 'robot-pass';
  });

  it('returns 403 for non-admin callers', async () => {
    (globalThis as any).__TEST_NON_ADMIN__ = true;
    const { adminFleetV2App } = await import('@/server/v2/routes/admin/fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${HOST_ID}`));
    expect(res.status).toBe(403);
  });

  it('returns 404 when the host is not found', async () => {
    // Host lookup → empty array.
    pushWhere([]);
    const { adminFleetV2App } = await import('@/server/v2/routes/admin/fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${OTHER_HOST_ID}`));
    expect(res.status).toBe(404);
  });

  it('returns host detail with machines, reservations, events, and an unreachable runner probe', async () => {
    getStateMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    // Order of DB calls inside the handler:
    //   1. select().from(baremetalHosts).where(eq(id))            — host lookup
    //   2. select({...}).from(machines).leftJoin(users).where(…)  — host machines
    //   3. select().from(hostCapacityReservations).where(…)       — reservations
    //   4. select().from(backupArtifacts).where(…)                — backup artifacts
    //   5. select().from(baremetalHostImages).where(…)            — host images
    //   6. select().from(machines)                                — all machines (for slug map)
    //   7. select().from(machineEvents).where(…).orderBy.limit     — recent events
    //   (no images lookup — hostImageRow.imageId is null)
    pushWhere([hostRow]);                      // (1) host
    joinMachines = [machineRow];               // (2) host machines via join
    pushWhere([reservationRow]);               // (3) reservations
    pushWhere([backupArtifactRow]);            // (4) backup artifacts
    pushWhere([hostImageRow]);                 // (5) host images
    pushDirect([{ ...machineRow, providerMeta: {} }]); // (6) all machines
    pushWhere([eventRow]);                     // (7) events via .orderBy().limit()

    const { adminFleetV2App } = await import('@/server/v2/routes/admin/fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${HOST_ID}`));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Shape checks.
    expect(data.host).toMatchObject({
      id: HOST_ID,
      name: hostRow.name,
      region: 'eu',
      host_class: 'general-small',
      status: 'active',
    });
    expect(Array.isArray(data.machines)).toBe(true);
    expect(data.machines[0]).toMatchObject({
      id: MACHINE_ID,
      slug: 'happy-cat',
      status: 'ready',
      vcpu: 2,
      memory_gb: 4,
      disk_gb: 40,
      ip: '10.0.0.2',
      owner_email: 'ops@example.com',
    });
    expect(data.reservations[0]).toMatchObject({
      id: reservationRow.id,
      machine_slug: 'happy-cat',
      state: 'committed',
    });
    expect(data.events[0]).toMatchObject({
      id: eventRow.id,
      machine_slug: 'happy-cat',
      event: 'status_changed',
    });
    expect(data.backup_artifacts[0]).toMatchObject({
      id: backupArtifactRow.id,
      status: 'ready',
    });
    expect(data.images_cached[0]).toMatchObject({
      id: hostImageRow.id,
      availability_state: 'local',
      image_ref: 'ubuntu/24.04',
    });

    // Runner probe: unreachable because we mocked getState() to reject.
    expect(data.runner_probe).toEqual(expect.objectContaining({
      reachable: false,
      error: expect.any(String),
    }));
    expect(data.runner_probe.error).toContain('ECONNREFUSED');
  });
});
