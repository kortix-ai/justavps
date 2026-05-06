/**
 * Admin Activity Timeline — unified cross-cutting event feed for incident
 * response. Operators otherwise have to hop between Machines, Procurements,
 * Webhooks, Hosts, and Backup/Restore surfaces to trace what happened during
 * an incident; this endpoint consolidates every source into a single merged,
 * filterable timeline.
 *
 * Design:
 *  - Read-only, admin-gated (mirrors the apiGuard + requireAdmin pattern of
 *    `admin-webhooks.ts` / `admin-images.ts`).
 *  - One small, time-windowed SELECT per source (up to 7). We DO NOT union
 *    them in SQL — the rows have incompatible shapes. Instead, we merge in
 *    memory, sort by occurred_at desc, slice to limit/offset, compute
 *    aggregates. Memory cost is bounded by ~ limit * 2 per-source overfetch.
 *  - `source='all'` runs every query; a specific source runs only the matching
 *    one. This keeps query fan-out bounded even at 15s refetch intervals in
 *    the UI.
 *  - Timestamps normalized to ISO strings.
 *  - Severity heuristic applied in-memory; does not rely on denormalized
 *    columns so we don't have to evolve the schema.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, gte, lte, ilike, or, sql, desc, isNotNull } from 'drizzle-orm';
import { db } from '@/server/db';
import {
  machines,
  machineEvents,
  baremetalHosts,
  baremetalProcurements,
  backupArtifacts,
  restoreExecutions,
  webhooks,
  webhookDeliveries,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from '@/server/auth/api-guard';
import { errorResponse } from '@/server/core/route-helpers';

export const adminActivityApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminActivityApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
}

// ─── Types ─────────────────────────────────────────────────────────────────

type ActivitySource =
  | 'machine'
  | 'procurement'
  | 'webhook'
  | 'restore'
  | 'maintenance'
  | 'backup'
  | 'bootstrap_validation';

type ActivitySeverity = 'info' | 'warn' | 'error';

type ActivityEvent = {
  id: string;
  source: ActivitySource;
  event_type: string;
  subject: Record<string, unknown>;
  message: string;
  metadata: Record<string, unknown>;
  occurred_at: string; // ISO
  severity: ActivitySeverity;
};

const ALL_SOURCES: ActivitySource[] = [
  'machine',
  'procurement',
  'webhook',
  'restore',
  'maintenance',
  'backup',
  'bootstrap_validation',
];

const SOURCE_QUERY_PARAM_MAP: Record<string, ActivitySource | 'all'> = {
  all: 'all',
  machines: 'machine',
  procurements: 'procurement',
  webhooks: 'webhook',
  restores: 'restore',
  maintenance: 'maintenance',
  backups: 'backup',
  bootstrap_validations: 'bootstrap_validation',
};

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function parseIsoOr(raw: string | undefined, fallback: Date): Date | null {
  if (!raw) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function iso(d: Date | null | undefined): string {
  if (!d) return new Date(0).toISOString();
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/** Derives the row severity from a status / event_type string. */
function severityFor(...candidates: Array<string | null | undefined>): ActivitySeverity {
  const s = candidates
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map((x) => x.toLowerCase())
    .join(' ');
  if (!s) return 'info';
  if (
    /\berror(ed)?\b/.test(s) ||
    /\bfailed?\b/.test(s) ||
    /\bfailure\b/.test(s) ||
    /\bdead[_-]?lettered\b/.test(s) ||
    /\bcancelled\b/.test(s) ||
    /\bincomplete\b/.test(s) ||
    /\bdead\b/.test(s)
  ) {
    return 'error';
  }
  if (
    /\bwarn(ing)?\b/.test(s) ||
    /\bdrift\b/.test(s) ||
    /\bdegraded\b/.test(s) ||
    /\bstale\b/.test(s) ||
    /\bretry(ing)?\b/.test(s) ||
    /\bdraining\b/.test(s) ||
    /\bmaintenance\b/.test(s)
  ) {
    return 'warn';
  }
  return 'info';
}

