// Sandbox usage tracker — pure functions over an in-memory Session
// object. The DB layer (which writes SandboxUsageSession rows) calls
// these to advance accounting on each lifecycle transition.
//
// Why pure functions: this lets us unit-test billing semantics with
// zero DB. The DB just stores Session snapshots between ticks.

import {
  isHotState,
  isStorageBilled,
  applyTransitionSandbox,
  type SandboxLifecycleState,
} from '../lifecycle/sandboxLifecycle.js';
import { computeRevenueMicroEur, type Pricing } from './pricing.js';

export type Session = {
  machineId: string;
  customerId: string | null;
  vcpus: number;
  ramGb: number;
  storageGb: number;
  startedAt: Date;
  lastTickAt: Date;
  endedAt: Date | null;
  state: SandboxLifecycleState;
  vcpuSeconds: number;
  ramGbSeconds: number;
  storageGbSecondsLocal: number;
  storageGbSecondsArchive: number;
};

export function openSession(opts: {
  machineId: string;
  customerId: string | null;
  vcpus: number;
  ramGb: number;
  storageGb: number;
  startedAt: Date;
}): Session {
  return {
    machineId: opts.machineId,
    customerId: opts.customerId,
    vcpus: opts.vcpus,
    ramGb: opts.ramGb,
    storageGb: opts.storageGb,
    startedAt: opts.startedAt,
    lastTickAt: opts.startedAt,
    endedAt: null,
    state: 'running',
    vcpuSeconds: 0,
    ramGbSeconds: 0,
    storageGbSecondsLocal: 0,
    storageGbSecondsArchive: 0,
  };
}

// Advance the session's accumulated seconds up to `until`, accruing
// based on the *current* state. Idempotent on the same `until` (returns
// without re-accruing). Throws if `until` is before lastTickAt.
export function accumulateUntil(session: Session, until: Date): void {
  if (session.endedAt) return; // terminated: never accrue further
  if (until.getTime() === session.lastTickAt.getTime()) return; // idempotent
  if (until.getTime() < session.lastTickAt.getTime()) {
    throw new Error(`accumulateUntil: tick goes backwards (until=${until.toISOString()} < lastTickAt=${session.lastTickAt.toISOString()})`);
  }
  const seconds = (until.getTime() - session.lastTickAt.getTime()) / 1000;
  if (isHotState(session.state)) {
    session.vcpuSeconds += session.vcpus * seconds;
    session.ramGbSeconds += session.ramGb * seconds;
  }
  const billed = isStorageBilled(session.state);
  if (billed.local) session.storageGbSecondsLocal += session.storageGb * seconds;
  if (billed.archive) session.storageGbSecondsArchive += session.storageGb * seconds;
  session.lastTickAt = until;
}

// Apply a sandbox lifecycle transition at time `at`. Mutates the session:
// accrues up to `at` under the OLD state, then flips to the NEW state.
// On terminated: stamps endedAt and prevents further accrual.
export function applyStateChange(session: Session, to: SandboxLifecycleState, at: Date): void {
  // Validate first (throws if invalid). Then accrue under old state, then flip.
  applyTransitionSandbox(session.state, to);  // throws on invalid
  accumulateUntil(session, at);
  session.state = to;
  if (to === 'terminated') {
    session.endedAt = at;
  }
}

// Snapshot the session's billable revenue in micro-eur (float; round at
// ledger persistence). Captures usage *as accumulated so far* — call
// accumulateUntil(now) before computing if you want it to include
// up-to-now seconds.
export function computeBilledRevenue(session: Session, pricing: Pricing): number {
  return computeRevenueMicroEur({
    vcpu_seconds: session.vcpuSeconds,
    ram_gb_seconds: session.ramGbSeconds,
    storage_gb_seconds_local: session.storageGbSecondsLocal,
    storage_gb_seconds_archive: session.storageGbSecondsArchive,
  }, pricing);
}
