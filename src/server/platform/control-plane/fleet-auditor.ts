import { reconcileBaremetalFleet } from "@/server/platform/baremetal/reconcile";
import { pruneDeletedMachinePortAllocations } from "@/server/platform/baremetal/port-allocations";
import { syncPendingProcurements } from "@/server/platform/baremetal/procurement-sync";

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from "@/server/platform/control-plane/service-state";

const CONTROL_PLANE_FLEET_AUDITOR_SERVICE = 'fleet_auditor' as const;
const FLEET_AUDITOR_SCOPE = 'baremetal';

export async function runFleetAuditorServicePass(options?: {
  leaseMs?: number;
  leaseOwner?: string;
  maxHosts?: number;
}) {
  const lease = await acquireControlPlaneServiceLease({
    service: CONTROL_PLANE_FLEET_AUDITOR_SERVICE,
    scope: FLEET_AUDITOR_SCOPE,
    leaseMs: options?.leaseMs,
    leaseOwner: options?.leaseOwner,
  });
  if (!lease.acquired) {
    return {
      acquired: false,
      hostsChecked: 0,
      leaseOwner: lease.leaseOwner,
      scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_FLEET_AUDITOR_SERVICE, scope: FLEET_AUDITOR_SCOPE }),
    };
  }

  const result = await reconcileBaremetalFleet(undefined, {
    onlyDueHosts: true,
    dueAfterMs: 5 * 60 * 1000,
    maxHosts: options?.maxHosts ?? 10,
    skipGlobalMachineAudit: true,
    skipGlobalImageAudit: true,
  });
  const prunedPortAllocations = await pruneDeletedMachinePortAllocations();
  const procurementSync = await syncPendingProcurements().catch((err) => ({
    checked: 0,
    updated: 0,
    promotedToBootstrapping: 0,
    errors: [{ procurementId: 'n/a', error: err instanceof Error ? err.message : String(err) }],
  }));

  await releaseControlPlaneServiceLease({
    service: CONTROL_PLANE_FLEET_AUDITOR_SERVICE,
    scope: FLEET_AUDITOR_SCOPE,
    leaseOwner: lease.leaseOwner,
    checkpoint: {
      last_reconcile_at: result.checkedAt,
      last_host_count: result.hosts.length,
      last_error_count: result.hosts.filter((host) => host.status === 'error').length,
      last_deleted_port_allocation_pruned_count: prunedPortAllocations,
      last_procurement_sync_checked: procurementSync.checked,
      last_procurement_sync_promoted: procurementSync.promotedToBootstrapping,
      last_procurement_sync_errors: procurementSync.errors.length,
    },
  });

  return {
    acquired: true,
    hostsChecked: result.hosts.length,
    portAllocationsPruned: prunedPortAllocations,
    procurementsSynced: procurementSync.checked,
    procurementsPromoted: procurementSync.promotedToBootstrapping,
    checkedAt: result.checkedAt,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_FLEET_AUDITOR_SERVICE, scope: FLEET_AUDITOR_SCOPE }),
  };
}