function truncate(s: string | null | undefined, n = 240): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function matchesQ(q: string | null, fields: Array<string | null | undefined>) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(needle));
}

// ─── Per-source loaders ────────────────────────────────────────────────────
//
// Each loader returns a normalized ActivityEvent[] scoped to [since, until].
// We overfetch (limit * 2) per source so that after merging and offset-
// slicing the page is still well populated. The UI talks in total = raw
// count across the filtered window; we provide that separately.

async function loadMachineEvents(
  since: Date,
  until: Date,
  q: string | null,
  limit: number,
): Promise<ActivityEvent[]> {
  const conds = [
    gte(machineEvents.createdAt, since),
    lte(machineEvents.createdAt, until),
  ];
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        ilike(machineEvents.message, pat),
        ilike(machineEvents.event, pat),
        ilike(machineEvents.stage, pat),
        ilike(machines.slug, pat),
        ilike(machines.name, pat),
      )! as unknown as ReturnType<typeof eq>,
    );
  }
  const rows = await db
    .select({
      id: machineEvents.id,
      machineId: machineEvents.machineId,
      event: machineEvents.event,
      stage: machineEvents.stage,
      message: machineEvents.message,
      metadata: machineEvents.metadata,
      createdAt: machineEvents.createdAt,
      machineSlug: machines.slug,
      machineName: machines.name,
    })
    .from(machineEvents)
    .leftJoin(machines, eq(machineEvents.machineId, machines.id))
    .where(and(...conds))
    .orderBy(desc(machineEvents.createdAt))
    .limit(limit);

  return rows.map((r): ActivityEvent => {
    const eventType = r.stage ? `${r.event}:${r.stage}` : r.event;
    return {
      id: `machine:${r.id}:${iso(r.createdAt)}`,
      source: 'machine',
      event_type: eventType,
      subject: {
        machine_id: r.machineId,
        slug: r.machineSlug ?? null,
        name: r.machineName ?? null,
      },
      message: r.message ?? `${r.event}${r.stage ? ` (${r.stage})` : ''}`,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      occurred_at: iso(r.createdAt),
      severity: severityFor(r.event, r.stage, r.message),
    };
  });
}

async function loadProcurements(
  since: Date,
  until: Date,
  q: string | null,
  limit: number,
): Promise<ActivityEvent[]> {
  // We emit one row per (id, status, updated_at) — the unique tuple. The
  // procurement table doesn't record a per-transition audit log, so the best
  // we can do is surface the current row whenever updated_at lands in range.
  const conds = [
    gte(baremetalProcurements.updatedAt, since),
    lte(baremetalProcurements.updatedAt, until),
  ];
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        ilike(baremetalProcurements.productId, pat),
        ilike(baremetalProcurements.location, pat),
        ilike(baremetalProcurements.hostClass, pat),
        ilike(baremetalProcurements.region, pat),
        ilike(baremetalProcurements.error, pat),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const rows = await db
    .select()
    .from(baremetalProcurements)
    .where(and(...conds))
    .orderBy(desc(baremetalProcurements.updatedAt))
    .limit(limit);

  return rows.map((r): ActivityEvent => {
    const message =
      r.error
        ? `Procurement ${r.status}: ${truncate(r.error, 200)}`
        : `Procurement transitioned to ${r.status} (${r.productId} @ ${r.location})`;
    return {
      id: `procurement:${r.id}:${iso(r.updatedAt)}`,
      source: 'procurement',
      event_type: `status_${r.status}`,
      subject: {
        procurement_id: r.id,
        product_id: r.productId,
        location: r.location,
        host_class: r.hostClass,
        region: r.region,
        host_id: r.hostId ?? null,
      },
      message,
      metadata: {
        vendor: r.vendor,
        requires_approval: r.requiresApproval,
        error: r.error ?? null,
        ordered_at: r.orderedAt ? iso(r.orderedAt) : null,
        resolved_at: r.resolvedAt ? iso(r.resolvedAt) : null,
      },
      occurred_at: iso(r.updatedAt),
      severity: severityFor(r.status, r.error),
    };
  });
}

