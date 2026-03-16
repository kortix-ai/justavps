/**
 * Snapshot routes — create snapshots from Docker images, track builds, list, delete.
 *
 * Flow:
 *   1. User pastes a Docker image (e.g. "kortix/computer:0.8.6")
 *   2. POST /snapshots kicks off an async build on the requested provider
 *   3. User polls GET /snapshots/:id until status = "ready"
 *   4. User can then spin up machines from that snapshot
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { snapshots } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { getProvider, listProviders } from '../../lib/providers';
import { requireOwnedResource, requireProvider, errorResponse, handleRouteError } from '../../lib/route-helpers';
import { z } from 'zod';

type Snapshot = typeof snapshots.$inferSelect;

export const snapshotsApp = new Hono<{ Variables: AuthVariables }>();
snapshotsApp.use('*', apiGuard);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateSnapshotSchema = z.object({
  docker_image: z.string().min(1).describe('Docker image to build from (e.g. "nginx:latest", "kortix/computer:0.8.6")'),
  name: z.string().min(1).max(128).describe('Human-readable name for this snapshot'),
  provider: z.string().min(1).describe('Provider to build the snapshot on (e.g. "hetzner")'),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function serializeSnapshot(s: typeof snapshots.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    docker_image: s.dockerImage,
    status: s.status,
    architecture: s.architecture,
    providers: s.providerData ?? {},
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

// ─── POST / — Create Snapshot (start build) ────────────────────────────────

snapshotsApp.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = CreateSnapshotSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, 400, parsed.error.message);
  }

  const { docker_image, name, provider: providerName } = parsed.data;
  const ownerId = c.get('userId');

  // Validate provider exists
  const lookup = requireProvider(c, providerName);
  if (lookup.response) return lookup.response;

  // Insert snapshot record as "building"
  const [snapshot] = await db.insert(snapshots).values({
    ownerId,
    name,
    dockerImage: docker_image,
    status: 'building',
    providerData: {},
  }).returning();

  // Kick off async build — don't block the response
  buildSnapshotAsync(snapshot.id, docker_image, providerName).catch((err) => {
    console.error(`[SNAPSHOTS] Background build failed for snapshot ${snapshot.id}:`, err);
  });

  return c.json(serializeSnapshot(snapshot), 201);
});

// ─── GET / — List Snapshots ────────────────────────────────────────────────

snapshotsApp.get('/', async (c) => {
  const ownerId = c.get('userId');
  const result = await db.select().from(snapshots)
    .where(eq(snapshots.ownerId, ownerId))
    .then(rows => rows.filter(r => r.status !== 'deleted'));

  return c.json({ snapshots: result.map(serializeSnapshot) });
});

// ─── GET /:id — Get Snapshot ───────────────────────────────────────────────

snapshotsApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Snapshot>(c, snapshots, snapshots.id, id, ownerId, 'Snapshot');
  if (owned.response) return owned.response;

  return c.json(serializeSnapshot(owned.resource));
});

// ─── POST /:id/build — Build snapshot on another provider ──────────────────

const BuildOnProviderSchema = z.object({
  provider: z.string().min(1),
});

snapshotsApp.post('/:id/build', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const body = await c.req.json();
  const parsed = BuildOnProviderSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, 400, parsed.error.message);
  }

  const owned = await requireOwnedResource<Snapshot>(c, snapshots, snapshots.id, id, ownerId, 'Snapshot');
  if (owned.response) return owned.response;

  const snapshot = owned.resource;

  if (snapshot.status === 'deleted') {
    return errorResponse(c, 400, 'Snapshot has been deleted');
  }

  const providerName = parsed.data.provider;
  const existing = snapshot.providerData?.[providerName];
  if (existing) {
    return errorResponse(c, 409, `Snapshot already built on ${providerName}`);
  }

  const lookup = requireProvider(c, providerName);
  if (lookup.response) return lookup.response;

  // Kick off async build
  buildSnapshotAsync(snapshot.id, snapshot.dockerImage, providerName).catch((err) => {
    console.error(`[SNAPSHOTS] Background build on ${providerName} failed for snapshot ${snapshot.id}:`, err);
  });

  return c.json({ message: `Building snapshot on ${providerName}`, status: 'building' }, 202);
});

// ─── DELETE /:id — Delete Snapshot + cleanup provider artifacts ─────────────

snapshotsApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Snapshot>(c, snapshots, snapshots.id, id, ownerId, 'Snapshot');
  if (owned.response) return owned.response;

  const snapshot = owned.resource;

  // Delete all provider-side snapshots
  if (snapshot.providerData) {
    for (const [providerName, data] of Object.entries(snapshot.providerData) as [string, { snapshotId: string }][]) {
      try {
        const provider = getProvider(providerName);
        await provider.deleteSnapshot(data.snapshotId);
      } catch (err) {
        console.warn(`[SNAPSHOTS] Failed to delete ${providerName} artifact for snapshot ${id}:`, err);
      }
    }
  }

  await db.update(snapshots)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(eq(snapshots.id, id));

  return c.body(null, 204);
});

// ─── Background Build ──────────────────────────────────────────────────────

async function buildSnapshotAsync(snapshotId: string, dockerImage: string, providerName: string) {
  const provider = getProvider(providerName);

  try {
    console.log(`[SNAPSHOTS] Starting build: snapshot=${snapshotId} docker=${dockerImage} provider=${providerName}`);

    const result = await provider.buildSnapshot(dockerImage, {
      description: `justavps-snap-${snapshotId.slice(0, 8)}`,
    });

    // Update providerData with the new provider artifact
    const [current] = await db.select().from(snapshots).where(eq(snapshots.id, snapshotId));
    if (!current) return;

    const updatedData = {
      ...current.providerData,
      [providerName]: {
        snapshotId: result.snapshotId,
        diskSize: result.diskSize,
        architecture: result.architecture,
      },
    };

    await db.update(snapshots).set({
      status: 'ready',
      architecture: result.architecture,
      providerData: updatedData,
      updatedAt: new Date(),
    }).where(eq(snapshots.id, snapshotId));

    console.log(`[SNAPSHOTS] Ready: snapshot=${snapshotId} provider=${providerName} providerSnapshotId=${result.snapshotId}`);
  } catch (err) {
    console.error(`[SNAPSHOTS] Build failed: snapshot=${snapshotId} provider=${providerName}`, err);

    await db.update(snapshots).set({
      status: 'failed',
      buildLogs: err instanceof Error ? err.message : String(err),
      updatedAt: new Date(),
    }).where(eq(snapshots.id, snapshotId));
  }
}
