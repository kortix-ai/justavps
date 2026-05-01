import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SANDBOX_LIFECYCLE_STATES,
  isHotState,
  isStorageBilled,
  canTransitionSandbox,
  applyTransitionSandbox,
} from './sandboxLifecycle.js';

describe('SANDBOX_LIFECYCLE_STATES', () => {
  test('contains expected states', () => {
    for (const s of ['starting', 'running', 'stopping', 'stopped', 'archiving', 'archived', 'restoring', 'terminated']) {
      assert.ok(SANDBOX_LIFECYCLE_STATES.includes(s as never), `missing ${s}`);
    }
  });
});

describe('isHotState (CPU+RAM billed)', () => {
  test('running is hot', () => {
    assert.equal(isHotState('running'), true);
  });
  test('starting/stopping count as hot (resources pinned during transition)', () => {
    assert.equal(isHotState('starting'), true);
    assert.equal(isHotState('stopping'), true);
  });
  test('stopped/archived/archiving/restoring/terminated are NOT hot', () => {
    for (const s of ['stopped', 'archiving', 'archived', 'restoring', 'terminated'] as const) {
      assert.equal(isHotState(s), false, `${s} should not be hot`);
    }
  });
});

describe('isStorageBilled', () => {
  test('local-only states bill local storage and not archive', () => {
    for (const s of ['starting', 'running', 'stopping', 'stopped'] as const) {
      const r = isStorageBilled(s);
      assert.equal(r.local, true, `${s} should bill local storage`);
      assert.equal(r.archive, false, `${s} should NOT bill archive`);
    }
  });

  test('archived state bills archive storage, not local', () => {
    const r = isStorageBilled('archived');
    assert.equal(r.local, false);
    assert.equal(r.archive, true);
  });

  test('archiving and restoring are interim — both archive and local are billed (we keep both copies during transfer)', () => {
    for (const s of ['archiving', 'restoring'] as const) {
      const r = isStorageBilled(s);
      assert.equal(r.local, true);
      assert.equal(r.archive, true);
    }
  });

  test('terminated bills neither', () => {
    const r = isStorageBilled('terminated');
    assert.equal(r.local, false);
    assert.equal(r.archive, false);
  });
});

describe('canTransitionSandbox', () => {
  test('starting → running', () => {
    assert.equal(canTransitionSandbox('starting', 'running'), true);
  });
  test('running → stopping → stopped', () => {
    assert.equal(canTransitionSandbox('running', 'stopping'), true);
    assert.equal(canTransitionSandbox('stopping', 'stopped'), true);
  });
  test('stopped → archiving → archived', () => {
    assert.equal(canTransitionSandbox('stopped', 'archiving'), true);
    assert.equal(canTransitionSandbox('archiving', 'archived'), true);
  });
  test('archived → restoring → stopped', () => {
    // Restoring brings the sandbox back local; user can then start it.
    assert.equal(canTransitionSandbox('archived', 'restoring'), true);
    assert.equal(canTransitionSandbox('restoring', 'stopped'), true);
  });
  test('stopped → starting (resume from local)', () => {
    assert.equal(canTransitionSandbox('stopped', 'starting'), true);
  });
  test('any state can go to terminated', () => {
    for (const s of SANDBOX_LIFECYCLE_STATES) {
      if (s === 'terminated') continue;
      assert.equal(canTransitionSandbox(s, 'terminated'), true, `${s} → terminated should be allowed`);
    }
  });
  test('cannot regress: running → starting forbidden', () => {
    assert.equal(canTransitionSandbox('running', 'starting'), false);
  });
  test('terminated is terminal', () => {
    for (const s of SANDBOX_LIFECYCLE_STATES) {
      assert.equal(canTransitionSandbox('terminated', s), false, `terminated → ${s} forbidden`);
    }
  });
});

describe('applyTransitionSandbox', () => {
  test('valid returns new state', () => {
    assert.equal(applyTransitionSandbox('running', 'stopping'), 'stopping');
  });
  test('invalid throws', () => {
    assert.throws(() => applyTransitionSandbox('running', 'starting'), /invalid transition/);
  });
  test('identity is no-op', () => {
    assert.equal(applyTransitionSandbox('running', 'running'), 'running');
  });
});
