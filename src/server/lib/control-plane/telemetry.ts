import { projectHeartbeatStateToMachine, upsertHeartbeatState, type HeartbeatPayload } from '@/server/lib/heartbeat-state';
import type { Machine } from '@/server/db/schema';

export const CONTROL_PLANE_TELEMETRY_SERVICE = 'telemetry' as const;

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
