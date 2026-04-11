import { deriveBaremetalCellIdentity } from '@/server/lib/baremetal/cells';
import { leaseHostCapacity, type LeaseHostCapacityResult, type RequestedHostCapacity } from '@/server/lib/baremetal/reservations';

export const CONTROL_PLANE_ALLOCATOR_SERVICE = 'allocator' as const;

export async function reserveCapacityForMachineCreate(input: {
  machineId: string;
  region: string;
  requestedHostId?: string;
  resources: RequestedHostCapacity;
  imageId?: string | null;
  imageAlias?: string | null;
  executor?: Parameters<typeof leaseHostCapacity>[0]['executor'];
}) {
  return leaseHostCapacity(input);
}

export function buildMachinePlacementProviderMeta(lease: LeaseHostCapacityResult, resources: RequestedHostCapacity) {
  const selectedCell = lease.host.cell ?? deriveBaremetalCellIdentity(lease.host);

  return {
    baremetal_host_id: lease.host.id,
    baremetal_cell_id: selectedCell?.id ?? lease.host.cellId ?? null,
    baremetal_cell_slug: selectedCell?.slug ?? null,
    baremetal_cell_generation: selectedCell?.generation ?? lease.host.generation ?? null,
    runner_base_url: lease.host.runnerBaseUrl,
    public_ipv4: lease.host.publicIpv4 ?? null,
    public_ipv6: lease.host.publicIpv6 ?? null,
    reservation_id: lease.reservation.id,
    placement_decision: {
      selected_host_id: lease.decision.selectedHostId,
      selected_cell_id: selectedCell?.id ?? null,
      selected_cell_slug: selectedCell?.slug ?? null,
      outcome: lease.decision.outcome,
      summary: lease.decision.summary,
      explanation: lease.decision.explanation,
    },
    vcpu: resources.vcpu,
    ram_gb: resources.memoryGb,
    disk_gb: resources.diskGb,
  };
}