async function loadWebhookDeliveries(
  since: Date,
  until: Date,
  q: string | null,
  limit: number,
): Promise<ActivityEvent[]> {
  const conds = [
    gte(webhookDeliveries.createdAt, since),
    lte(webhookDeliveries.createdAt, until),
  ];
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        ilike(webhookDeliveries.eventType, pat),
        ilike(webhookDeliveries.error, pat),
        ilike(webhooks.url, pat),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const rows = await db
    .select({
      delivery: webhookDeliveries,
      webhookUrl: webhooks.url,
    })
    .from(webhookDeliveries)
    .leftJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(and(...conds))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);

  return rows.map((r): ActivityEvent => {
    const d = r.delivery;
    const status = d.deadLetteredAt
      ? 'dead_lettered'
      : d.success
        ? 'delivered'
        : d.status === 'queued'
          ? 'queued'
          : 'failed';
    const statusPart = d.statusCode != null ? ` (HTTP ${d.statusCode})` : '';
    const errPart = d.error ? ` — ${truncate(d.error, 160)}` : '';
    return {
      id: `webhook:${d.id}:${iso(d.createdAt)}`,
      source: 'webhook',
      event_type: `delivery_${status}`,
      subject: {
        webhook_id: d.webhookId,
        webhook_url: r.webhookUrl ?? null,
        delivery_id: d.id,
      },
      message: `${d.eventType} → ${status}${statusPart}${errPart}`,
      // Intentionally NOT including raw payload bytes — see contract.
      metadata: {
        status,
        status_code: d.statusCode ?? null,
        attempt: d.attempt,
        duration_ms: d.durationMs ?? null,
        error: d.error ?? null,
        event_type: d.eventType,
        delivered_at: d.deliveredAt ? iso(d.deliveredAt) : null,
        dead_lettered_at: d.deadLetteredAt ? iso(d.deadLetteredAt) : null,
      },
      occurred_at: iso(d.createdAt),
      severity: severityFor(status, d.error),
    };
  });
}

async function loadRestores(
  since: Date,
  until: Date,
  q: string | null,
  limit: number,
): Promise<ActivityEvent[]> {
  const conds = [
    gte(restoreExecutions.createdAt, since),
    lte(restoreExecutions.createdAt, until),
  ];
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        ilike(restoreExecutions.error, pat),
        ilike(restoreExecutions.executionType, pat),
        ilike(restoreExecutions.triggerSource, pat),
      )! as unknown as ReturnType<typeof eq>,
    );
  }
  const rows = await db
    .select()
    .from(restoreExecutions)
    .where(and(...conds))
    .orderBy(desc(restoreExecutions.createdAt))
    .limit(limit);

  return rows.map((r): ActivityEvent => {
    const durPart = r.durationMs != null ? ` in ${r.durationMs}ms` : '';
    const errPart = r.error ? ` — ${truncate(r.error, 160)}` : '';
    const occurred = r.completedAt ?? r.updatedAt ?? r.createdAt;
    return {
      id: `restore:${r.id}:${iso(occurred)}`,
      source: 'restore',
      event_type: `restore_${r.status}`,
      subject: {
        artifact_id: r.artifactId,
        machine_id: r.machineId,
        target_host_id: r.targetHostId,
        source_host_id: r.sourceHostId,
      },
      message: `Restore (${r.executionType}, ${r.triggerSource}) → ${r.status}${durPart}${errPart}`,
      metadata: {
        status: r.status,
        execution_type: r.executionType,
        trigger_source: r.triggerSource,
        duration_ms: r.durationMs ?? null,
        error: r.error ?? null,
        started_at: iso(r.startedAt),
        completed_at: r.completedAt ? iso(r.completedAt) : null,
      },
      occurred_at: iso(occurred),
      severity: severityFor(r.status, r.error),
    };
  });
}

