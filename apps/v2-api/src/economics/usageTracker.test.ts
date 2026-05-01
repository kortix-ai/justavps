import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  openSession,
  applyStateChange,
  accumulateUntil,
  computeBilledRevenue,
  type Session,
} from './usageTracker.js';
import { DEFAULT_PRICING } from './pricing.js';

describe('openSession', () => {
  test('captures shape + start time + initial state', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({
      machineId: 'm1', customerId: 'c1', vcpus: 2, ramGb: 4, storageGb: 20, startedAt: t0,
    });
    assert.equal(s.machineId, 'm1');
    assert.equal(s.customerId, 'c1');
    assert.equal(s.vcpus, 2);
    assert.equal(s.ramGb, 4);
    assert.equal(s.storageGb, 20);
    assert.equal(s.state, 'running');
    assert.equal(s.startedAt.getTime(), t0.getTime());
    assert.equal(s.lastTickAt.getTime(), t0.getTime());
    assert.equal(s.endedAt, null);
    assert.equal(s.vcpuSeconds, 0);
    assert.equal(s.ramGbSeconds, 0);
    assert.equal(s.storageGbSecondsLocal, 0);
    assert.equal(s.storageGbSecondsArchive, 0);
  });
});

describe('accumulateUntil — running state', () => {
  test('1 hour running accumulates correct vcpu·s + ram·s + local-storage·s', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 2, ramGb: 4, storageGb: 20, startedAt: t0 });
    const t1 = new Date(t0.getTime() + 3600 * 1000);
    accumulateUntil(s, t1);
    assert.equal(s.vcpuSeconds, 2 * 3600);
    assert.equal(s.ramGbSeconds, 4 * 3600);
    assert.equal(s.storageGbSecondsLocal, 20 * 3600);
    assert.equal(s.storageGbSecondsArchive, 0);
    assert.equal(s.lastTickAt.getTime(), t1.getTime());
  });

  test('multiple ticks compose', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    accumulateUntil(s, new Date(t0.getTime() + 1000));   // +1s
    accumulateUntil(s, new Date(t0.getTime() + 2000));   // +1s
    assert.equal(s.vcpuSeconds, 2);
    assert.equal(s.ramGbSeconds, 2);
    assert.equal(s.storageGbSecondsLocal, 2);
  });

  test('idempotent on identical timestamp (no double count)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    accumulateUntil(s, new Date(t0.getTime() + 1000));
    accumulateUntil(s, new Date(t0.getTime() + 1000));
    assert.equal(s.vcpuSeconds, 1);
  });

  test('rejects backwards time (would imply negative seconds)', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    accumulateUntil(s, new Date(t0.getTime() + 1000));
    assert.throws(() => accumulateUntil(s, new Date(t0.getTime() + 500)), /backwards|past/i);
  });
});

describe('applyStateChange — billing semantics across states', () => {
  test('running → stopping continues to bill hot resources up to transition', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    const t1 = new Date(t0.getTime() + 1000);
    applyStateChange(s, 'stopping', t1);
    assert.equal(s.state, 'stopping');
    assert.equal(s.vcpuSeconds, 1);
    assert.equal(s.ramGbSeconds, 1);
  });

  test('stopping → stopped: hot billing stops, storage-local continues', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    applyStateChange(s, 'stopping', new Date(t0.getTime() + 1000));
    applyStateChange(s, 'stopped', new Date(t0.getTime() + 2000));
    accumulateUntil(s, new Date(t0.getTime() + 12000));
    // Hot billed for 2s (running 1s + stopping 1s), storage billed for 12s.
    assert.equal(s.vcpuSeconds, 2);
    assert.equal(s.ramGbSeconds, 2);
    assert.equal(s.storageGbSecondsLocal, 12);
  });

  test('stopped → archiving: both local and archive billed', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    applyStateChange(s, 'stopping', new Date(t0.getTime() + 1000));
    applyStateChange(s, 'stopped', new Date(t0.getTime() + 2000));
    applyStateChange(s, 'archiving', new Date(t0.getTime() + 3000));
    accumulateUntil(s, new Date(t0.getTime() + 13000));
    // Storage: 3s local-only, then 10s of archiving (both billed).
    // Total local: 3 + 10 = 13s; total archive: 10s.
    assert.equal(s.storageGbSecondsLocal, 13);
    assert.equal(s.storageGbSecondsArchive, 10);
  });

  test('archived: only archive storage billed', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 2, startedAt: t0 });
    applyStateChange(s, 'stopping', new Date(t0.getTime() + 1000));
    applyStateChange(s, 'stopped', new Date(t0.getTime() + 2000));
    applyStateChange(s, 'archiving', new Date(t0.getTime() + 3000));
    applyStateChange(s, 'archived', new Date(t0.getTime() + 4000));
    accumulateUntil(s, new Date(t0.getTime() + 14000));
    // Local: 4s × 2 GB = 8 GB·s.   Archive: 1s (during archiving) + 10s (archived) = 11s × 2 GB = 22 GB·s.
    assert.equal(s.storageGbSecondsLocal, 8);
    assert.equal(s.storageGbSecondsArchive, 22);
  });

  test('terminated: nothing billed after transition', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    applyStateChange(s, 'stopping', new Date(t0.getTime() + 1000));
    applyStateChange(s, 'stopped', new Date(t0.getTime() + 2000));
    applyStateChange(s, 'terminated', new Date(t0.getTime() + 3000));
    accumulateUntil(s, new Date(t0.getTime() + 1_000_000));
    // After terminated, no further accrual regardless of how much time passes.
    assert.equal(s.vcpuSeconds, 2);
    assert.equal(s.ramGbSeconds, 2);
    assert.equal(s.storageGbSecondsLocal, 3);
    assert.equal(s.endedAt?.getTime(), t0.getTime() + 3000);
  });

  test('invalid transition throws', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    // running → starting is not allowed
    assert.throws(() => applyStateChange(s, 'starting', new Date(t0.getTime() + 1000)), /invalid transition/);
  });
});

describe('computeBilledRevenue', () => {
  test('always-on session for 1 hour at default pricing', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 4, storageGb: 20, startedAt: t0 });
    accumulateUntil(s, new Date(t0.getTime() + 3600 * 1000));
    const rev = computeBilledRevenue(s, DEFAULT_PRICING);
    // 3600·(1·4.4 + 4·1.3 + 20·0.17) = 3600 · 12.6 = 45360 µEUR
    const expected = 3600 * (1 * 4.4 + 4 * 1.3 + 20 * 0.17);
    assert.ok(Math.abs(rev - expected) < 1e-6, `got ${rev} expected ${expected}`);
  });

  test('billed revenue only counts what session has accumulated', () => {
    const t0 = new Date('2026-04-27T12:00:00Z');
    const s = openSession({ machineId: 'm', customerId: 'c', vcpus: 1, ramGb: 1, storageGb: 1, startedAt: t0 });
    // No accumulate call yet → all zeros → revenue zero.
    assert.equal(computeBilledRevenue(s, DEFAULT_PRICING), 0);
  });
});
