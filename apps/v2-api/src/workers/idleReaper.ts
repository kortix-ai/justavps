// Idle reaper. Without this, stopped sandboxes accumulate forever and
// storage grows unboundedly — turning every idle user into a permanent
// cost line. Two thresholds:
//
//   stopped_to_archive_days  — after N days idle on local NVMe, copy
//                              to cheap object storage and free the
//                              local dataset (state: stopped → archiving).
//   archive_to_delete_days   — after M days in cold storage, delete
//                              entirely. Operator should email the
//                              customer at archive time so they have a
//                              chance to restore.
//
// Policy lives in env (V2_REAP_STOPPED_DAYS, V2_REAP_ARCHIVE_DAYS) so
// you can tune without redeploying. The defaults are conservative —
// 7 days idle then 30 days archived = ~5 weeks before deletion.
//
// Pure function. Worker tick injects DB reads/writes + actual archive
// transfer (incus snapshot → storage_gb_seconds_archive).

export type ReapableSandbox = {
  machineId: string;
  customerId: string | null;
  state: string;
  lastTransitionAt: Date;
  storageGb: number;
};

export type ReapAction = {
  kind: 'archive' | 'delete';
  machineId: string;
  reason: string;
};

export type ReapPolicy = {
  stopped_to_archive_days: number;
  archive_to_delete_days: number;
};

export const DEFAULT_REAP_POLICY: ReapPolicy = {
  stopped_to_archive_days: 7,
  archive_to_delete_days: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function decideReapActions(opts: {
  sandboxes: ReapableSandbox[];
  now: Date;
  policy: ReapPolicy;
}): ReapAction[] {
  const actions: ReapAction[] = [];
  for (const sb of opts.sandboxes) {
    const ageDays = (opts.now.getTime() - sb.lastTransitionAt.getTime()) / DAY_MS;
    if (sb.state === 'stopped' && ageDays >= opts.policy.stopped_to_archive_days) {
      actions.push({
        kind: 'archive',
        machineId: sb.machineId,
        reason: `stopped for ${ageDays.toFixed(1)}d (≥ ${opts.policy.stopped_to_archive_days}d threshold)`,
      });
    } else if (sb.state === 'archived' && ageDays >= opts.policy.archive_to_delete_days) {
      actions.push({
        kind: 'delete',
        machineId: sb.machineId,
        reason: `archived for ${ageDays.toFixed(1)}d (≥ ${opts.policy.archive_to_delete_days}d threshold)`,
      });
    }
  }
  return actions;
}