async function loadMaintenanceEvents(
  since: Date,
  until: Date,
  q: string | null,
  limit: number,
): Promise<ActivityEvent[]> {
  // We want to surface each phase (requested / started / completed) as a
  // separate timeline entry when its timestamp falls inside [since, until].
  // Drizzle can't easily express an OR of three time ranges in a way that
  // still lets us order on a computed column, so we widen the query to any
  // host that had any maintenance timestamp touch the window, then filter +
  // expand per phase in memory.
  const conds = [
    or(
      and(
        isNotNull(baremetalHosts.maintenanceRequestedAt),
        gte(baremetalHosts.maintenanceRequestedAt, since),
        lte(baremetalHosts.maintenanceRequestedAt, until),
      ),
      and(
        isNotNull(baremetalHosts.maintenanceStartedAt),
        gte(baremetalHosts.maintenanceStartedAt, since),
        lte(baremetalHosts.maintenanceStartedAt, until),
      ),
      and(
        isNotNull(baremetalHosts.maintenanceCompletedAt),
        gte(baremetalHosts.maintenanceCompletedAt, since),
        lte(baremetalHosts.maintenanceCompletedAt, until),
      ),
    )!,
  ];
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        ilike(baremetalHosts.name, pat),
        ilike(baremetalHosts.region, pat),
        ilike(baremetalHosts.location, pat),
        ilike(baremetalHosts.maintenanceState, pat),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const rows = await db
    .select({
      id: baremetalHosts.id,
      name: baremetalHosts.name,
      region: baremetalHosts.region,
      location: baremetalHosts.location,
      maintenanceState: baremetalHosts.maintenanceState,
      maintenanceRequestedAt: baremetalHosts.maintenanceRequestedAt,
      maintenanceStartedAt: baremetalHosts.maintenanceStartedAt,
      maintenanceCompletedAt: baremetalHosts.maintenanceCompletedAt,
    })
    .from(baremetalHosts)
    .where(and(...conds))
    .orderBy(desc(baremetalHosts.updatedAt))
    .limit(limit);

  const events: ActivityEvent[] = [];
  for (const r of rows) {
    const emit = (state: 'requested' | 'started' | 'completed', at: Date) => {
      if (at < since || at > until) return;
      events.push({
        id: `maintenance:${r.id}:${state}:${iso(at)}`,
        source: 'maintenance',
        event_type: `maintenance_${state}`,
        subject: {
          host_id: r.id,
          host_name: r.name,
          region: r.region,
          location: r.location,
        },
        message: `Host ${r.name} maintenance ${state} (state=${r.maintenanceState})`,
        metadata: {
          maintenance_state: r.maintenanceState,
          requested_at: r.maintenanceRequestedAt ? iso(r.maintenanceRequestedAt) : null,
          started_at: r.maintenanceStartedAt ? iso(r.maintenanceStartedAt) : null,
          completed_at: r.maintenanceCompletedAt ? iso(r.maintenanceCompletedAt) : null,
        },
        occurred_at: iso(at),
        severity: severityFor(`maintenance_${state}`, r.maintenanceState),
      });
    };
    if (r.maintenanceRequestedAt) emit('requested', r.maintenanceRequestedAt);
    if (r.maintenanceStartedAt) emit('started', r.maintenanceStartedAt);
    if (r.maintenanceCompletedAt) emit('completed', r.maintenanceCompletedAt);
  }
  return events;
}

