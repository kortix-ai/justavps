import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateBillingLedger } from './aggregate.js';
import { ledgerDraftsForUsageInterval } from './ledger.js';
import { defaultBillingRates } from './prices.js';
import { buildBillingV2LedgerDrafts } from './reconcile.js';

test('Billing v2 splits actual intervals by hour and aggregates actual MTD usage', () => {
  const rates = defaultBillingRates();
  const from = new Date('2026-05-04T10:00:00.000Z');
  const to = new Date('2026-05-04T14:00:00.000Z');
  const priceVersionId = 'pv-test';
  const common = {
    accountId: 'acct_1',
    machineId: 'm1',
    sourceType: 'machine' as const,
    sourceId: 'm1',
    sourceName: 'runner-1',
    region: 'eu',
    windowFrom: from,
    windowTo: to,
    priceVersionId,
    rates,
    status: 'finalized' as const,
    measurementSource: 'test',
  };

  const rows = [
    ...ledgerDraftsForUsageInterval({ ...common, component: 'running_vcpu', start: new Date('2026-05-04T10:15:00.000Z'), end: new Date('2026-05-04T12:45:00.000Z'), units: 2 }),
    ...ledgerDraftsForUsageInterval({ ...common, component: 'running_ram', start: new Date('2026-05-04T10:15:00.000Z'), end: new Date('2026-05-04T12:45:00.000Z'), units: 4 }),
    ...ledgerDraftsForUsageInterval({ ...common, component: 'machine_disk', start: new Date('2026-05-04T10:15:00.000Z'), end: to, units: 20 }),
    ...ledgerDraftsForUsageInterval({ ...common, sourceType: 'snapshot', sourceId: 's1', machineId: 'm1', component: 'snapshot_storage', start: new Date('2026-05-04T11:00:00.000Z'), end: to, units: 5 }),
  ];

  const aggregate = aggregateBillingLedger(rows.map((row) => ({
    accountId: row.accountId,
    machineId: row.machineId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    component: row.component,
    intervalStart: row.intervalStart,
    intervalEnd: row.intervalEnd,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    microEur: row.microEur,
    status: row.status,
    measurementExact: row.measurementExact,
    metadata: row.metadata,
  })));

  const byKey = new Map(aggregate.components.map((component) => [component.key, component]));
  assert.equal(byKey.get('running_vcpu')?.quantity, 18_000);
  assert.equal(byKey.get('running_ram')?.quantity, 36_000);
  assert.equal(byKey.get('machine_disk')?.quantity, 270_000);
  assert.equal(byKey.get('snapshot_storage')?.quantity, 54_000);
  assert.equal(aggregate.hourly.length, 4);
  assert.ok(aggregate.totalMicroEur > 0n);
});

test('Billing v2 idempotency key is stable for repeated same interval', () => {
  const rates = defaultBillingRates();
  const input = {
    accountId: 'acct_1',
    machineId: 'm1',
    sourceType: 'machine' as const,
    sourceId: 'm1',
    component: 'running_vcpu' as const,
    start: new Date('2026-05-04T10:00:00.000Z'),
    end: new Date('2026-05-04T11:00:00.000Z'),
    units: 1,
    windowFrom: new Date('2026-05-04T10:00:00.000Z'),
    windowTo: new Date('2026-05-04T11:00:00.000Z'),
    priceVersionId: 'pv-test',
    rates,
    measurementSource: 'test',
  };
  const first = ledgerDraftsForUsageInterval(input)[0];
  const second = ledgerDraftsForUsageInterval(input)[0];
  assert.equal(first.idempotencyKey, second.idempotencyKey);
});

