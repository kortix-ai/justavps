/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin machines CRUD + lifecycle surface.
 * Validates GET /:id, POST /, PATCH /:id, and POST /:id/(start|stop|reboot).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MACHINE_ID = '11111111-2222-4333-8444-555555555555';
const OWNER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ACCOUNT_ID = 'f1111111-2222-4333-8444-555555555555';
const HOST_ID = 'ee111111-2222-4333-8444-555555555555';

const machineRow = {
  id: MACHINE_ID,
  slug: 'admin-test-machine',
  name: 'admin-test',
  status: 'ready' as const,
  provisioningStage: null,
  provider: 'baremetal',
  serverType: 'custom',
  region: 'eu',
  ip: '1.2.3.4',
  publicIpv4: '1.2.3.4',
  publicIpv6: null,
  sshPort: 22,
  httpPort: 80,
  source: 'user',
  kortixSandboxId: null,
  priceMonthly: 10,
  backupsEnabled: false,
  providerServerId: 'justavps-admin-test-machine',
  baremetalHostId: HOST_ID,
  daemonVersion: '1.0.0',
  machineMode: 'vm',
  apiVersion: 'v2',
  vcpu: 2,
  ramGb: 4,
  diskGb: 40,
  domains: [],
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  createdAt: new Date('2026-04-10T00:00:00.000Z'),
  readyAt: new Date('2026-04-10T00:05:00.000Z'),
  deletedAt: null,
  lastHeartbeatAt: new Date('2026-04-10T00:10:00.000Z'),
  lastHeartbeat: { cpu: 5, memory: 20, disk: 10 },
  providerMeta: {},
  machineToken: 'encrypted-token',
};

const userRow = {
  id: OWNER_ID,
  email: 'owner@example.com',
  name: 'Owner',
  defaultAccountId: ACCOUNT_ID,
};

const accountRow = {
  id: ACCOUNT_ID,
  name: 'Acme',
  slug: 'acme',
  type: 'organization' as const,
};

const hostRow = {
  id: HOST_ID,
  name: 'bm-host-1',
  region: 'eu',
  location: 'HEL1-DC4',
  publicIpv4: '9.8.7.6',
  runnerBaseUrl: 'http://9.8.7.6:7779',
  runnerToken: 'runner-token-xyz',
};

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', true);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

const startInstanceMock = vi.fn(async () => undefined);
const stopInstanceMock = vi.fn(async () => undefined);
const rebootInstanceMock = vi.fn(async () => undefined);

vi.mock('@/server/platform/baremetal/runner-client', () => ({
  HttpBaremetalRunnerClient: vi.fn(function HttpBaremetalRunnerClient() {
    return {
      startInstance: startInstanceMock,
      stopInstance: stopInstanceMock,
      rebootInstance: rebootInstanceMock,
    };
  }),
}));

const createMachineV2Mock = vi.fn();
vi.mock('@/server/v2/services/machines', () => ({
  createMachineV2: createMachineV2Mock,
}));

const cleanupMachineResourcesMock = vi.fn(async () => ({ ok: true }));
vi.mock('@/server/v1/services/machine-lifecycle', () => ({
  cleanupMachineResources: cleanupMachineResourcesMock,
}));

vi.mock('@/server/platform/providers/index', () => ({
  getProvider: vi.fn(() => ({})),
}));

// ── In-memory DB stub ───────────────────────────────────────────────────────
//
// The admin-machines route reaches into drizzle with a variety of chained
// query shapes. We feed query results via a FIFO queue: every call to
// `db.select().from(...)...await` pops the next result.

const selectQueue: any[][] = [];
const updateCalls: Array<{ set: Record<string, unknown>; where: unknown }> = [];

function enqueueSelect(rows: any[]) {
  selectQueue.push(rows);
}

function makeSelectChain() {
  // Resolve by popping the queue when the chain is awaited.
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
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          updateCalls.push({ set: values, where: cond });
          return [];
        },
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    transaction: vi.fn(async (fn: any) => fn({ select: vi.fn(), update: vi.fn(), insert: vi.fn() })),
  },
}));