async function loadBackups(
  since: Date,
  until: Date,
  q: string | null,
  limit: number,
): Promise<ActivityEvent[]> {
  // Fire events on (a) creation — row inserted with status=creating — and
  // (b) completion — completed_at set (status ready/failed). Match either
  // timestamp against the window.
  const conds = [
    or(
      and(
        gte(backupArtifacts.createdAt, since),
        lte(backupArtifacts.createdAt, until),
      ),
      and(
        isNotNull(backupArtifacts.completedAt),
        gte(backupArtifacts.completedAt, since),
        lte(backupArtifacts.completedAt, until),
      ),
    )!,
  ];
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        ilike(backupArtifacts.displayName, pat),
        ilike(backupArtifacts.sourceMachineSlug, pat),
        ilike(backupArtifacts.status, pat),
        ilike(backupArtifacts.artifactType, pat),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  const rows = await db
    .select()
    .from(backupArtifacts)
    .where(and(...conds))
    .orderBy(desc(backupArtifacts.updatedAt))
    .limit(limit);

  const events: ActivityEvent[] = [];
  for (const r of rows) {
    // Creation event
    if (r.createdAt >= since && r.createdAt <= until) {
      events.push({
        id: `backup:${r.id}:created:${iso(r.createdAt)}`,
        source: 'backup',
        event_type: 'backup_creating',
        subject: {
          artifact_id: r.id,
          machine_slug: r.sourceMachineSlug ?? null,
          host_id: r.sourceHostId ?? null,
        },
        message: `Backup ${r.artifactType} ${r.displayName ?? r.id} creating`,
        metadata: {
          status: r.status,
          backup_kind: r.backupKind,
          inventory_scope: r.inventoryScope,
          storage_scope: r.storageScope,
          provider: r.provider,
          size_bytes: r.sizeBytes ?? null,
        },
        occurred_at: iso(r.createdAt),
        severity: 'info',
      });
    }
    // Completion event — only when we have a completedAt and it's in-range
    if (r.completedAt && r.completedAt >= since && r.completedAt <= until) {
      events.push({
        id: `backup:${r.id}:${r.status}:${iso(r.completedAt)}`,
        source: 'backup',
        event_type: `backup_${r.status}`,
        subject: {
          artifact_id: r.id,
          machine_slug: r.sourceMachineSlug ?? null,
          host_id: r.sourceHostId ?? null,
        },
        message: `Backup ${r.displayName ?? r.id} → ${r.status}`,
        metadata: {
          status: r.status,
          backup_kind: r.backupKind,
          size_bytes: r.sizeBytes ?? null,
          checksum: r.checksum ?? null,
        },
        occurred_at: iso(r.completedAt),
        severity: severityFor(r.status),
      });
    }
  }
  return events;
}

async function loadBootstrapValidations(
  since: Date,
  until: Date,
  q: string | null,
  limit: number,
): Promise<ActivityEvent[]> {
  // Validation artifacts live inside baremetal_hosts.metadata. We pull rows
  // whose metadata.bootstrap.validation_artifact.completed_at falls inside
  // the window. We can't easily index on a JSON path so this is a bounded
  // scan — the caller must provide a narrow `since` (default 24h) and we
  // hard-limit the row count.
  const rows = await db
    .select({
      id: baremetalHosts.id,
      name: baremetalHosts.name,
      region: baremetalHosts.region,
      metadata: baremetalHosts.metadata,
    })
    .from(baremetalHosts)
    .where(sql`${baremetalHosts.metadata}->'bootstrap'->'validation_artifact' is not null`)
    .limit(limit * 4);

  const events: ActivityEvent[] = [];
  for (const r of rows) {
    const artifact = (r.metadata as Record<string, unknown> | null)?.bootstrap as
      | { validation_artifact?: { completed_at?: string; status?: string; notes?: string[] } }
      | undefined;
    const va = artifact?.validation_artifact;
    if (!va?.completed_at) continue;
    const completed = new Date(va.completed_at);
    if (Number.isNaN(completed.getTime())) continue;
    if (completed < since || completed > until) continue;
    if (q) {
      if (!matchesQ(q, [r.name, r.region, va.status, ...(va.notes ?? [])])) continue;
    }
    const note0 = va.notes && va.notes.length > 0 ? va.notes[0] : null;
    events.push({
      id: `bootstrap_validation:${r.id}:${va.completed_at}`,
      source: 'bootstrap_validation',
      event_type: `validation_${va.status ?? 'unknown'}`,
      subject: {
        host_id: r.id,
        host_name: r.name,
        region: r.region,
      },
      message: `Bootstrap validation ${va.status ?? 'unknown'}${note0 ? ` — ${truncate(note0, 200)}` : ''}`,
      metadata: {
        status: va.status ?? null,
        notes: va.notes ?? [],
      },
      occurred_at: completed.toISOString(),
      severity: severityFor(va.status),
    });
  }
  return events;
}

