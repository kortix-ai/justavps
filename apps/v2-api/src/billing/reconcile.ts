import type { Prisma, PrismaClient } from '@prisma/client';

import { ledgerDraftsForUsageInterval } from './ledger.js';
import { ratesFromPriceVersion } from './prices.js';
import type { BillingV2LedgerDraft, BillingV2RateSet } from './types.js';

const WARM_POOL_STATUSES = ['warm_pool', 'warm_pool_claiming'];

export type BillingV2ReconcileInput = {
  accountId?: string | null;
  from: Date;
  to: Date;
  priceVersion: { id: string; rates: unknown };
  status?: 'finalized' | 'unfinalized';
};

export type BillingV2ReconcileResult = {
  drafts: BillingV2LedgerDraft[];
  skipped: Array<{ source_type: string; source_id: string; reason: string }>;
};

export async function buildBillingV2LedgerDrafts(prisma: PrismaClient, input: BillingV2ReconcileInput): Promise<BillingV2ReconcileResult> {
  const rates = ratesFromPriceVersion(input.priceVersion);
  const status = input.status ?? 'finalized';
  const skipped: BillingV2ReconcileResult['skipped'] = [];
  const drafts: BillingV2LedgerDraft[] = [];
  const accountFilter = input.accountId ? { accountId: input.accountId } : {};

  const [machines, sessions, templates, snapshots, backups] = await Promise.all([
    prisma.machine.findMany({ where: { ...accountFilter, createdAt: { lt: input.to } } }),
    prisma.sandboxUsageSession.findMany({
      where: {
        startedAt: { lt: input.to },
        OR: [{ endedAt: null }, { endedAt: { gt: input.from } }],
        ...(input.accountId ? { customerId: input.accountId } : {}),
      },
    }),
    prisma.machineTemplate.findMany({
      where: {
        ...accountFilter,
        createdAt: { lt: input.to },
        status: { notIn: ['deleted', 'archived'] },
      },
    }).catch(() => []),
    prisma.snapshot.findMany({
      where: {
        ...accountFilter,
        createdAt: { lt: input.to },
        status: { notIn: ['deleted'] },
      },
    }).catch(() => []),
    prisma.backup.findMany({
      where: {
        ...accountFilter,
        createdAt: { lt: input.to },
        status: { notIn: ['deleted'] },
      },
    }).catch(() => []),
  ]);

  const machineById = new Map(machines.map((machine) => [machine.id, machine]));
  const machineByIncusName = new Map(machines.map((machine) => [machine.incusInstanceName, machine]));
  const openSessionMachineIds = new Set<string>();

  for (const session of sessions) {
    const machine = machineById.get(session.machineId) ?? machineByIncusName.get(session.machineId) ?? null;
    const accountId = session.customerId ?? machine?.accountId ?? null;
    if (!accountId || (input.accountId && input.accountId !== accountId)) continue;
    if (!session.endedAt) openSessionMachineIds.add(machine?.id ?? session.machineId);
    const verifiedThrough = session.endedAt ?? minDate(session.lastObservedAt ?? session.updatedAt ?? session.startedAt, input.to);
    if (!session.endedAt && verifiedThrough < input.to) {
      skipped.push({ source_type: 'machine', source_id: machine?.id ?? session.machineId, reason: `open compute session only verified through ${verifiedThrough.toISOString()}; unverified tail excluded` });
    }
    const end = verifiedThrough;
    if (end <= session.startedAt) continue;
    const sourceId = machine?.id ?? session.machineId;
    const machineId = machine?.id ?? session.machineId;
    const sourceName = machine?.name ?? session.machineId;
    drafts.push(...meterComputeInterval({
      accountId,
      machineId,
      sourceId,
      sourceName,
      region: machine?.region ?? null,
      start: session.startedAt,
      end,
      vcpu: session.vcpus,
      ramGb: session.ramGb,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      metadata: { session_id: session.id, source: 'sandbox_usage_sessions' },
    }));

    // Fallback only: if the product machine row is missing, preserve the old
    // running-session storage signal rather than dropping storage entirely.
    if (!machine && Number(session.storageGb) > 0) {
      drafts.push(...ledgerDraftsForUsageInterval({
        accountId,
        machineId,
        sourceType: 'machine',
        sourceId,
        sourceName,
        component: 'machine_disk',
        region: null,
        start: session.startedAt,
        end,
        units: Number(session.storageGb),
        windowFrom: input.from,
        windowTo: input.to,
        priceVersionId: input.priceVersion.id,
        rates,
        status,
        measurementSource: 'legacy_session_storage_gb',
        measurementExact: false,
        metadata: { session_id: session.id, source: 'sandbox_usage_sessions_fallback' },
      }));
    }
  }

  for (const machine of machines) {
    if (WARM_POOL_STATUSES.includes(machine.status)) {
      appendWarmPoolDrafts(drafts, skipped, machine, input, rates, status);
      continue;
    }
    if (String(machine.status).toLowerCase() === 'running' && !openSessionMachineIds.has(machine.id)) {
      skipped.push({ source_type: 'machine', source_id: machine.id, reason: 'machine is marked Running but has no open compute billing session; running vCPU/RAM excluded fail-closed' });
    }
    if (machine.status === 'deleted' && machine.updatedAt <= input.from) continue;
    const resources = resourceShape(machine.resources);
    if (resources.disk_gb <= 0) {
      skipped.push({ source_type: 'machine', source_id: machine.id, reason: 'machine disk_gb missing or zero' });
      continue;
    }
    const end = machine.status === 'deleted' ? machine.updatedAt : input.to;
    drafts.push(...ledgerDraftsForUsageInterval({
      accountId: machine.accountId,
      machineId: machine.id,
      sourceType: 'machine',
      sourceId: machine.id,
      sourceName: machine.name,
      component: 'machine_disk',
      region: machine.region,
      start: machine.createdAt,
      end,
      units: resources.disk_gb,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      measurementSource: 'provisioned_disk_limit',
      measurementExact: true,
      metadata: { machine_name: machine.name, source: 'v2_core.machines.resources' },
    }));
  }

  for (const template of templates) {
    const gib = decimalNumber(template.billableGib);
    if (!gib || gib <= 0) {
      skipped.push({ source_type: 'template', source_id: template.id, reason: 'template billable_gib missing' });
      continue;
    }
    drafts.push(...ledgerDraftsForUsageInterval({
      accountId: template.accountId,
      machineId: null,
      sourceType: 'template',
      sourceId: template.id,
      sourceName: template.name,
      component: 'template_storage',
      region: template.region,
      start: template.preparedAt ?? template.createdAt,
      end: input.to,
      units: gib,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      measurementSource: 'incus_image_size',
      measurementExact: true,
      metadata: { template_name: template.name, source: 'v2_core.machine_templates.billable_gib' },
    }));
  }

  for (const snapshot of snapshots) {
    const gib = storageGibFromJson(snapshot.metadata);
    if (!gib || gib <= 0) {
      skipped.push({ source_type: 'snapshot', source_id: snapshot.id, reason: 'snapshot exact storage measurement missing' });
      continue;
    }
    drafts.push(...ledgerDraftsForUsageInterval({
      accountId: snapshot.accountId,
      machineId: snapshot.machineId,
      sourceType: 'snapshot',
      sourceId: snapshot.id,
      sourceName: snapshot.name,
      component: 'snapshot_storage',
      region: null,
      start: snapshot.createdAt,
      end: input.to,
      units: gib,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      measurementSource: 'snapshot_metadata_storage',
      measurementExact: true,
      metadata: { name: snapshot.name, source: 'v2_core.snapshots.metadata' },
    }));
  }

  for (const backup of backups) {
    const gib = storageGibFromJson(backup.metadata);
    if (!gib || gib <= 0) {
      skipped.push({ source_type: 'backup', source_id: backup.id, reason: 'backup exact storage measurement missing' });
      continue;
    }
    drafts.push(...ledgerDraftsForUsageInterval({
      accountId: backup.accountId,
      machineId: backup.machineId,
      sourceType: 'backup',
      sourceId: backup.id,
      sourceName: backup.incusBackupName ?? backup.id,
      component: 'backup_storage',
      region: null,
      start: backup.createdAt,
      end: input.to,
      units: gib,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      measurementSource: 'backup_metadata_storage',
      measurementExact: true,
      metadata: { name: backup.incusBackupName ?? backup.id, source: 'v2_core.backups.metadata' },
    }));
  }

  return { drafts, skipped };
}

