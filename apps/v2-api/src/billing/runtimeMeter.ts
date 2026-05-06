import type { Prisma, PrismaClient } from '@prisma/client';

export type BillingRuntimeResources = {
  vcpu: number;
  ramGb: number;
  storageGb: number;
};

export type BillingRuntimeObservation = {
  machineId: string;
  accountId: string | null;
  status: string;
  resources: BillingRuntimeResources;
  observedAt: Date;
  source: string;
  metadata?: Record<string, unknown>;
};

export type BillingRuntimeObservationResult = {
  machineId: string;
  running: boolean;
  opened: number;
  closed: number;
  resized: boolean;
  duplicateSessionsClosed: number;
  gaps: Array<{ reason: string; from?: string; to?: string }>;
};

export function isBillingRunningStatus(status: string | null | undefined) {
  return String(status ?? '').toLowerCase() === 'running';
}

export function normalizeBillingResources(resources: Partial<BillingRuntimeResources>): BillingRuntimeResources {
  return {
    vcpu: positiveNumber(resources.vcpu),
    ramGb: positiveNumber(resources.ramGb),
    storageGb: positiveNumber(resources.storageGb),
  };
}

export async function recordBillingRuntimeObservation(
  prisma: PrismaClient,
  observation: BillingRuntimeObservation,
): Promise<BillingRuntimeObservationResult> {
  const resources = normalizeBillingResources(observation.resources);
  const observedAt = observation.observedAt;
  const running = isBillingRunningStatus(observation.status);
  const result: BillingRuntimeObservationResult = {
    machineId: observation.machineId,
    running,
    opened: 0,
    closed: 0,
    resized: false,
    duplicateSessionsClosed: 0,
    gaps: [],
  };

  await prisma.billingMeasurement.create({
    data: {
      accountId: observation.accountId,
      machineId: observation.machineId,
      sourceType: 'machine',
      sourceId: observation.machineId,
      measuredAt: observedAt,
      observedStatus: observation.status,
      vcpu: resources.vcpu || null,
      ramGb: resources.ramGb || null,
      storageGib: resources.storageGb || null,
      measurementSource: observation.source,
      exact: true,
      metadata: { ...(observation.metadata ?? {}), billing_runtime: true } as Prisma.InputJsonValue,
    },
  }).catch(() => undefined);

  await prisma.$transaction(async (tx) => {
    const openSessions = await tx.sandboxUsageSession.findMany({
      where: { machineId: observation.machineId, state: 'running', endedAt: null },
      orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
    });

    const [current, duplicates] = splitCurrentAndDuplicates(openSessions);
    for (const duplicate of duplicates) {
      const closeAt = safeCloseAt(duplicate.startedAt, duplicate.lastObservedAt ?? duplicate.updatedAt ?? observedAt);
      await tx.sandboxUsageSession.update({
        where: { id: duplicate.id },
        data: { endedAt: closeAt, state: 'billing_gap_duplicate_closed', lastObservedAt: closeAt },
      });
      result.closed += 1;
      result.duplicateSessionsClosed += 1;
      result.gaps.push({ reason: 'duplicate open billing session closed fail-closed', from: duplicate.startedAt.toISOString(), to: closeAt.toISOString() });
    }

    if (running) {
      if (!current) {
        await tx.sandboxUsageSession.create({
          data: {
            machineId: observation.machineId,
            customerId: observation.accountId,
            vcpus: resources.vcpu,
            ramGb: resources.ramGb,
            storageGb: resources.storageGb,
            startedAt: observedAt,
            lastObservedAt: observedAt,
            state: 'running',
          },
        });
        result.opened += 1;
        return;
      }

      if (!sameSessionShape(current, resources)) {
        const closeAt = safeCloseAt(current.startedAt, observedAt);
        await tx.sandboxUsageSession.update({
          where: { id: current.id },
          data: { endedAt: closeAt, state: 'resized', lastObservedAt: closeAt },
        });
        await tx.sandboxUsageSession.create({
          data: {
            machineId: observation.machineId,
            customerId: observation.accountId ?? current.customerId,
            vcpus: resources.vcpu,
            ramGb: resources.ramGb,
            storageGb: resources.storageGb,
            startedAt: closeAt,
            lastObservedAt: observedAt,
            state: 'running',
          },
        });
        result.closed += 1;
        result.opened += 1;
        result.resized = true;
        return;
      }

      await tx.sandboxUsageSession.update({
        where: { id: current.id },
        data: { lastObservedAt: maxDate(current.lastObservedAt ?? current.startedAt, observedAt) },
      });
      return;
    }

    if (current) {
      const closeAt = safeCloseAt(current.startedAt, observedAt);
      await tx.sandboxUsageSession.update({
        where: { id: current.id },
        data: { endedAt: closeAt, state: normalizedClosedState(observation.status), lastObservedAt: closeAt },
      });
      result.closed += 1;
    }
  });

  if (result.gaps.length > 0) {
    await prisma.billingMeasurement.create({
      data: {
        accountId: observation.accountId,
        machineId: observation.machineId,
        sourceType: 'machine',
        sourceId: observation.machineId,
        measuredAt: observedAt,
        observedStatus: observation.status,
        vcpu: resources.vcpu || null,
        ramGb: resources.ramGb || null,
        storageGib: resources.storageGb || null,
        measurementSource: 'billing_runtime_gap',
        exact: false,
        metadata: { source: observation.source, gaps: result.gaps } as Prisma.InputJsonValue,
      },
    }).catch(() => undefined);
  }

  return result;
}

function splitCurrentAndDuplicates<T extends { createdAt: Date }>(sessions: T[]): [T | null, T[]] {
  if (sessions.length === 0) return [null, []];
  const sorted = [...sessions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const current = sorted[sorted.length - 1] ?? null;
  return [current, sorted.slice(0, -1)];
}

function sameSessionShape(session: { vcpus: number; ramGb: number; storageGb: number }, resources: BillingRuntimeResources) {
  return session.vcpus === resources.vcpu
    && almostEqual(session.ramGb, resources.ramGb)
    && almostEqual(session.storageGb, resources.storageGb);
}

function positiveNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function almostEqual(a: number, b: number) {
  return Math.abs(Number(a) - Number(b)) < 0.000001;
}

function safeCloseAt(startedAt: Date, closeAt: Date) {
  return closeAt.getTime() >= startedAt.getTime() ? closeAt : startedAt;
}

function maxDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

function normalizedClosedState(status: string) {
  const lower = status.toLowerCase();
  if (lower === 'deleted' || lower === 'missing') return lower;
  if (lower === 'stopped') return 'stopped';
  return `not_running:${lower || 'unknown'}`;
}
