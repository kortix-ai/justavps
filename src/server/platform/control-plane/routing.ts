import { repairStaleMachineRoutingStates, syncMachineRoutingState } from "@/server/platform/control-plane/routing-state";

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from "@/server/platform/control-plane/service-state";

const CONTROL_PLANE_ROUTING_SERVICE = 'routing' as const;
const ROUTING_REPAIR_SCOPE = 'repair';

export async function syncRoutingFromHeartbeatReady(input: Parameters<typeof syncMachineRoutingState>[0]) {
  return syncMachineRoutingState(input);
}

export async function runRoutingRepairServicePass(limit = 25, options?: {
  leaseMs?: number;
  leaseOwner?: string;
}) {
  const lease = await acquireControlPlaneServiceLease({
    service: CONTROL_PLANE_ROUTING_SERVICE,
    scope: ROUTING_REPAIR_SCOPE,
    leaseMs: options?.leaseMs,
    leaseOwner: options?.leaseOwner,
  });
  if (!lease.acquired) {
    return {
      acquired: false,
      repaired: 0,
      leaseOwner: lease.leaseOwner,
      scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_ROUTING_SERVICE, scope: ROUTING_REPAIR_SCOPE }),
    };
  }

  const repaired = await repairStaleMachineRoutingStates(limit);
  await releaseControlPlaneServiceLease({
    service: CONTROL_PLANE_ROUTING_SERVICE,
    scope: ROUTING_REPAIR_SCOPE,
    leaseOwner: lease.leaseOwner,
    checkpoint: {
      last_repair_at: new Date().toISOString(),
      last_repair_count: repaired,
    },
  });

  return {
    acquired: true,
    repaired,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_ROUTING_SERVICE, scope: ROUTING_REPAIR_SCOPE }),
  };
}
