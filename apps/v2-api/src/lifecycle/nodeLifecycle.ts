// Node lifecycle state machine.
//
// One node = one Hetzner host that joins (or is in the process of joining,
// or has left) an Incus cluster. The lifecycle captures every observable
// transition the operator or the runner can drive.
//
//   requested  ──▶ ordered  ──▶ delivered ──▶ bootstrapping ──▶ joining ──▶ online
//                                                                              │
//                                                                              ▼
//                                                              cordoned ◀── draining
//                                                                  │
//                                                                  ▼
//                                                              terminated  ◀── (any non-terminal,
//                                                                                operator force)
//
//   cordoned ──▶ online   (uncordon — re-enable scheduling without redoing bootstrap)
//   online   ──▶ cordoned (cordon — stop scheduling new sandboxes for maintenance)
//
// Transitions are explicit; nothing implicit. The runner persists state on
// every step boundary so a kill+resume of v2-api re-enters the right state.

export const NODE_LIFECYCLE_STATES = [
  'requested',      // operator submitted an order request, not yet placed
  'ordered',        // Hetzner Robot accepted the order, awaiting delivery
  'delivered',      // server is delivered + reachable in Rescue mode
  'bootstrapping',  // installimage + Ubuntu prereqs + Incus install in flight
  'joining',        // mint-token + cluster-join + verify-membership in flight
  'online',         // joined + scheduling-eligible
  'draining',       // evacuating instances; not accepting new ones
  'cordoned',       // empty + not scheduling; ready to terminate or uncordon
  'terminated',     // host returned to Hetzner; final state
] as const;

export type NodeLifecycleState = (typeof NODE_LIFECYCLE_STATES)[number];

// Allowed transitions. Source state → list of valid target states.
//
// Why the failure-shortcut to `terminated` from every non-terminal:
// hosts can die unrecoverably (hardware failure, Hetzner cancelled, network
// partition we'll never recover). The operator must be able to mark the
// host "gone" without having to drain a node we can't talk to. Same edge
// fires from autoscale's force-terminate path.
export const TRANSITIONS: Record<NodeLifecycleState, NodeLifecycleState[]> = {
  requested:     ['ordered', 'terminated'],
  ordered:       ['delivered', 'terminated'],
  delivered:     ['bootstrapping', 'terminated'],
  bootstrapping: ['joining', 'terminated'],
  joining:       ['online', 'terminated'],
  online:        ['draining', 'cordoned', 'terminated'],
  draining:      ['cordoned', 'terminated'],
  cordoned:      ['online', 'terminated'],   // uncordon back to online
  terminated:    [],                           // terminal: no outbound edges
};

export function isTerminal(state: NodeLifecycleState): boolean {
  return TRANSITIONS[state].length === 0;
}

export function canTransition(from: NodeLifecycleState, to: NodeLifecycleState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// Apply a transition. Identity (same state to same state) is a no-op so
// runner code can blindly re-emit the same transition without throwing.
// Anything else must be in the TRANSITIONS table.
export function applyTransition(from: NodeLifecycleState, to: NodeLifecycleState): NodeLifecycleState {
  if (from === to) return from;
  if (!canTransition(from, to)) {
    throw new Error(`invalid transition: ${from} → ${to}`);
  }
  return to;
}

// BFS over the transition graph. Returns the shortest sequence of states
// from `from` to `to` inclusive of both endpoints. Returns null if `to`
// is unreachable. Used by the runner / operator UI to show "you can get
// from cordoned to terminated in 1 step" etc.
//
// Note: BFS will pick the operator force-terminate shortcut if the target
// is `terminated`. For the orderly drain → cordon → terminate path use
// drainPath() below.
export function shortestPath(from: NodeLifecycleState, to: NodeLifecycleState): NodeLifecycleState[] | null {
  if (from === to) return [from];
  const queue: NodeLifecycleState[][] = [[from]];
  const visited = new Set<NodeLifecycleState>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const tip = path[path.length - 1];
    for (const next of TRANSITIONS[tip] ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      const newPath = [...path, next];
      if (next === to) return newPath;
      queue.push(newPath);
    }
  }
  return null;
}

// Operator-orderly drain route: reachable only from `online`, `draining`,
// or `cordoned`. Walks `→ draining → cordoned → terminated` from each.
// Returns null if `from` is a not-yet-online state — those use the
// force-terminate shortcut via shortestPath.
export function drainPath(from: NodeLifecycleState): NodeLifecycleState[] | null {
  switch (from) {
    case 'online':    return ['online', 'draining', 'cordoned', 'terminated'];
    case 'draining':  return ['draining', 'cordoned', 'terminated'];
    case 'cordoned':  return ['cordoned', 'terminated'];
    default:          return null;
  }
}
