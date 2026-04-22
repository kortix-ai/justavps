/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin Images + Backup Artifacts surface.
 *
 * Covers:
 *  - GET /admin/images           — list + summary shape (template_count)
 *  - GET /admin/images/:id       — 404 when unknown
 *  - DELETE /admin/images/:id    — 409 when in-use, 200 + status flip when unused
 *  - GET /admin/backup-artifacts — list + summary (total_size_bytes sum)
 *  - GET /admin/backup-artifacts/:id — 404 when unknown
 *  - Non-admin 403 on all routes
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fixtures ────────────────────────────────────────────────────────────────

const IMG_TEMPLATE_ID = 'aaaa1111-2222-4333-8444-555555555551';
const IMG_SNAPSHOT_ID = 'aaaa1111-2222-4333-8444-555555555552';
const UNKNOWN_ID = 'aaaa1111-2222-4333-8444-999999999999';
const OWNER_ID = 'bbbb1111-2222-4333-8444-555555555551';
const ACCOUNT_ID = 'cccc1111-2222-4333-8444-555555555551';
const ARTIFACT_ID = 'dddd1111-2222-4333-8444-555555555551';

const templateRow = {
  id: IMG_TEMPLATE_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  name: 'ubuntu-24.04',
  description: 'Golden Ubuntu template',
  status: 'ready' as const,
  isTemplate: true,
  sourceMachineId: null,
  provider: 'cloud',
  providerImageId: 'provider-ubuntu',
  diskSizeGb: 20,
  architecture: 'x86',
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-01T00:00:00.000Z'),
};

const snapshotRow = {
  id: IMG_SNAPSHOT_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  name: 'my-snap',
  description: null,
  status: 'ready' as const,
  isTemplate: false,
  sourceMachineId: null,
  provider: 'cloud',
  providerImageId: 'provider-snap',
  diskSizeGb: 40,
  architecture: 'x86',
  createdAt: new Date('2026-04-10T00:00:00.000Z'),
  updatedAt: new Date('2026-04-10T00:00:00.000Z'),
};

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

const selectQueue: any[][] = [];
const updateCalls: Array<{ set: Record<string, unknown>; where: unknown }> = [];

function enqueueSelect(rows: any[]) {
  selectQueue.push(rows);
}

