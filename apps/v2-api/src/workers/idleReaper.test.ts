import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  decideReapActions,
  DEFAULT_REAP_POLICY,
  type ReapableSandbox,
} from './idleReaper.js';

const t = (iso: string) => new Date(iso);
const sandbox = (over: Partial<ReapableSandbox> = {}): ReapableSandbox => ({
  machineId: 's1',
  customerId: 'c1',
  state: 'stopped',
  lastTransitionAt: t('2026-04-01T00:00:00Z'),
  storageGb: 20,
  ...over,
});

describe('decideReapActions', () => {
  test('keeps fresh stopped sandbox (under archive threshold)', () => {
    const actions = decideReapActions({
      sandboxes: [sandbox({ lastTransitionAt: t('2026-04-26T00:00:00Z') })],
      now: t('2026-04-27T00:00:00Z'),
      policy: DEFAULT_REAP_POLICY,
    });
    assert.equal(actions.length, 0);
  });

  test('archives a stopped sandbox older than archive threshold (default 7 days)', () => {
    const actions = decideReapActions({
      sandboxes: [sandbox({ lastTransitionAt: t('2026-04-01T00:00:00Z') })],
      now: t('2026-04-15T00:00:00Z'),
      policy: DEFAULT_REAP_POLICY,
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'archive');
    assert.equal(actions[0].machineId, 's1');
  });

  test('keeps a fresh archived sandbox (under delete threshold)', () => {
    const actions = decideReapActions({
      sandboxes: [sandbox({ state: 'archived', lastTransitionAt: t('2026-04-20T00:00:00Z') })],
      now: t('2026-04-27T00:00:00Z'),
      policy: DEFAULT_REAP_POLICY,
    });
    assert.equal(actions.length, 0);
  });

  test('deletes archived sandbox older than archive_to_delete_days', () => {
    const actions = decideReapActions({
      sandboxes: [sandbox({ state: 'archived', lastTransitionAt: t('2026-01-01T00:00:00Z') })],
      now: t('2026-04-27T00:00:00Z'),
      policy: DEFAULT_REAP_POLICY,
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'delete');
  });

  test('mixed inputs produce mixed actions', () => {
    const actions = decideReapActions({
      sandboxes: [
        sandbox({ machineId: 'fresh', lastTransitionAt: t('2026-04-26T00:00:00Z') }),
        sandbox({ machineId: 'archive-me', lastTransitionAt: t('2026-04-01T00:00:00Z') }),
        sandbox({ machineId: 'delete-me', state: 'archived', lastTransitionAt: t('2026-01-01T00:00:00Z') }),
      ],
      now: t('2026-04-27T00:00:00Z'),
      policy: DEFAULT_REAP_POLICY,
    });
    assert.equal(actions.length, 2);
    assert.equal(actions.find((a) => a.machineId === 'archive-me')?.kind, 'archive');
    assert.equal(actions.find((a) => a.machineId === 'delete-me')?.kind, 'delete');
  });

  test('respects custom policy thresholds', () => {
    // 1-day archive, 1-day delete (very aggressive)
    const policy = { stopped_to_archive_days: 1, archive_to_delete_days: 1 };
    const actions = decideReapActions({
      sandboxes: [
        sandbox({ machineId: 'a', lastTransitionAt: t('2026-04-25T00:00:00Z') }),  // 2 days stopped → archive
        sandbox({ machineId: 'b', state: 'archived', lastTransitionAt: t('2026-04-25T00:00:00Z') }),  // 2 days archived → delete
      ],
      now: t('2026-04-27T00:00:00Z'),
      policy,
    });
    assert.equal(actions.length, 2);
    assert.equal(actions.find((a) => a.machineId === 'a')?.kind, 'archive');
    assert.equal(actions.find((a) => a.machineId === 'b')?.kind, 'delete');
  });

  test('running and other non-eligible states are never reaped', () => {
    const actions = decideReapActions({
      sandboxes: [
        sandbox({ machineId: 'r', state: 'running', lastTransitionAt: t('2020-01-01T00:00:00Z') }),
        sandbox({ machineId: 's', state: 'starting', lastTransitionAt: t('2020-01-01T00:00:00Z') }),
        sandbox({ machineId: 'z', state: 'archiving', lastTransitionAt: t('2020-01-01T00:00:00Z') }),
        sandbox({ machineId: 't', state: 'terminated', lastTransitionAt: t('2020-01-01T00:00:00Z') }),
      ],
      now: t('2026-04-27T00:00:00Z'),
      policy: DEFAULT_REAP_POLICY,
    });
    assert.equal(actions.length, 0);
  });

  test('exactly-at-threshold edge — equals reap threshold triggers action', () => {
    const policy = { stopped_to_archive_days: 7, archive_to_delete_days: 30 };
    const actions = decideReapActions({
      sandboxes: [sandbox({ lastTransitionAt: t('2026-04-20T00:00:00Z') })],
      now: t('2026-04-27T00:00:00Z'), // exactly 7 days
      policy,
    });
    assert.equal(actions.length, 1);
  });
});