// ─── Endpoint ──────────────────────────────────────────────────────────────

adminActivityApp.get('/', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const now = new Date();
  const defaultSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const sinceInput = parseIsoOr(c.req.query('since'), defaultSince);
  const untilInput = parseIsoOr(c.req.query('until'), now);
  if (!sinceInput) return errorResponse(c, 400, 'Invalid since timestamp');
  if (!untilInput) return errorResponse(c, 400, 'Invalid until timestamp');
  if (sinceInput > untilInput) {
    return errorResponse(c, 400, 'since must be <= until');
  }

  const q = (c.req.query('q') || '').trim() || null;

  const sourceRaw = (c.req.query('source') || 'all').trim();
  const source = SOURCE_QUERY_PARAM_MAP[sourceRaw];
  if (!source) {
    return errorResponse(c, 400, `Invalid source; expected one of all|machines|procurements|webhooks|restores|maintenance|backups|bootstrap_validations`);
  }

  const limit = parseLimit(c.req.query('limit'), 100, 500);
  const offset = parseOffset(c.req.query('offset'));

  // Per-source over-fetch: ensure we have enough rows after merge + slice.
  const perSourceLimit = Math.min(500, Math.max(limit + offset + 20, limit * 2));

  const want = (s: ActivitySource) => source === 'all' || source === s;

  const tasks: Array<Promise<ActivityEvent[]>> = [];
  if (want('machine')) tasks.push(loadMachineEvents(sinceInput, untilInput, q, perSourceLimit));
  if (want('procurement')) tasks.push(loadProcurements(sinceInput, untilInput, q, perSourceLimit));
  if (want('webhook')) tasks.push(loadWebhookDeliveries(sinceInput, untilInput, q, perSourceLimit));
  if (want('restore')) tasks.push(loadRestores(sinceInput, untilInput, q, perSourceLimit));
  if (want('maintenance')) tasks.push(loadMaintenanceEvents(sinceInput, untilInput, q, perSourceLimit));
  if (want('backup')) tasks.push(loadBackups(sinceInput, untilInput, q, perSourceLimit));
  if (want('bootstrap_validation')) tasks.push(loadBootstrapValidations(sinceInput, untilInput, q, perSourceLimit));

  const results = await Promise.all(tasks);
  const all: ActivityEvent[] = results.flat();

  // Optional post-load subject/message fuzzy match. The per-source queries
  // already narrow on fields they own; this catches query terms that only
  // match the normalized subject (e.g. a machine slug matched against a
  // webhook event that referenced it).
  const filtered = q
    ? all.filter((e) =>
        matchesQ(q, [
          e.event_type,
          e.message,
          ...Object.values(e.subject).map((v) => (typeof v === 'string' ? v : null)),
        ]),
      )
    : all;

  filtered.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  const total = filtered.length;

  const counts_by_source: Record<string, number> = {};
  const counts_by_severity: Record<string, number> = { info: 0, warn: 0, error: 0 };
  for (const s of ALL_SOURCES) counts_by_source[s] = 0;
  for (const e of filtered) {
    counts_by_source[e.source] = (counts_by_source[e.source] ?? 0) + 1;
    counts_by_severity[e.severity] = (counts_by_severity[e.severity] ?? 0) + 1;
  }

  const events = filtered.slice(offset, offset + limit);

  return c.json({
    total,
    events,
    summary: {
      counts_by_source,
      counts_by_severity,
      time_range: {
        since: sinceInput.toISOString(),
        until: untilInput.toISOString(),
      },
    },
  });
});
