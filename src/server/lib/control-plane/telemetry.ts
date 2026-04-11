import { projectHeartbeatStateToMachine, upsertHeartbeatState, type HeartbeatPayload } from '@/server/lib/heartbeat-state';
import { pruneExpiredMachineEvents } from '@/server/lib/event-bus';
import { pruneExpiredMachineTelemetryRollups } from '@/server/lib/machine-telemetry';
import type { Machine } from '@/server/db/schema';

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from './service-state';

export const CONTROL_PLANE_TELEMETRY_SERVICE = 'telemetry' as const;
export const TELEMETRY_RETENTION_SCOPE = 'retention';

export async function ingestMachineHeartbeat(input: {
  machine: Machine;
  heartbeatAt?: Date;
  shouldMarkReady: boolean;
  payload: HeartbeatPayload;
}) {
  const heartbeatAt = input.heartbeatAt ?? new Date();
  const { state, projectedMachinePatch } = await upsertHeartbeatState({
    machine: input.machine,
    heartbeatAt,
    shouldMarkReady: input.shouldMarkReady,
    payload: input.payload,
  });

  if (projectedMachinePatch) {
    await projectHeartbeatStateToMachine({
      machineId: input.machine.id,
      patch: projectedMachinePatch,
      projectedAt: heartbeatAt,
    });
  }

  return {
    state,
    projectedMachinePatch,
    projected: Boolean(projectedMachinePatch),
  };
}

export async function runTelemetryRetentionServicePass(options?: {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
}) {
  const lease = await acquireControlPlaneServiceLease({
    service: CONTROL_PLANE_TELEMETRY_SERVICE,
    scope: TELEMETRY_RETENTION_SCOPE,
    leaseMs: options?.leaseMs,
    leaseOwner: options?.leaseOwner,
  });
  if (!lease.acquired) {
    return {
      acquired: false,
      pruned: 0,
      lifecycleEventsPruned: 0,
      leaseOwner: lease.leaseOwner,
      scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_TELEMETRY_SERVICE, scope: TELEMETRY_RETENTION_SCOPE }),
    };
  }

  const lifecycleEventsPruned = await pruneExpiredMachineEvents({ limit: options?.limit ?? 500 });
  const pruned = await pruneExpiredMachineTelemetryRollups({ limit: options?.limit ?? 500 });
  await releaseControlPlaneServiceLease({
    service: CONTROL_PLANE_TELEMETRY_SERVICE,
    scope: TELEMETRY_RETENTION_SCOPE,
    leaseOwner: lease.leaseOwner,
    checkpoint: {
      last_pruned_at: new Date().toISOString(),
      last_pruned_count: pruned,
      last_lifecycle_event_pruned_count: lifecycleEventsPruned,
    },
  });

  return {
    acquired: true,
    pruned,
    lifecycleEventsPruned,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_TELEMETRY_SERVICE, scope: TELEMETRY_RETENTION_SCOPE }),
  };
}