// Result shapes matching the routes' select projections
const detailJoinRow = () => ({
  machine: machineRow,
  ownerEmail: userRow.email,
  ownerName: userRow.name,
  accountName: accountRow.name,
  accountSlug: accountRow.slug,
  accountType: accountRow.type,
});
const hostProjection = () => ({
  id: hostRow.id,
  name: hostRow.name,
  region: hostRow.region,
  location: hostRow.location,
  publicIpv4: hostRow.publicIpv4,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin machines CRUD + lifecycle', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateCalls.length = 0;
    startInstanceMock.mockClear();
    startInstanceMock.mockImplementation(async () => undefined);
    stopInstanceMock.mockClear();
    stopInstanceMock.mockImplementation(async () => undefined);
    rebootInstanceMock.mockClear();
    rebootInstanceMock.mockImplementation(async () => undefined);
    createMachineV2Mock.mockReset();
    cleanupMachineResourcesMock.mockClear();
  });

  it('returns 404 for an unknown machine on GET /:id', async () => {
    enqueueSelect([]); // loadMachineWithJoins → not found

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}`));
    expect(res.status).toBe(404);
  });

  it('returns full machine detail on GET /:id', async () => {
    enqueueSelect([detailJoinRow()]);         // 1) loadMachineWithJoins
    enqueueSelect([]);                        // 2) subscriptions
    enqueueSelect([]);                        // 3) events
    enqueueSelect([]);                        // 4) heartbeat
    enqueueSelect([]);                        // 5) port allocations
    enqueueSelect([hostProjection()]);        // 6) host

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.machine.id).toBe(MACHINE_ID);
    expect(data.machine.slug).toBe(machineRow.slug);
    expect(data.host).toMatchObject({ id: HOST_ID, name: 'bm-host-1' });
  });

  it('creates a machine on behalf of a user via POST /', async () => {
    enqueueSelect([userRow]);                 // 1) owner lookup
    enqueueSelect([accountRow]);              // 2) account lookup
    // createMachineV2 is mocked — internally it doesn't hit our db mock
    // because it's fully replaced. Afterwards, serializeFullMachineById runs:
    enqueueSelect([detailJoinRow()]);         // 3) loadMachineWithJoins
    enqueueSelect([]);                        // 4) subscriptions

    createMachineV2Mock.mockResolvedValueOnce({
      kind: 'machine',
      machine: { id: MACHINE_ID, slug: 'admin-test-machine' },
    });

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: OWNER_ID,
        account_id: ACCOUNT_ID,
        name: 'admin-test',
        region: 'eu',
        vcpu: 2,
        memory_gb: 4,
        disk_gb: 40,
        image_ref: 'ubuntu-24.04',
        machine_mode: 'vm',
      }),
    }));

    expect(res.status).toBe(201);
    expect(createMachineV2Mock).toHaveBeenCalledTimes(1);
    const call = createMachineV2Mock.mock.calls[0][0];
    expect(call.accountId).toBe(ACCOUNT_ID);
    expect(call.userId).toBe(OWNER_ID);
    expect(call.isAdmin).toBe(true);
    expect(call.input.vcpu).toBe(2);
    expect(call.input.ram_gb).toBe(4);
    expect(call.input.disk_gb).toBe(40);
  });

  it('rejects POST / when owner_user_id does not exist', async () => {
    enqueueSelect([]); // empty user lookup

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: '99999999-9999-9999-9999-999999999999',
        region: 'eu',
        vcpu: 2,
        memory_gb: 4,
        disk_gb: 40,
      }),
    }));

    expect(res.status).toBe(400);
    expect(createMachineV2Mock).not.toHaveBeenCalled();
  });

  it('renames a machine via PATCH /:id', async () => {
    enqueueSelect([machineRow]);              // 1) initial machine lookup
    enqueueSelect([detailJoinRow()]);         // 2) serializeFullMachineById → joins
    enqueueSelect([]);                        // 3) subscriptions

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed-machine' }),
    }));

    expect(res.status).toBe(200);
    const nameUpdate = updateCalls.find((u) => 'name' in u.set);
    expect(nameUpdate?.set.name).toBe('renamed-machine');
  });

  it('rejects resize attempts via PATCH /:id', async () => {
    enqueueSelect([machineRow]);

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vcpu: 4 }),
    }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.message ?? '')).toMatch(/resize/i);
  });

  it('calls runner.startInstance on POST /:id/start', async () => {
    enqueueSelect([machineRow]);              // handleLifecycleAction → machine lookup
    enqueueSelect([hostRow]);                 // getRunnerClientForMachine → host lookup
    enqueueSelect([detailJoinRow()]);         // serializeFullMachineById → joins
    enqueueSelect([]);                        // subscriptions

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}/start`, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(startInstanceMock).toHaveBeenCalledWith('justavps-admin-test-machine');
  });

  it('calls runner.stopInstance on POST /:id/stop', async () => {
    enqueueSelect([machineRow]);
    enqueueSelect([hostRow]);
    enqueueSelect([detailJoinRow()]);
    enqueueSelect([]);

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}/stop`, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(stopInstanceMock).toHaveBeenCalledWith('justavps-admin-test-machine');
  });

  it('calls runner.rebootInstance on POST /:id/reboot', async () => {
    enqueueSelect([machineRow]);
    enqueueSelect([hostRow]);
    enqueueSelect([detailJoinRow()]);
    enqueueSelect([]);

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}/reboot`, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(rebootInstanceMock).toHaveBeenCalledWith('justavps-admin-test-machine');
  });

  it('returns 502 when the runner throws', async () => {
    enqueueSelect([machineRow]);
    enqueueSelect([hostRow]);

    startInstanceMock.mockImplementationOnce(async () => { throw new Error('runner down'); });

    const { adminMachinesApp } = await import('@/server/v1/routes/internal/admin-machines');
    const res = await adminMachinesApp.request(new Request(`http://localhost/${MACHINE_ID}/start`, { method: 'POST' }));
    expect(res.status).toBe(502);
  });
});
