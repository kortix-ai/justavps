import { deriveBaremetalCellIdentity } from '@/server/lib/baremetal/cells';
import { leaseHostCapacity, type LeaseHostCapacityResult, type RequestedHostCapacity } from '@/server/lib/baremetal/reservations';
import { recordControlPlaneServiceCheckpoint } from './service-state';

export const CONTROL_PLANE_ALLOCATOR_SERVICE = 'allocator' as const;
export const ALLOCATOR_SCOPE = 'machine_create';

export async function reserveCapacityForMachineCreate(input: {
  machineId: string;
  region: string;
  requestedHostId?: string;
  resources: RequestedHostCapacity;
  imageId?: string | null;
  imageAlias?: string | null;
  executor?: Parameters<typeof leaseHostCapacity>[0]['executor'];
}) {
  const startedAt = new Date();
  try {
    const result = await leaseHostCapacity(input);
    await recordControlPlaneServiceCheckpoint({
      service: CONTROL_PLANE_ALLOCATOR_SERVICE,
      scope: ALLOCATOR_SCOPE,
      lastStartedAt: startedAt,
      lastCompletedAt: new Date(),
      checkpoint: {
        last_allocated_at: new Date().toISOString(),
        last_machine_id: input.machineId,
        last_selected_host_id: result.host.id,
        last_outcome: result.decision.outcome,
      },
      metadata: {
        last_region: input.region,
        last_resources: input.resources,
        last_error: null,
      },
    });
    return result;
  } catch (error) {
    await recordControlPlaneServiceCheckpoint({
      service: CONTROL_PLANE_ALLOCATOR_SERVICE,
      scope: ALLOCATOR_SCOPE,
      lastStartedAt: startedAt,
      lastCompletedAt: new Date(),
      checkpoint: {
        last_allocated_at: new Date().toISOString(),
        last_machine_id: input.machineId,
        last_selected_host_id: null,
        last_outcome: 'rejected',
      },
      metadata: {
        last_region: input.region,
        last_resources: input.resources,
        last_error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export function buildMachinePlacementProviderMeta(lease: LeaseHostCapacityResult, resources: RequestedHostCapacity) {
  const selectedCandidate = lease.decision.candidates?.find((candidate) => candidate.hostId === lease.host.id);
  const selectedCell = selectedCandidate?.cell ?? deriveBaremetalCellIdentity(lease.host);

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
