// Usage-billing worker. Reconciles live Incus instance state with the
// SandboxUsageSession table:
//   • Newly-Running instance with no open session  → open session
//   • Open session whose instance is gone or stopped → close session
//                                                      (and emit RevenueLedger row)
//   • Open session whose instance is still Running   → tick (accumulate seconds)
//
// reconcileBilling() is pure — it returns a list of events that the
// caller persists. Tested without a DB.

export type LiveInstance = {
  machineId: string;
  customerId: string | null;
  status: 'Running' | 'Stopped' | string;
  vcpus: number;
  ramGb: number;
  storageGb: number;
};

export type SessionState = {
  id: string;
  machineId: string;
  customerId: string | null;
  vcpus: number;
  ramGb: number;
  storageGb: number;
  startedAt: Date;
  lastTickAt: Date;
  state: string;
  vcpuSeconds: number;
  ramGbSeconds: number;
  storageGbSecondsLocal: number;
  storageGbSecondsArchive: number;
};

export type ReconcileEvent =
  | { kind: 'open'; machineId: string; customerId: string | null; vcpus: number; ramGb: number; storageGb: number; startedAt: Date }
  | { kind: 'tick'; sessionId: string; vcpuSecondsAdd: number; ramGbSecondsAdd: number; storageGbSecondsLocalAdd: number; lastTickAt: Date }
  | { kind: 'close'; sessionId: string; endedAt: Date };

export function reconcileBilling(opts: {
  now: Date;
  live: LiveInstance[];
  openSessions: SessionState[];
}): ReconcileEvent[] {
  const events: ReconcileEvent[] = [];
  const liveByMachine = new Map(opts.live.map((l) => [l.machineId, l]));
  const sessionByMachine = new Map(opts.openSessions.map((s) => [s.machineId, s]));

  // Open new sessions for newly-running instances.
  for (const live of opts.live) {
    if (live.status !== 'Running') continue;
    if (sessionByMachine.has(live.machineId)) continue;
    events.push({
      kind: 'open',
      machineId: live.machineId,
      customerId: live.customerId,
      vcpus: live.vcpus,
      ramGb: live.ramGb,
      storageGb: live.storageGb,
      startedAt: opts.now,
    });
  }

  // For each existing open session: emit a final tick to accumulate the
  // elapsed time since lastTickAt, THEN emit a close if the instance is
  // gone/stopped. Order matters — persistence must apply tick before close.
  for (const session of opts.openSessions) {
    const live = liveByMachine.get(session.machineId);
    const elapsedSec = (opts.now.getTime() - session.lastTickAt.getTime()) / 1000;
    if (elapsedSec > 0) {
      events.push({
        kind: 'tick',
        sessionId: session.id,
        vcpuSecondsAdd: session.vcpus * elapsedSec,
        ramGbSecondsAdd: session.ramGb * elapsedSec,
        storageGbSecondsLocalAdd: session.storageGb * elapsedSec,
        lastTickAt: opts.now,
      });
    } else if (elapsedSec === 0 && live && live.status === 'Running') {
      // Idempotent zero-tick on same timestamp — skip (no-op).
    }
    const stillRunning = live && live.status === 'Running';
    if (!stillRunning) {
      events.push({ kind: 'close', sessionId: session.id, endedAt: opts.now });
    }
  }

  return events;
}
