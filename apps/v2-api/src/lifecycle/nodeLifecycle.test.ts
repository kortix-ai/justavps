import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  NODE_LIFECYCLE_STATES,
  isTerminal,
  canTransition,
  applyTransition,
  shortestPath,
  TRANSITIONS,
} from './nodeLifecycle.js';

describe('NODE_LIFECYCLE_STATES', () => {
  test('contains all expected states', () => {
    const expected = [
      'requested', 'ordered', 'delivered', 'bootstrapping',
      'joining', 'online', 'draining', 'cordoned', 'terminated',
    ];
    for (const s of expected) {
      assert.ok(NODE_LIFECYCLE_STATES.includes(s as never), `missing state ${s}`);
    }
  });

  test('has no duplicate states', () => {
    const set = new Set(NODE_LIFECYCLE_STATES);
    assert.equal(set.size, NODE_LIFECYCLE_STATES.length);
  });
});

describe('isTerminal', () => {
  test('terminated is terminal', () => {
    assert.equal(isTerminal('terminated'), true);
  });
  test('online is not terminal', () => {
    assert.equal(isTerminal('online'), false);
  });
  test('every other state is not terminal', () => {
    for (const s of NODE_LIFECYCLE_STATES) {
      if (s === 'terminated') continue;
      assert.equal(isTerminal(s), false, `${s} should not be terminal`);
    }
  });
});

describe('canTransition', () => {
  test('happy path: requested → ordered', () => {
    assert.equal(canTransition('requested', 'ordered'), true);
  });

  test('happy path: ordered → delivered', () => {
    assert.equal(canTransition('ordered', 'delivered'), true);
  });

  test('happy path: online → draining → cordoned → terminated', () => {
    assert.equal(canTransition('online', 'draining'), true);
    assert.equal(canTransition('draining', 'cordoned'), true);
    assert.equal(canTransition('cordoned', 'terminated'), true);
  });

  test('cannot skip steps: requested → online forbidden', () => {
    assert.equal(canTransition('requested', 'online'), false);
  });

  test('cannot regress: online → bootstrapping forbidden', () => {
    assert.equal(canTransition('online', 'bootstrapping'), false);
  });

  test('terminal: terminated → anything forbidden', () => {
    for (const s of NODE_LIFECYCLE_STATES) {
      assert.equal(canTransition('terminated', s), false, `terminated → ${s} should be forbidden`);
    }
  });

  test('failure shortcut: any non-terminal can go directly to terminated', () => {
    // Operator force-terminate. Bypasses drain — used when a host is dead
    // and we need to mark it gone so it stops billing/scheduling.
    for (const s of NODE_LIFECYCLE_STATES) {
      if (s === 'terminated') continue;
      assert.equal(canTransition(s, 'terminated'), true, `${s} → terminated should be allowed`);
    }
  });

  test('cordoned → online (uncordon)', () => {
    // Operator can re-enable a cordoned host without redoing bootstrap.
    assert.equal(canTransition('cordoned', 'online'), true);
  });

  test('online → cordoned (cordon directly without drain)', () => {
    // Operator can stop scheduling new sandboxes onto a host without
    // forcing a drain — useful for maintenance windows.
    assert.equal(canTransition('online', 'cordoned'), true);
  });
});

describe('applyTransition', () => {
  test('valid transition returns the new state', () => {
    assert.equal(applyTransition('requested', 'ordered'), 'ordered');
  });

  test('invalid transition throws', () => {
    assert.throws(() => applyTransition('requested', 'online'),
      /invalid transition/);
  });

  test('idempotent identity: state → state returns state without throwing', () => {
    // Useful for runner code that may re-emit the same transition.
    assert.equal(applyTransition('online', 'online'), 'online');
  });
});

describe('shortestPath', () => {
  test('online → terminated uses the operator force-terminate shortcut', () => {
    // BFS finds the 1-step force-terminate edge. For the orderly drain
    // route, see drainPath below.
    assert.deepEqual(shortestPath('online', 'terminated'),
      ['online', 'terminated']);
  });

  test('requested → terminated uses the shortcut', () => {
    assert.deepEqual(shortestPath('requested', 'terminated'),
      ['requested', 'terminated']);
  });

  test('same source and target = trivial path', () => {
    assert.deepEqual(shortestPath('online', 'online'), ['online']);
  });

  test('unreachable returns null', () => {
    // terminated → online is impossible (terminal).
    assert.equal(shortestPath('terminated', 'online'), null);
  });
});

describe('drainPath', () => {
  test('online → drain → cordoned → terminated', async () => {
    const { drainPath } = await import('./nodeLifecycle.js');
    assert.deepEqual(drainPath('online'),
      ['online', 'draining', 'cordoned', 'terminated']);
  });

  test('draining → cordoned → terminated', async () => {
    const { drainPath } = await import('./nodeLifecycle.js');
    assert.deepEqual(drainPath('draining'),
      ['draining', 'cordoned', 'terminated']);
  });

  test('cordoned → terminated', async () => {
    const { drainPath } = await import('./nodeLifecycle.js');
    assert.deepEqual(drainPath('cordoned'),
      ['cordoned', 'terminated']);
  });

  test('not-yet-online state has no drain path (use shortcut directly)', async () => {
    const { drainPath } = await import('./nodeLifecycle.js');
    assert.equal(drainPath('bootstrapping'), null);
  });
});

describe('TRANSITIONS structure', () => {
  test('every state in NODE_LIFECYCLE_STATES has an entry in TRANSITIONS', () => {
    for (const s of NODE_LIFECYCLE_STATES) {
      assert.ok(s in TRANSITIONS, `${s} missing from TRANSITIONS`);
    }
  });

  test('every transition target is itself a valid state', () => {
    for (const [src, targets] of Object.entries(TRANSITIONS)) {
      for (const t of targets) {
        assert.ok(NODE_LIFECYCLE_STATES.includes(t as never),
          `transition ${src} → ${t} references unknown state`);
      }
    }
  });

  test('terminated has no outbound transitions', () => {
    assert.deepEqual(TRANSITIONS.terminated, []);
  });
});
