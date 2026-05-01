// Sandbox lifecycle. Captures the billable states a sandbox transitions
// through. Distinct from Incus's instance status (which is much finer-
// grained — Frozen, Restarting, etc.) — we only care about what affects
// billing & resource accounting.
//
//                ┌──────────────────────────────────────┐
//                ▼                                      │
//   starting ──▶ running ──▶ stopping ──▶ stopped ──▶ archiving ──▶ archived
//                                            ▲   │                       │
//                                            │   └─────────────┐         │
//                                            │                 ▼         │
//                                            └────── restoring ◀─────────┘
//
//   any → terminated   (operator delete OR end of grace after archive)
//
// Billing semantics:
//   "Hot" states (starting/running/stopping) bill vCPU + RAM seconds.
//   "Storage-billed" varies: stopped + restoring bill local NVMe storage,
//   archived bills cheap archive storage, archiving + restoring bill
//   both (we keep both copies during transfer for safety).

export const SANDBOX_LIFECYCLE_STATES = [
  'starting',     // boot in progress; resources pinned
  'running',      // actively using vCPU + RAM
  'stopping',     // graceful shutdown in progress; resources still pinned
  'stopped',      // no compute, local NVMe storage retained
  'archiving',    // copy local → cold storage in progress (both billed)
  'archived',     // local dataset removed; cold-storage only
  'restoring',    // copy cold → local in progress (both billed)
  'terminated',   // dataset and metadata gone; final state
] as const;

export type SandboxLifecycleState = (typeof SANDBOX_LIFECYCLE_STATES)[number];

const HOT_STATES = new Set<SandboxLifecycleState>(['starting', 'running', 'stopping']);

// True when CPU + RAM are pinned and billable on the host.
export function isHotState(state: SandboxLifecycleState): boolean {
  return HOT_STATES.has(state);
}

// Which storage tier(s) the sandbox is billed for in this state.
//   local   — fast NVMe on the cluster member
//   archive — cheap object storage (e.g., Hetzner Storage Box, S3)
// During archiving/restoring both are billed (we keep both for safety).
export function isStorageBilled(state: SandboxLifecycleState): { local: boolean; archive: boolean } {
  switch (state) {
    case 'starting':
    case 'running':
    case 'stopping':
    case 'stopped':
      return { local: true, archive: false };
    case 'archiving':
    case 'restoring':
      return { local: true, archive: true };
    case 'archived':
      return { local: false, archive: true };
    case 'terminated':
      return { local: false, archive: false };
  }
}

const SANDBOX_TRANSITIONS: Record<SandboxLifecycleState, SandboxLifecycleState[]> = {
  starting:   ['running', 'stopping', 'terminated'],
  running:    ['stopping', 'terminated'],
  stopping:   ['stopped', 'terminated'],
  stopped:    ['starting', 'archiving', 'terminated'],
  archiving:  ['archived', 'terminated'],
  archived:   ['restoring', 'terminated'],
  restoring:  ['stopped', 'terminated'],
  terminated: [],
};

export function canTransitionSandbox(from: SandboxLifecycleState, to: SandboxLifecycleState): boolean {
  return SANDBOX_TRANSITIONS[from]?.includes(to) ?? false;
}

export function applyTransitionSandbox(from: SandboxLifecycleState, to: SandboxLifecycleState): SandboxLifecycleState {
  if (from === to) return from;
  if (!canTransitionSandbox(from, to)) {
    throw new Error(`invalid transition: ${from} → ${to}`);
  }
  return to;
}
