/**
 * Admin Images + Backup Artifacts — admin-only fleet-wide views of every
 * image the platform knows about (user snapshots, golden templates,
 * per-host localities) plus the backup artifact catalog.
 *
 * Scope: operator view. Read-only except for the explicit soft-delete of
 * an image. Follows the same apiGuard + requireAdmin pattern as
 * `admin-accounts.ts` / `admin-billing.ts`.
 *
 * A single OpenAPIHono app serves BOTH `/images` and `/backup-artifacts`;
 * in `routes/index.ts` we mount this under `/admin` so final paths are
 * `/api/v1/admin/images` and `/api/v1/admin/backup-artifacts`.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, ilike, or, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  images,
  users,
  accounts,
  machines,
  baremetalHosts,
  baremetalHostImages,
  backupArtifacts,
  restoreExecutions,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { errorResponse } from "@/server/core/route-helpers";

export const adminImagesApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminImagesApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
}

function parseLimit(raw: string | undefined, fallback: number, max = 500) {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseOffset(raw: string | undefined) {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGES
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /images — list images with owner + locality + source machine ───────

adminImagesApp.get('/images', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const status = c.req.query('status'); // creating | ready | failed | deleted | all
  const isTemplateRaw = c.req.query('is_template');
  const provider = c.req.query('provider');
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (!status || status === 'all') {
    // default: hide deleted
    conditions.push(sql`${images.status} <> 'deleted'` as unknown as ReturnType<typeof eq>);
  } else {
    conditions.push(eq(images.status, status));
  }

  if (isTemplateRaw === 'true') {
    conditions.push(eq(images.isTemplate, true));
  } else if (isTemplateRaw === 'false') {
    conditions.push(eq(images.isTemplate, false));
  }

  if (provider) {
    conditions.push(eq(images.provider, provider));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(images.name, pattern),
        ilike(sql`cast(${images.id} as text)`, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total matching
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(images)
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  // Subquery for host locality count per image
  const hostLocalityCountSql = sql<number>`(
    select count(*)::int
    from ${baremetalHostImages} hi
    where hi.image_id = ${images.id}
  )`;

  // Page of image rows with owner/account + source machine joins
  const rows = await db
    .select({
      image: images,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
      sourceMachineSlug: machines.slug,
      sourceMachineName: machines.name,
      hostLocalityCount: hostLocalityCountSql,
    })
    .from(images)
    .leftJoin(users, eq(images.ownerId, users.id))
    .leftJoin(accounts, eq(images.accountId, accounts.id))
    .leftJoin(machines, eq(images.sourceMachineId, machines.id))
    .where(where)
    .orderBy(desc(images.createdAt))
    .limit(limit)
    .offset(offset);

  // Summary across ALL non-deleted images (ignore q/filters so KPIs reflect
  // the full fleet). Respects the same "exclude deleted by default" rule.
  const summaryBaseWhere = sql`${images.status} <> 'deleted'`;

  const [summaryRow] = await db
    .select({
      total_images: sql<number>`count(*)`,
      template_count: sql<number>`count(*) filter (where ${images.isTemplate} = true)`,
      user_snapshot_count: sql<number>`count(*) filter (where ${images.isTemplate} = false)`,
      ready_count: sql<number>`count(*) filter (where ${images.status} = 'ready')`,
      failed_count: sql<number>`count(*) filter (where ${images.status} = 'failed')`,
      total_disk_gb: sql<number>`coalesce(sum(${images.diskSizeGb}), 0)`,
    })
    .from(images)
    .where(summaryBaseWhere);

  return c.json({
    total,
    images: rows.map((r) => ({
      id: r.image.id,
      name: r.image.name,
      description: r.image.description ?? null,
      status: r.image.status,
      is_template: r.image.isTemplate,
      provider: r.image.provider,
      provider_image_id: r.image.providerImageId ?? null,
      disk_size_gb: r.image.diskSizeGb ?? null,
      architecture: r.image.architecture ?? null,
      source_machine: r.image.sourceMachineId ? {
        id: r.image.sourceMachineId,
        slug: r.sourceMachineSlug ?? null,
        name: r.sourceMachineName ?? null,
      } : null,
      owner: {
        id: r.image.ownerId,
        email: r.ownerEmail ?? null,
        name: r.ownerName ?? null,
      },
      account: r.image.accountId ? {
        id: r.image.accountId,
        name: r.accountName ?? null,
        slug: r.accountSlug ?? null,
        type: r.accountType ?? null,
      } : null,
      host_locality_count: Number(r.hostLocalityCount ?? 0),
      created_at: r.image.createdAt.toISOString(),
      updated_at: r.image.updatedAt.toISOString(),
    })),
    summary: {
      total_images: Number(summaryRow?.total_images ?? 0),
      template_count: Number(summaryRow?.template_count ?? 0),
      user_snapshot_count: Number(summaryRow?.user_snapshot_count ?? 0),
      ready_count: Number(summaryRow?.ready_count ?? 0),
      failed_count: Number(summaryRow?.failed_count ?? 0),
      total_disk_gb: Number(summaryRow?.total_disk_gb ?? 0),
    },
  });
});

// ─── GET /images/:id — detail ──────────────────────────────────────────────

adminImagesApp.get('/images/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid image ID');
  }

  const [imageRow] = await db
    .select({
      image: images,
      ownerEmail: users.email,
      ownerName: users.name,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    })
    .from(images)
    .leftJoin(users, eq(images.ownerId, users.id))
    .leftJoin(accounts, eq(images.accountId, accounts.id))
    .where(eq(images.id, id));

  if (!imageRow) {
    return errorResponse(c, 404, 'Image not found');
  }

  const img = imageRow.image;

  // Source machine summary (if still exists)
  let sourceMachine: {
    id: string;
    slug: string;
    name: string;
    status: string;
  } | null = null;
  if (img.sourceMachineId) {
    const [sm] = await db
      .select({
        id: machines.id,
        slug: machines.slug,
        name: machines.name,
        status: machines.status,
      })
      .from(machines)
      .where(eq(machines.id, img.sourceMachineId));
    if (sm) sourceMachine = sm;
  }

  // Host localities
  const localityRows = await db
    .select({
      id: baremetalHostImages.id,
      hostId: baremetalHostImages.hostId,
      hostName: baremetalHosts.name,
      region: baremetalHosts.region,
      location: baremetalHosts.location,
      availabilityState: baremetalHostImages.availabilityState,
      source: baremetalHostImages.source,
      lastSeenAt: baremetalHostImages.lastSeenAt,
    })
    .from(baremetalHostImages)
    .leftJoin(baremetalHosts, eq(baremetalHostImages.hostId, baremetalHosts.id))
    .where(eq(baremetalHostImages.imageId, id))
    .orderBy(desc(baremetalHostImages.lastSeenAt));

  // Recent machines that booted from this image (last 20)
  const recentMachineRows = await db
    .select({
      id: machines.id,
      slug: machines.slug,
      name: machines.name,
      status: machines.status,
      region: machines.region,
      accountId: machines.accountId,
      ownerId: machines.ownerId,
      createdAt: machines.createdAt,
      deletedAt: machines.deletedAt,
    })
    .from(machines)
    .where(eq(machines.imageId, id))
    .orderBy(desc(machines.createdAt))
    .limit(20);

  return c.json({
    image: {
      id: img.id,
      name: img.name,
      description: img.description ?? null,
      status: img.status,
      is_template: img.isTemplate,
      provider: img.provider,
      provider_image_id: img.providerImageId ?? null,
      disk_size_gb: img.diskSizeGb ?? null,
      architecture: img.architecture ?? null,
      created_at: img.createdAt.toISOString(),
      updated_at: img.updatedAt.toISOString(),
    },
    owner: {
      id: img.ownerId,
      email: imageRow.ownerEmail ?? null,
      name: imageRow.ownerName ?? null,
    },
    account: img.accountId ? {
      id: img.accountId,
      name: imageRow.accountName ?? null,
      slug: imageRow.accountSlug ?? null,
      type: imageRow.accountType ?? null,
    } : null,
    source_machine: sourceMachine,
    localities: localityRows.map((l) => ({
      id: l.id,
      host_id: l.hostId,
      host_name: l.hostName ?? null,
      region: l.region ?? null,
      location: l.location ?? null,
      availability_state: l.availabilityState,
      source: l.source,
      last_seen_at: l.lastSeenAt?.toISOString() ?? null,
    })),
    recent_machines: recentMachineRows.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      status: m.status,
      region: m.region,
      account_id: m.accountId ?? null,
      owner_id: m.ownerId,
      created_at: m.createdAt.toISOString(),
      deleted_at: m.deletedAt?.toISOString() ?? null,
    })),
  });
});

// ─── DELETE /images/:id — soft-delete (status='deleted') ───────────────────
//
// Guarded: rejects with 409 if any non-deleted/non-error machine currently
// has its imageId pointing at this image. Actual Hetzner / disk cleanup is
// NOT performed here — that's a separate background GC service (follow-up).

adminImagesApp.delete('/images/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid image ID');
  }

  const [img] = await db.select().from(images).where(eq(images.id, id));
  if (!img) {
    return errorResponse(c, 404, 'Image not found');
  }
  if (img.status === 'deleted') {
    return errorResponse(c, 404, 'Image is already deleted');
  }

  const [inUseRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(machines)
    .where(
      and(
        eq(machines.imageId, id),
        sql`${machines.status} not in ('deleted', 'error')`,
      ),
    );
  const inUseCount = Number(inUseRow?.count ?? 0);
  if (inUseCount > 0) {
    return errorResponse(
      c,
      409,
      `Image is in use by ${inUseCount} running machine(s); cannot delete`,
    );
  }

  await db.update(images).set({
    status: 'deleted',
    updatedAt: new Date(),
  }).where(eq(images.id, id));

  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// BACKUP ARTIFACTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /backup-artifacts — list ──────────────────────────────────────────

adminImagesApp.get('/backup-artifacts', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const status = c.req.query('status'); // creating | ready | failed | deleted | all
  const kind = c.req.query('kind'); // user_snapshot | operator_dr_export | all
  const limit = parseLimit(c.req.query('limit'), 100);
  const offset = parseOffset(c.req.query('offset'));

  const conditions: ReturnType<typeof eq>[] = [];

  if (!status || status === 'all') {
    conditions.push(sql`${backupArtifacts.status} <> 'deleted'` as unknown as ReturnType<typeof eq>);
  } else {
    conditions.push(eq(backupArtifacts.status, status));
  }

  if (kind && kind !== 'all') {
    conditions.push(eq(backupArtifacts.backupKind, kind));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(backupArtifacts.displayName, pattern),
        ilike(backupArtifacts.sourceMachineSlug, pattern),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(backupArtifacts)
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      artifact: backupArtifacts,
      sourceHostId: baremetalHosts.id,
      sourceHostName: baremetalHosts.name,
      sourceHostRegion: baremetalHosts.region,
      machineSlug: machines.slug,
      imageName: images.name,
    })
    .from(backupArtifacts)
    .leftJoin(baremetalHosts, eq(backupArtifacts.sourceHostId, baremetalHosts.id))
    .leftJoin(machines, eq(backupArtifacts.machineId, machines.id))
    .leftJoin(images, eq(backupArtifacts.imageId, images.id))
    .where(where)
    .orderBy(desc(backupArtifacts.createdAt))
    .limit(limit)
    .offset(offset);

  // Summary across ALL non-deleted artifacts
  const summaryBaseWhere = sql`${backupArtifacts.status} <> 'deleted'`;
  const [summaryRow] = await db
    .select({
      total_count: sql<number>`count(*)`,
      ready_count: sql<number>`count(*) filter (where ${backupArtifacts.status} = 'ready')`,
      failed_count: sql<number>`count(*) filter (where ${backupArtifacts.status} = 'failed')`,
      total_size_bytes: sql<number>`coalesce(sum(${backupArtifacts.sizeBytes}), 0)`,
      user_snapshot_count: sql<number>`count(*) filter (where ${backupArtifacts.backupKind} = 'user_snapshot')`,
      operator_dr_count: sql<number>`count(*) filter (where ${backupArtifacts.backupKind} = 'operator_dr_export')`,
    })
    .from(backupArtifacts)
    .where(summaryBaseWhere);

  return c.json({
    total,
    artifacts: rows.map((r) => ({
      id: r.artifact.id,
      display_name: r.artifact.displayName ?? null,
      backup_kind: r.artifact.backupKind,
      inventory_scope: r.artifact.inventoryScope,
      storage_scope: r.artifact.storageScope,
      provider: r.artifact.provider,
      provider_artifact_id: r.artifact.providerArtifactId ?? null,
      size_bytes: r.artifact.sizeBytes ?? null,
      checksum: r.artifact.checksum ?? null,
      status: r.artifact.status,
      source_machine_slug: r.artifact.sourceMachineSlug ?? null,
      source_host: r.sourceHostId ? {
        id: r.sourceHostId,
        name: r.sourceHostName ?? null,
        region: r.sourceHostRegion ?? null,
      } : null,
      machine: r.artifact.machineId ? {
        id: r.artifact.machineId,
        slug: r.machineSlug ?? null,
      } : null,
      image: r.artifact.imageId ? {
        id: r.artifact.imageId,
        name: r.imageName ?? null,
      } : null,
      retention_until: r.artifact.retentionUntil?.toISOString() ?? null,
      last_verified_at: r.artifact.lastVerifiedAt?.toISOString() ?? null,
      restore_count: r.artifact.restoreCount,
      last_restore_at: r.artifact.lastRestoreAt?.toISOString() ?? null,
      created_at: r.artifact.createdAt.toISOString(),
      completed_at: r.artifact.completedAt?.toISOString() ?? null,
    })),
    summary: {
      total_count: Number(summaryRow?.total_count ?? 0),
      ready_count: Number(summaryRow?.ready_count ?? 0),
      failed_count: Number(summaryRow?.failed_count ?? 0),
      total_size_bytes: Number(summaryRow?.total_size_bytes ?? 0),
      user_snapshot_count: Number(summaryRow?.user_snapshot_count ?? 0),
      operator_dr_count: Number(summaryRow?.operator_dr_count ?? 0),
    },
  });
});

// ─── GET /backup-artifacts/:id — detail ────────────────────────────────────

adminImagesApp.get('/backup-artifacts/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return errorResponse(c, 400, 'Invalid backup artifact ID');
  }

  const [artifactRow] = await db
    .select({
      artifact: backupArtifacts,
      sourceHostName: baremetalHosts.name,
      sourceHostRegion: baremetalHosts.region,
      sourceHostLocation: baremetalHosts.location,
      machineSlug: machines.slug,
      machineName: machines.name,
      machineStatus: machines.status,
      imageName: images.name,
      imageStatus: images.status,
    })
    .from(backupArtifacts)
    .leftJoin(baremetalHosts, eq(backupArtifacts.sourceHostId, baremetalHosts.id))
    .leftJoin(machines, eq(backupArtifacts.machineId, machines.id))
    .leftJoin(images, eq(backupArtifacts.imageId, images.id))
    .where(eq(backupArtifacts.id, id));

  if (!artifactRow) {
    return errorResponse(c, 404, 'Backup artifact not found');
  }

  const art = artifactRow.artifact;

  const restoreRows = await db
    .select()
    .from(restoreExecutions)
    .where(eq(restoreExecutions.artifactId, id))
    .orderBy(desc(restoreExecutions.createdAt))
    .limit(50);

  return c.json({
    artifact: {
      id: art.id,
      display_name: art.displayName ?? null,
      artifact_type: art.artifactType,
      backup_kind: art.backupKind,
      inventory_scope: art.inventoryScope,
      storage_scope: art.storageScope,
      provider: art.provider,
      provider_artifact_id: art.providerArtifactId ?? null,
      source_machine_slug: art.sourceMachineSlug ?? null,
      // storage_url may contain a signed URL with credentials. Mask it —
      // operators should not browse to this URL from the admin surface.
      storage_url: art.storageUrl ? '[redacted]' : null,
      size_bytes: art.sizeBytes ?? null,
      checksum: art.checksum ?? null,
      status: art.status,
      retention_until: art.retentionUntil?.toISOString() ?? null,
      last_verified_at: art.lastVerifiedAt?.toISOString() ?? null,
      restore_count: art.restoreCount,
      last_restore_at: art.lastRestoreAt?.toISOString() ?? null,
      created_at: art.createdAt.toISOString(),
      updated_at: art.updatedAt.toISOString(),
      completed_at: art.completedAt?.toISOString() ?? null,
    },
    source_host: art.sourceHostId ? {
      id: art.sourceHostId,
      name: artifactRow.sourceHostName ?? null,
      region: artifactRow.sourceHostRegion ?? null,
      location: artifactRow.sourceHostLocation ?? null,
    } : null,
    source_machine: art.machineId ? {
      id: art.machineId,
      slug: artifactRow.machineSlug ?? null,
      name: artifactRow.machineName ?? null,
      status: artifactRow.machineStatus ?? null,
    } : null,
    image: art.imageId ? {
      id: art.imageId,
      name: artifactRow.imageName ?? null,
      status: artifactRow.imageStatus ?? null,
    } : null,
    restore_executions: restoreRows.map((r) => ({
      id: r.id,
      status: r.status,
      execution_type: r.executionType,
      trigger_source: r.triggerSource,
      started_at: r.startedAt.toISOString(),
      completed_at: r.completedAt?.toISOString() ?? null,
      duration_ms: r.durationMs ?? null,
      requested_by_user_id: r.requestedByUserId ?? null,
      target_host_id: r.targetHostId ?? null,
      error: r.error ?? null,
    })),
  });
});