export async function writeBillingV2LedgerDrafts(prisma: PrismaClient, drafts: BillingV2LedgerDraft[]) {
  let inserted = 0;
  let updated = 0;
  for (const draft of drafts) {
    const row = await prisma.billingLedgerEntry.upsert({
      where: { idempotencyKey: draft.idempotencyKey },
      create: {
        accountId: draft.accountId,
        machineId: draft.machineId,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        component: draft.component,
        region: draft.region,
        intervalStart: draft.intervalStart,
        intervalEnd: draft.intervalEnd,
        quantity: draft.quantity.toFixed(9),
        quantityUnit: draft.quantityUnit,
        rateMicroEurPerUnit: draft.rateMicroEurPerUnit.toFixed(9),
        priceVersionId: draft.priceVersionId,
        microEur: draft.microEur,
        status: draft.status,
        measurementSource: draft.measurementSource,
        measurementExact: draft.measurementExact,
        idempotencyKey: draft.idempotencyKey,
        metadata: draft.metadata as Prisma.InputJsonValue,
      },
      update: {
        status: draft.status === 'finalized' ? 'finalized' : undefined,
      },
    });
    if (row.createdAt.getTime() > Date.now() - 30_000) inserted += 1;
    else updated += 1;
  }
  return { written: drafts.length, inserted, updated };
}

