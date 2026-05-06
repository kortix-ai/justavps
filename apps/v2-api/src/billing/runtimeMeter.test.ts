import assert from 'node:assert/strict';
import test from 'node:test';

import { recordBillingRuntimeObservation } from './runtimeMeter.js';

test('billing runtime meter opens, extends, and closes a verified running session', async () => {
  const prisma = new MemoryBillingPrisma();
  const t0 = new Date('2026-05-04T10:00:00.000Z');
  const t1 = new Date('2026-05-04T10:05:00.000Z');
  const t2 = new Date('2026-05-04T10:07:00.000Z');

  await recordBillingRuntimeObservation(prisma as never, observation('Running', t0));
  assert.equal(prisma.sessions.length, 1);
  assert.equal(prisma.sessions[0].startedAt.toISOString(), t0.toISOString());
  assert.equal(prisma.sessions[0].lastObservedAt.toISOString(), t0.toISOString());

  await recordBillingRuntimeObservation(prisma as never, observation('Running', t1));
  assert.equal(prisma.sessions.length, 1);
  assert.equal(prisma.sessions[0].lastObservedAt.toISOString(), t1.toISOString());
  assert.equal(prisma.sessions[0].endedAt, null);

  await recordBillingRuntimeObservation(prisma as never, observation('Stopped', t2));
  const endedAt = prisma.sessions[0].endedAt as Date | null;
  assert.ok(endedAt);
  assert.equal(endedAt.toISOString(), t2.toISOString());
  assert.equal(prisma.sessions[0].state, 'stopped');
});

test('billing runtime meter splits a running session exactly on resize', async () => {
  const prisma = new MemoryBillingPrisma();
  const t0 = new Date('2026-05-04T10:00:00.000Z');
  const t1 = new Date('2026-05-04T10:03:00.000Z');

  await recordBillingRuntimeObservation(prisma as never, observation('Running', t0, { vcpu: 1, ramGb: 2, storageGb: 10 }));
  await recordBillingRuntimeObservation(prisma as never, observation('Running', t1, { vcpu: 2, ramGb: 4, storageGb: 20 }));

  assert.equal(prisma.sessions.length, 2);
  assert.equal(prisma.sessions[0].endedAt?.toISOString(), t1.toISOString());
  assert.equal(prisma.sessions[0].state, 'resized');
  assert.equal(prisma.sessions[1].startedAt.toISOString(), t1.toISOString());
  assert.equal(prisma.sessions[1].vcpus, 2);
  assert.equal(prisma.sessions[1].ramGb, 4);
  assert.equal(prisma.sessions[1].storageGb, 20);
});

function observation(status: string, observedAt: Date, resources = { vcpu: 2, ramGb: 4, storageGb: 20 }) {
  return {
    machineId: 'm1',
    accountId: 'acct_1',
    status,
    resources,
    observedAt,
    source: 'test',
  };
}

type MemorySession = {
  id: string;
  machineId: string;
  customerId: string | null;
  vcpus: number;
  ramGb: number;
  storageGb: number;
  startedAt: Date;
  endedAt: Date | null;
  state: string;
  lastObservedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

class MemoryBillingPrisma {
  sessions: MemorySession[] = [];
  measurements: unknown[] = [];
  seq = 0;

  billingMeasurement = {
    create: async ({ data }: { data: unknown }) => {
      this.measurements.push(data);
      return data;
    },
  };

  sandboxUsageSession = {
    findMany: async ({ where }: { where: { machineId: string; state?: string; endedAt?: null } }) => this.sessions.filter((session) => (
      session.machineId === where.machineId
      && (where.state === undefined || session.state === where.state)
      && (where.endedAt !== null || session.endedAt === null)
    )),
    create: async ({ data }: { data: Partial<MemorySession> }) => {
      const now = new Date();
      const row: MemorySession = {
        id: `sess-${++this.seq}`,
        machineId: data.machineId!,
        customerId: data.customerId ?? null,
        vcpus: data.vcpus!,
        ramGb: data.ramGb!,
        storageGb: data.storageGb!,
        startedAt: data.startedAt!,
        endedAt: data.endedAt ?? null,
        state: data.state ?? 'running',
        lastObservedAt: data.lastObservedAt ?? data.startedAt!,
        createdAt: now,
        updatedAt: now,
      };
      this.sessions.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<MemorySession> }) => {
      const row = this.sessions.find((session) => session.id === where.id);
      if (!row) throw new Error(`session ${where.id} not found`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>) {
    return fn(this);
  }
}
