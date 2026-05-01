import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  reconcileBilling,
  type SessionState,
  type LiveInstance,
  type ReconcileEvent,
} from './billingWorker.js';

const inst = (
  name: string,
  status: 'Running' | 'Stopped',
  cpu = '1',
  memGb = 1,
  diskGb = 10,
): LiveInstance => ({
  machineId: name, customerId: `cust-${name}`,
  status, vcpus: Number(cpu), ramGb: memGb, storageGb: diskGb,
});

describe('reconcileBilling — open new sessions for newly running instances', () => {
  test('Running instance with no open session → opens one', () => {
    const events = reconcileBilling({
      now: new Date('2026-04-27T12:00:00Z'),
      live: [inst('m1', 'Running', '2', 4, 20)],
      openSessions: [],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'open');
    assert.equal(events[0].machineId, 'm1');
    assert.equal(events[0].vcpus, 2);
    assert.equal(events[0].ramGb, 4);
    assert.equal(events[0].storageGb, 20);
  });

  test('Stopped instance with no open session → no event (we don\'t track stopped from cold)', () => {
    const events = reconcileBilling({
      now: new Date('2026-04-27T12:00:00Z'),
      live: [inst('m1', 'Stopped')],
      openSessions: [],
    });
    assert.equal(events.length, 0);
  });
});

describe('reconcileBilling — close sessions when instance disappears or stops', () => {
  test('open session + instance no longer running → final tick + close event', () => {
    const session: SessionState = {
      id: 's1', machineId: 'm1', customerId: 'c1',
      vcpus: 1, ramGb: 1, storageGb: 5,
      startedAt: new Date('2026-04-27T11:00:00Z'),
      lastTickAt: new Date('2026-04-27T11:30:00Z'),
      state: 'running',
      vcpuSeconds: 1800, ramGbSeconds: 1800, storageGbSecondsLocal: 9000, storageGbSecondsArchive: 0,
    };
    const events = reconcileBilling({
      now: new Date('2026-04-27T12:00:00Z'),
      live: [inst('m1', 'Stopped')],
      openSessions: [session],
    });
    // 30 minutes elapsed since last tick — emit a final tick to bill those
    // seconds, THEN close.
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, 'tick');
    const tick = events[0] as Extract<ReconcileEvent, { kind: 'tick' }>;
    assert.equal(tick.vcpuSecondsAdd, 1 * 1800);  // 30 min × 1 vCPU
    assert.equal(tick.ramGbSecondsAdd, 1 * 1800);
    assert.equal(events[1].kind, 'close');
    assert.equal(events[1].sessionId, 's1');
    assert.equal((events[1] as Extract<ReconcileEvent, { kind: 'close' }>).endedAt.getTime(),
      new Date('2026-04-27T12:00:00Z').getTime());
  });

  test('open session + instance gone entirely → final tick + close event', () => {
    const session: SessionState = {
      id: 's1', machineId: 'm1', customerId: 'c1',
      vcpus: 1, ramGb: 1, storageGb: 5,
      startedAt: new Date('2026-04-27T11:00:00Z'),
      lastTickAt: new Date('2026-04-27T11:30:00Z'),
      state: 'running',
      vcpuSeconds: 0, ramGbSeconds: 0, storageGbSecondsLocal: 0, storageGbSecondsArchive: 0,
    };
    const events = reconcileBilling({
      now: new Date('2026-04-27T12:00:00Z'),
      live: [],
      openSessions: [session],
    });
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, 'tick');
    assert.equal(events[1].kind, 'close');
  });
});

describe('reconcileBilling — tick existing sessions', () => {
  test('open session + instance still running → tick event with new lastTickAt + accumulated seconds', () => {
    const session: SessionState = {
      id: 's1', machineId: 'm1', customerId: 'c1',
      vcpus: 2, ramGb: 4, storageGb: 20,
      startedAt: new Date('2026-04-27T11:00:00Z'),
      lastTickAt: new Date('2026-04-27T11:00:00Z'),
      state: 'running',
      vcpuSeconds: 0, ramGbSeconds: 0, storageGbSecondsLocal: 0, storageGbSecondsArchive: 0,
    };
    const events = reconcileBilling({
      now: new Date('2026-04-27T11:00:30Z'), // +30s
      live: [inst('m1', 'Running', '2', 4, 20)],
      openSessions: [session],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'tick');
    const tick = events[0] as Extract<ReconcileEvent, { kind: 'tick' }>;
    assert.equal(tick.vcpuSecondsAdd, 2 * 30);
    assert.equal(tick.ramGbSecondsAdd, 4 * 30);
    assert.equal(tick.storageGbSecondsLocalAdd, 20 * 30);
  });

  test('multiple instances, multiple sessions, mix of opens/ticks/closes in one call', () => {
    const sessionRunning: SessionState = {
      id: 's-keep', machineId: 'keep', customerId: 'c1',
      vcpus: 1, ramGb: 1, storageGb: 5,
      startedAt: new Date('2026-04-27T11:00:00Z'),
      lastTickAt: new Date('2026-04-27T11:00:00Z'),
      state: 'running',
      vcpuSeconds: 0, ramGbSeconds: 0, storageGbSecondsLocal: 0, storageGbSecondsArchive: 0,
    };
    const sessionGone: SessionState = {
      id: 's-gone', machineId: 'gone', customerId: 'c2',
      vcpus: 1, ramGb: 1, storageGb: 5,
      startedAt: new Date('2026-04-27T11:00:00Z'),
      lastTickAt: new Date('2026-04-27T11:00:00Z'),
      state: 'running',
      vcpuSeconds: 0, ramGbSeconds: 0, storageGbSecondsLocal: 0, storageGbSecondsArchive: 0,
    };
    const events = reconcileBilling({
      now: new Date('2026-04-27T11:01:00Z'),
      live: [
        inst('keep', 'Running', '1', 1, 5),
        inst('new', 'Running', '4', 8, 40),  // → open
        // 'gone' is not in live → final tick + close
      ],
      openSessions: [sessionRunning, sessionGone],
    });
    const kinds = events.map((e) => e.kind).sort();
    // Expect: open (new), tick (keep — still running), tick (gone — final), close (gone)
    assert.deepEqual(kinds, ['close', 'open', 'tick', 'tick']);
  });

  test('idempotent: same now + same live + lastTickAt=now → tick with 0 delta (or no tick)', () => {
    const session: SessionState = {
      id: 's1', machineId: 'm1', customerId: 'c1',
      vcpus: 1, ramGb: 1, storageGb: 5,
      startedAt: new Date('2026-04-27T11:00:00Z'),
      lastTickAt: new Date('2026-04-27T12:00:00Z'),  // already up-to-date
      state: 'running',
      vcpuSeconds: 0, ramGbSeconds: 0, storageGbSecondsLocal: 0, storageGbSecondsArchive: 0,
    };
    const events = reconcileBilling({
      now: new Date('2026-04-27T12:00:00Z'),
      live: [inst('m1', 'Running')],
      openSessions: [session],
    });
    // Either: zero events (no-op) OR a tick with all-zero deltas. Both valid;
    // implementation must not double-bill.
    if (events.length > 0) {
      const tick = events[0] as Extract<ReconcileEvent, { kind: 'tick' }>;
      assert.equal(tick.kind, 'tick');
      assert.equal(tick.vcpuSecondsAdd, 0);
      assert.equal(tick.ramGbSecondsAdd, 0);
    }
  });
});