function meterComputeInterval(input: {
  accountId: string;
  machineId: string;
  sourceId: string;
  sourceName: string;
  region: string | null;
  start: Date;
  end: Date;
  vcpu: number;
  ramGb: number;
  windowFrom: Date;
  windowTo: Date;
  priceVersionId: string;
  rates: BillingV2RateSet;
  status: 'finalized' | 'unfinalized';
  metadata: Record<string, unknown>;
}) {
  return [
    ...ledgerDraftsForUsageInterval({
      accountId: input.accountId,
      machineId: input.machineId,
      sourceType: 'machine',
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      component: 'running_vcpu',
      region: input.region,
      start: input.start,
      end: input.end,
      units: Number(input.vcpu),
      windowFrom: input.windowFrom,
      windowTo: input.windowTo,
      priceVersionId: input.priceVersionId,
      rates: input.rates,
      status: input.status,
      measurementSource: 'sandbox_usage_session',
      measurementExact: true,
      metadata: input.metadata,
    }),
    ...ledgerDraftsForUsageInterval({
      accountId: input.accountId,
      machineId: input.machineId,
      sourceType: 'machine',
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      component: 'running_ram',
      region: input.region,
      start: input.start,
      end: input.end,
      units: Number(input.ramGb),
      windowFrom: input.windowFrom,
      windowTo: input.windowTo,
      priceVersionId: input.priceVersionId,
      rates: input.rates,
      status: input.status,
      measurementSource: 'sandbox_usage_session',
      measurementExact: true,
      metadata: input.metadata,
    }),
  ];
}

