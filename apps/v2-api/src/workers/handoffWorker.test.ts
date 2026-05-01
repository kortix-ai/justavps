import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { decideAutoHandoffs, type HandoffHost, type HandoffRun } from './handoffWorker.js';

const host = (over: Partial<HandoffHost> = {}): HandoffHost => ({
  id: 'h1',
  publicIpv4: '1.2.3.4',
  publicIpv6: null,
  incusMemberName: null,
  lifecycleState: 'delivered',
  targetClusterId: 'hel2',
  ...over,
});

const existingRun = (
  hostIp: string,
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' = 'running',
  ageMinutes = 1,
): HandoffRun => ({
  sshHost: hostIp,
  status,
  createdAt: new Date(Date.now() - ageMinutes * 60 * 1000),
});

describe('decideAutoHandoffs', () => {
  test('emits handoff for a delivered, unjoined host with target cluster', () => {
    const events = decideAutoHandoffs({ hosts: [host()], openRuns: [] });
    assert.equal(events.length, 1);
    assert.equal(events[0].hostId, 'h1');
    assert.equal(events[0].clusterId, 'hel2');
    assert.equal(events[0].sshHost, '1.2.3.4');
    assert.equal(events[0].fromRescue, true);
  });

  test('skips host with no target cluster (operator hasn\'t decided)', () => {
    const events = decideAutoHandoffs({ hosts: [host({ targetClusterId: null })], openRuns: [] });
    assert.equal(events.length, 0);
  });

  test('skips host already joined (has incusMemberName)', () => {
    const events = decideAutoHandoffs({
      hosts: [host({ incusMemberName: 'hel2-host01' })],
      openRuns: [],
    });
    assert.equal(events.length, 0);
  });

  test('skips host with no reachable IP', () => {
    const events = decideAutoHandoffs({
      hosts: [host({ publicIpv4: null, publicIpv6: null })],
      openRuns: [],
    });
    assert.equal(events.length, 0);
  });

  test('falls back to IPv6 when IPv4 absent', () => {
    const events = decideAutoHandoffs({
      hosts: [host({ publicIpv4: null, publicIpv6: '2a01::1' })],
      openRuns: [],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].sshHost, '2a01::1');
  });

  test('skips host that already has an active provisioning run', () => {
    const events = decideAutoHandoffs({
      hosts: [host()],
      openRuns: [existingRun('1.2.3.4', 'running')],
    });
    assert.equal(events.length, 0);
  });

  test('skips host with a pending run too (don\'t pile on)', () => {
    const events = decideAutoHandoffs({
      hosts: [host()],
      openRuns: [existingRun('1.2.3.4', 'pending')],
    });
    assert.equal(events.length, 0);
  });

  test('cooldown blocks new auto-handoff after a recent failed run', () => {
    const events = decideAutoHandoffs({
      hosts: [host()],
      openRuns: [existingRun('1.2.3.4', 'failed', 5)], // 5 min ago, well inside the 1h cooldown
    });
    assert.equal(events.length, 0,
      'auto-handoff should NOT loop after a recent failure — operator must triage');
  });

  test('cooldown expired — auto-handoff resumes after old failure', () => {
    const events = decideAutoHandoffs({
      hosts: [host()],
      openRuns: [existingRun('1.2.3.4', 'failed', 120)], // 2h ago
    });
    assert.equal(events.length, 1);
  });

  test('recently-succeeded run blocks too (host already joined some other way)', () => {
    const events = decideAutoHandoffs({
      hosts: [host()],
      openRuns: [existingRun('1.2.3.4', 'succeeded', 5)],
    });
    assert.equal(events.length, 0);
  });

  test('skips terminated host', () => {
    const events = decideAutoHandoffs({
      hosts: [host({ lifecycleState: 'terminated' })],
      openRuns: [],
    });
    assert.equal(events.length, 0);
  });

  test('skips host already online (it joined some other way)', () => {
    const events = decideAutoHandoffs({
      hosts: [host({ lifecycleState: 'online', incusMemberName: 'hel2-host02' })],
      openRuns: [],
    });
    assert.equal(events.length, 0);
  });

  test('multiple eligible hosts produce multiple handoffs', () => {
    const events = decideAutoHandoffs({
      hosts: [
        host({ id: 'h1', publicIpv4: '1.1.1.1' }),
        host({ id: 'h2', publicIpv4: '2.2.2.2' }),
        host({ id: 'h3', publicIpv4: '3.3.3.3', incusMemberName: 'taken' }),  // skip
      ],
      openRuns: [],
    });
    assert.equal(events.length, 2);
  });
});