test('Billing v2 fail-closes open compute sessions at last observed timestamp', async () => {
  const from = new Date('2026-05-04T10:00:00.000Z');
  const to = new Date('2026-05-04T12:00:00.000Z');
  const lastObservedAt = new Date('2026-05-04T11:00:00.000Z');
  const prisma = mockBillingPrisma({
    machines: [machineRow({ id: 'm1', status: 'Running', resources: { vcpu: 2, memory_gb: 4, disk_gb: 20 } })],
    sessions: [sessionRow({ machineId: 'm1', startedAt: from, endedAt: null, lastObservedAt, vcpus: 2, ramGb: 4, storageGb: 20 })],
  });
  const result = await buildBillingV2LedgerDrafts(prisma as never, {
    accountId: 'acct_1',
    from,
    to,
    priceVersion: { id: 'pv-test', rates: defaultBillingRates() },
    status: 'finalized',
  });
  const aggregate = aggregateBillingLedger(result.drafts.map((row) => ({
    accountId: row.accountId,
    machineId: row.machineId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    component: row.component,
    intervalStart: row.intervalStart,
    intervalEnd: row.intervalEnd,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    microEur: row.microEur,
    status: row.status,
    measurementExact: row.measurementExact,
    metadata: row.metadata,
  })));
  const byKey = new Map(aggregate.components.map((component) => [component.key, component]));
  assert.equal(byKey.get('running_vcpu')?.quantity, 7_200);
  assert.equal(byKey.get('running_ram')?.quantity, 14_400);
  assert.equal(result.skipped.some((gap) => gap.reason.includes('only verified through')), true);
});

test('Billing v2 reports running machines without compute sessions as coverage gaps', async () => {
  const from = new Date('2026-05-04T10:00:00.000Z');
  const to = new Date('2026-05-04T11:00:00.000Z');
  const prisma = mockBillingPrisma({
    machines: [machineRow({ id: 'm1', status: 'Running', resources: { vcpu: 2, memory_gb: 4, disk_gb: 20 } })],
    sessions: [],
  });
  const result = await buildBillingV2LedgerDrafts(prisma as never, {
    accountId: 'acct_1',
    from,
    to,
    priceVersion: { id: 'pv-test', rates: defaultBillingRates() },
    status: 'finalized',
  });
  assert.equal(result.drafts.some((row) => row.component === 'running_vcpu' || row.component === 'running_ram'), false);
  assert.equal(result.skipped.some((gap) => gap.reason.includes('no open compute billing session')), true);
});

function mockBillingPrisma(input: { machines: unknown[]; sessions: unknown[] }) {
  return {
    machine: { findMany: async () => input.machines },
    sandboxUsageSession: { findMany: async () => input.sessions },
    machineTemplate: { findMany: async () => [] },
    snapshot: { findMany: async () => [] },
    backup: { findMany: async () => [] },
  };
}

function machineRow(overrides: Record<string, unknown>) {
  return {
    id: 'm1', accountId: 'acct_1', name: 'machine', region: 'eu', type: 'container', status: 'Running', sourceType: 'image', sourceId: 'ubuntu',
    incusClusterId: 'cluster', incusProject: 'default', incusInstanceName: 'm1', incusMemberName: 'node1', resources: {}, metadata: {},
    createdAt: new Date('2026-05-04T09:00:00.000Z'), updatedAt: new Date('2026-05-04T12:00:00.000Z'),
    ...overrides,
  };
}

function sessionRow(overrides: Record<string, unknown>) {
  return {
    id: 'sess1', machineId: 'm1', customerId: 'acct_1', startedAt: new Date('2026-05-04T10:00:00.000Z'), endedAt: null,
    vcpus: 2, ramGb: 4, storageGb: 20, vcpuSeconds: 0, ramGbSeconds: 0, storageGbSecondsLocal: 0, storageGbSecondsArchive: 0,
    state: 'running', lastObservedAt: new Date('2026-05-04T10:00:00.000Z'), createdAt: new Date('2026-05-04T10:00:00.000Z'), updatedAt: new Date('2026-05-04T10:00:00.000Z'),
    ...overrides,
  };
}