function appendWarmPoolDrafts(
  drafts: BillingV2LedgerDraft[],
  skipped: BillingV2ReconcileResult['skipped'],
  machine: Awaited<ReturnType<PrismaClient['machine']['findMany']>>[number],
  input: BillingV2ReconcileInput,
  rates: BillingV2RateSet,
  status: 'finalized' | 'unfinalized',
) {
  const metadata = jsonRecord(machine.metadata);
  const warmPool = jsonRecord(metadata.warm_pool);
  const storageUsage = jsonRecord(warmPool.storage_usage);
  const billableGib = numberFromUnknown(storageUsage.billable_gib) ?? numberFromUnknown(storageUsage.billable_gib_exact);
  if (billableGib && billableGib > 0 && storageUsage.estimated !== true) {
    drafts.push(...ledgerDraftsForUsageInterval({
      accountId: machine.accountId,
      machineId: machine.id,
      sourceType: 'warm_pool',
      sourceId: String(warmPool.policy_id ?? machine.id),
      sourceName: machine.name,
      component: 'warm_pool_storage',
      region: machine.region,
      start: machine.createdAt,
      end: input.to,
      units: billableGib,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      measurementSource: 'incus_storage_volume_state',
      measurementExact: true,
      metadata: { machine_name: machine.name, policy_id: warmPool.policy_id ?? null, source: 'machine.metadata.warm_pool.storage_usage' },
    }));
  } else {
    skipped.push({ source_type: 'warm_pool', source_id: machine.id, reason: 'warm pool exact storage measurement missing' });
  }

  const poolMode = String(warmPool.mode ?? warmPool.pool_mode ?? '').toLowerCase();
  if (poolMode.includes('running')) {
    const resources = resourceShape(machine.resources);
    drafts.push(...ledgerDraftsForUsageInterval({
      accountId: machine.accountId,
      machineId: machine.id,
      sourceType: 'warm_pool',
      sourceId: String(warmPool.policy_id ?? machine.id),
      sourceName: machine.name,
      component: 'warm_pool_running_vcpu',
      region: machine.region,
      start: machine.createdAt,
      end: input.to,
      units: resources.vcpu,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      measurementSource: 'warm_pool_running_mode',
      measurementExact: true,
      metadata: { machine_name: machine.name, policy_id: warmPool.policy_id ?? null },
    }));
    drafts.push(...ledgerDraftsForUsageInterval({
      accountId: machine.accountId,
      machineId: machine.id,
      sourceType: 'warm_pool',
      sourceId: String(warmPool.policy_id ?? machine.id),
      sourceName: machine.name,
      component: 'warm_pool_running_ram',
      region: machine.region,
      start: machine.createdAt,
      end: input.to,
      units: resources.memory_gb,
      windowFrom: input.from,
      windowTo: input.to,
      priceVersionId: input.priceVersion.id,
      rates,
      status,
      measurementSource: 'warm_pool_running_mode',
      measurementExact: true,
      metadata: { machine_name: machine.name, policy_id: warmPool.policy_id ?? null },
    }));
  }
}

function resourceShape(value: unknown) {
  const record = jsonRecord(value);
  return {
    vcpu: positiveNumber(record.vcpu),
    memory_gb: positiveNumber(record.memory_gb ?? record.memoryGb ?? record.ram_gb),
    disk_gb: positiveNumber(record.disk_gb ?? record.diskGb ?? record.storage_gb),
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function numberFromUnknown(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b;
}

function decimalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function storageGibFromJson(value: unknown): number | null {
  const record = jsonRecord(value);
  const direct = numberFromUnknown(record.billable_gib ?? record.storage_gib ?? record.gib);
  if (direct) return direct;
  const measuredBytes = numberFromUnknown(record.metered_bytes ?? record.measured_bytes ?? record.bytes);
  if (measuredBytes) return measuredBytes / 1024 ** 3;
  const storage = jsonRecord(record.storage);
  const storageDirect = numberFromUnknown(storage.billable_gib ?? storage.storage_gib ?? storage.gib);
  if (storageDirect) return storageDirect;
  return null;
}