function makeSelectChain() {
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
        where: async (w: unknown) => {
          updateCalls.push({ set: values, where: w });
          return [];
        },
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    transaction: vi.fn(async (fn: any) =>
      fn({ select: vi.fn(), update: vi.fn(), insert: vi.fn() }),
    ),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin images + backup-artifacts routes', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateCalls.length = 0;
    currentIsAdmin = true;
  });

  // ─── GET /admin/images ────────────────────────────────────────────────────

  it('GET /admin/images returns list + summary with correct template_count', async () => {
    // SELECT order:
    //  1. count(*) total
    //  2. page rows (image+joins+host_locality_count)
    //  3. summary aggregates
    enqueueSelect([{ count: 2 }]);
    enqueueSelect([
      {
        image: templateRow,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        sourceMachineSlug: null,
        sourceMachineName: null,
        hostLocalityCount: 3,
      },
      {
        image: snapshotRow,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        sourceMachineSlug: 'src-machine',
        sourceMachineName: 'src machine',
        hostLocalityCount: 1,
      },
    ]);
    enqueueSelect([
      {
        total_images: 2,
        template_count: 1,
        user_snapshot_count: 1,
        ready_count: 2,
        failed_count: 0,
        total_disk_gb: 60,
      },
    ]);

    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(new Request('http://localhost/images'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(2);
    expect(data.images).toHaveLength(2);

    const tmpl = data.images.find((i: any) => i.id === IMG_TEMPLATE_ID);
    const snap = data.images.find((i: any) => i.id === IMG_SNAPSHOT_ID);
    expect(tmpl.is_template).toBe(true);
    expect(tmpl.host_locality_count).toBe(3);
    expect(snap.is_template).toBe(false);
    // sourceMachineId is null on snapshotRow → source_machine serializes to null
    expect(snap.source_machine).toBeNull();

    expect(data.summary).toEqual({
      total_images: 2,
      template_count: 1,
      user_snapshot_count: 1,
      ready_count: 2,
      failed_count: 0,
      total_disk_gb: 60,
    });
  });

  it('GET /admin/images rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(new Request('http://localhost/images'));
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/images/:id ────────────────────────────────────────────────

  it('GET /admin/images/:id returns 404 for unknown image', async () => {
    enqueueSelect([]); // image lookup empty
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/images/${UNKNOWN_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it('GET /admin/images/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/images/${IMG_TEMPLATE_ID}`),
    );
    expect(res.status).toBe(403);
  });

  // ─── DELETE /admin/images/:id ─────────────────────────────────────────────

  it('DELETE /admin/images/:id rejects with 409 when image has running machines', async () => {
    // SELECT order:
    //  1. image lookup by id → found
    //  2. count of non-deleted/non-error machines with imageId=id → 2
    enqueueSelect([snapshotRow]);
    enqueueSelect([{ count: 2 }]);

    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/images/${IMG_SNAPSHOT_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(String(body.message)).toMatch(/in use/i);
    // No update should have occurred
    expect(updateCalls).toHaveLength(0);
  });

  it('DELETE /admin/images/:id soft-deletes (status=deleted) when unused', async () => {
    enqueueSelect([snapshotRow]);
    enqueueSelect([{ count: 0 }]);

    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/images/${IMG_SNAPSHOT_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.set).toMatchObject({ status: 'deleted' });
  });

  it('DELETE /admin/images/:id returns 404 for unknown or already-deleted images', async () => {
    enqueueSelect([]); // not found
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/images/${UNKNOWN_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /admin/images/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/images/${IMG_SNAPSHOT_ID}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/backup-artifacts ──────────────────────────────────────────

  it('GET /admin/backup-artifacts returns list + summary with size_bytes summed', async () => {
    // SELECT order:
    //  1. count(*) total
    //  2. page rows
    //  3. summary aggregates
    enqueueSelect([{ count: 2 }]);
    enqueueSelect([
      {
        artifact: {
          id: ARTIFACT_ID,
          accountId: ACCOUNT_ID,
          machineId: null,
          imageId: null,
          createdByUserId: null,
          artifactType: 'snapshot',
          backupKind: 'user_snapshot',
          inventoryScope: 'customer',
          storageScope: 'host_local',
          displayName: 'my backup',
          provider: 'baremetal',
          providerArtifactId: 'prov-1',
          sourceMachineSlug: 'box-1',
          storageUrl: null,
          sizeBytes: 1_000_000_000,
          checksum: 'sha256:abc',
          retentionUntil: null,
          status: 'ready',
          sourceHostId: null,
          lastVerifiedAt: null,
          restoreCount: 0,
          lastRestoreAt: null,
          metadata: {},
          createdAt: new Date('2026-04-10T00:00:00.000Z'),
          updatedAt: new Date('2026-04-10T00:00:00.000Z'),
          completedAt: new Date('2026-04-10T00:05:00.000Z'),
        },
        sourceHostId: null,
        sourceHostName: null,
        sourceHostRegion: null,
        machineSlug: null,
        imageName: null,
      },
    ]);
    enqueueSelect([
      {
        total_count: 2,
        ready_count: 1,
        failed_count: 1,
        total_size_bytes: 3_000_000_000,
        user_snapshot_count: 1,
        operator_dr_count: 1,
      },
    ]);

    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request('http://localhost/backup-artifacts'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(2);
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts[0].size_bytes).toBe(1_000_000_000);
    expect(data.artifacts[0].display_name).toBe('my backup');

    expect(data.summary.total_size_bytes).toBe(3_000_000_000);
    expect(data.summary.user_snapshot_count).toBe(1);
    expect(data.summary.operator_dr_count).toBe(1);
  });

  it('GET /admin/backup-artifacts rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request('http://localhost/backup-artifacts'),
    );
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/backup-artifacts/:id ──────────────────────────────────────

  it('GET /admin/backup-artifacts/:id returns 404 for unknown artifact', async () => {
    enqueueSelect([]);
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/backup-artifacts/${UNKNOWN_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it('GET /admin/backup-artifacts/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminImagesApp } = await import('@/server/v1/routes/internal/admin-images');
    const res = await adminImagesApp.request(
      new Request(`http://localhost/backup-artifacts/${ARTIFACT_ID}`),
    );
    expect(res.status).toBe(403);
  });
});
