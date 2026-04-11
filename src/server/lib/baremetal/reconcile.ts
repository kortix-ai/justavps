import { resolvePlanForDisplay } from '@/lib/plan-catalog';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { baremetalHosts, hostCapacityReservations, images, machines } from '../../db/schema';
import { ensureBaremetalHostCellAssignment } from './cell-store';
import { expireStaleHostCapacityReservations } from './reservations';
import { syncHostImageAvailabilityFromRunnerState } from './image-locality';
import { backfillMachinePortAllocationsFromMachine } from './port-allocations';
import { HttpBaremetalRunnerClient } from './runner-client';
import type { RunnerHostState } from './types';

type HostRow = typeof baremetalHosts.$inferSelect;
type MachineRow = typeof machines.$inferSelect;
type ImageRow = typeof images.$inferSelect;
type HostCapacityReservationRow = typeof hostCapacityReservations.$inferSelect;

type ReconcileDeps = {
  loadHosts: () => Promise<HostRow[]>;
  loadMachines: () => Promise<MachineRow[]>;
  loadImages: () => Promise<ImageRow[]>;
  loadReservations: () => Promise<HostCapacityReservationRow[]>;
  expireReservations: (now: Date) => Promise<void>;
  fetchRunnerState: (host: HostRow) => Promise<RunnerHostState>;
  updateHost: (hostId: string, patch: Partial<HostRow>) => Promise<void>;
  updateMachine: (machineId: string, patch: Partial<MachineRow>) => Promise<void>;
  updateImage: (imageId: string, patch: Partial<ImageRow>) => Promise<void>;
  updateReservation: (reservationId: string, patch: Partial<HostCapacityReservationRow>) => Promise<void>;
  syncHostImageAvailability: (input: { hostId: string; images: Array<{ imageId: string; aliases: string[] }>; at: Date }) => Promise<void>;
  syncMachinePortAllocations: (machine: MachineRow) => Promise<void>;
};

export interface BaremetalHostReconciliationResult {
  hostId: string;
  status: 'ok' | 'error' | 'skipped';
  instanceCount: number;
  imageCount: number;
  staleMachineIds: string[];
  staleImageIds: string[];
  orphanInstanceIds: string[];
  warmPoolInstanceIds: string[];
  error?: string;
}

export interface BaremetalFleetReconciliationResult {
  checkedAt: string;
  hosts: BaremetalHostReconciliationResult[];
}

export interface ReconcileBaremetalFleetOptions {
  hostIds?: string[];
  onlyDueHosts?: boolean;
  dueAfterMs?: number;
  maxHosts?: number;
  skipGlobalMachineAudit?: boolean;
  skipGlobalImageAudit?: boolean;
}

const DEFAULT_HOST_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

function defaultDeps(): ReconcileDeps {
  return {
    loadHosts: () => db.select().from(baremetalHosts),
    loadMachines: () => db.select().from(machines),
    loadImages: () => db.select().from(images),
    loadReservations: () => db.select().from(hostCapacityReservations),
    expireReservations: (now) => expireStaleHostCapacityReservations(now),
    fetchRunnerState: async (host) => {
      if (!host.runnerBaseUrl || !host.runnerToken) {
        throw new Error(`baremetal host ${host.id} is missing runner connection metadata`);
      }
      return new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken).getState();
    },
    updateHost: async (hostId, patch) => {
      await db.update(baremetalHosts).set(patch).where(eq(baremetalHosts.id, hostId));
    },
    updateMachine: async (machineId, patch) => {
      await db.update(machines).set(patch).where(eq(machines.id, machineId));
    },
    updateImage: async (imageId, patch) => {
      await db.update(images).set(patch).where(eq(images.id, imageId));
    },
    updateReservation: async (reservationId, patch) => {
      await db.update(hostCapacityReservations).set(patch).where(eq(hostCapacityReservations.id, reservationId));
    },
    syncHostImageAvailability: (input) => syncHostImageAvailabilityFromRunnerState(input),
    syncMachinePortAllocations: async (machine) => {
      await backfillMachinePortAllocationsFromMachine(machine);
    },
  };
}

function readMachineMeta(machine: MachineRow) {
  return (machine.providerMeta ?? {}) as Record<string, unknown>;
}

function machineHostId(machine: MachineRow) {
  if (machine.baremetalHostId) return machine.baremetalHostId;
  const meta = readMachineMeta(machine);
  return typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null;
}

function expectedInstanceId(machine: MachineRow) {
  return machine.providerServerId || `justavps-${machine.slug}`;
}

function isWarmPoolInstance(instanceId: string) {
  return instanceId.startsWith('justavps-warm-');
}

function runnerInstanceIsWarmPool(instance: { instanceId: string; role?: string | null }) {
  return instance.role === 'warm_pool_reserve' || isWarmPoolInstance(instance.instanceId);
}

function isLiveMachineCandidate(machine: MachineRow, hostId: string) {
  return machine.provider === 'baremetal'
    && machine.deletedAt === null
    && machineHostId(machine) === hostId;
}

function isLiveImageCandidate(image: ImageRow) {
  return image.provider === 'baremetal' && image.status !== 'deleted';
}

function capacityForMachine(machine: MachineRow) {
  const plan = resolvePlanForDisplay(machine.serverType);
  return {
    vcpu: plan?.vcpu ?? 0,
    memoryGb: plan?.memory ?? 0,
    diskGb: plan?.disk ?? 0,
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function shouldReleaseCommittedReservation(machine: MachineRow | undefined) {
  if (!machine) return true;
  return machine.deletedAt !== null || machine.status === 'deleted';
}

function shouldReleaseReservedReservation(machine: MachineRow | undefined) {
  if (!machine) return true;
  return machine.deletedAt !== null || machine.status === 'deleted' || machine.status === 'error';
}

function reconciledHostStatus(host: HostRow, runnerStatus: RunnerHostState['incus']['status']) {
  if (host.status === 'disabled') return 'disabled';
  return runnerStatus === 'ok' ? 'active' : 'error';
}

function buildHostMetadata(host: HostRow, state: RunnerHostState, details: { staleMachineIds: string[]; staleImageIds: string[]; orphanInstanceIds: string[]; warmPoolInstanceIds: string[]; }) {
  return {
    ...(host.metadata ?? {}),
    reconciliation: {
      checked_at: state.checkedAt,
      runnerd_status: state.runnerd,
      incus_status: state.incus.status,
      server_version: state.incus.serverVersion,
      instance_count: state.incus.instanceCount,
      image_count: state.incus.imageCount,
      stale_machine_ids: details.staleMachineIds,
      stale_image_ids: details.staleImageIds,
      orphan_instance_ids: details.orphanInstanceIds,
      warm_pool_instance_ids: details.warmPoolInstanceIds,
    },
  };
}

function hostLastReconciledAt(host: HostRow) {
  const reconciliation = (host.metadata?.reconciliation ?? {}) as Record<string, unknown>;
  const checkedAt = reconciliation.checked_at;
  if (typeof checkedAt !== 'string') return null;
  const parsed = new Date(checkedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shouldReconcileHost(host: HostRow, checkedAt: Date, options: ReconcileBaremetalFleetOptions) {
  if (options.hostIds?.includes(host.id)) return true;
  if (!options.onlyDueHosts) return true;
  if (host.status === 'error' || host.maintenanceState === 'draining') return true;

  const dueAfterMs = options.dueAfterMs ?? DEFAULT_HOST_RECONCILE_INTERVAL_MS;
  const lastReconciledAt = hostLastReconciledAt(host) ?? host.lastHeartbeatAt;
  if (!lastReconciledAt) return true;
  return checkedAt.getTime() - lastReconciledAt.getTime() >= dueAfterMs;
}

export function summarizeHostUsage(input: {
  host: HostRow;
  runnerState: RunnerHostState;
  activeMachines: MachineRow[];
}) {
  const machinesByInstanceId = new Map(input.activeMachines.map((machine) => [expectedInstanceId(machine), machine]));
  let usedVcpu = 0;
  let usedMemoryGb = 0;
  let usedDiskGb = 0;
  const orphanInstanceIds: string[] = [];
  const warmPoolInstanceIds: string[] = [];

  for (const instance of input.runnerState.instances) {
    if (typeof instance.vcpu === 'number') usedVcpu += instance.vcpu;
    if (typeof instance.memoryGb === 'number') usedMemoryGb += instance.memoryGb;
    if (typeof instance.diskGb === 'number') usedDiskGb += instance.diskGb;

    if (!machinesByInstanceId.has(instance.instanceId)) {
      if (runnerInstanceIsWarmPool(instance)) {
        warmPoolInstanceIds.push(instance.instanceId);
      } else {
        orphanInstanceIds.push(instance.instanceId);
      }
      continue;
    }

    if (instance.vcpu == null || instance.memoryGb == null || instance.diskGb == null) {
      const capacity = capacityForMachine(machinesByInstanceId.get(instance.instanceId)!);
      if (instance.vcpu == null) usedVcpu += capacity.vcpu;
      if (instance.memoryGb == null) usedMemoryGb += capacity.memoryGb;
      if (instance.diskGb == null) usedDiskGb += capacity.diskGb;
    }
  }

  return {
    usedVcpu,
    usedMemoryGb,
    usedDiskGb,
    orphanInstanceIds: unique(orphanInstanceIds),
    warmPoolInstanceIds: unique(warmPoolInstanceIds),
  };
}

export async function reconcileBaremetalFleet(
  depsArg?: Partial<ReconcileDeps>,
  options: ReconcileBaremetalFleetOptions = {},
): Promise<BaremetalFleetReconciliationResult> {
  const deps = { ...defaultDeps(), ...(depsArg ?? {}) } as ReconcileDeps;
  if (depsArg && !depsArg.syncHostImageAvailability) {
    deps.syncHostImageAvailability = async () => {};
  }
  if (depsArg && !depsArg.syncMachinePortAllocations) {
    deps.syncMachinePortAllocations = async () => {};
  }
  const checkedAt = new Date().toISOString();
  await deps.expireReservations(new Date(checkedAt));
  const [hosts, allMachines, allImages, allReservations] = await Promise.all([
    deps.loadHosts(),
    deps.loadMachines(),
    deps.loadImages(),
    deps.loadReservations(),
  ]);

  const results: BaremetalHostReconciliationResult[] = [];
  const machinesById = new Map(allMachines.map((machine) => [machine.id, machine]));
  const runnerImageAliases = new Set<string>();
  const liveInstanceIds = new Set<string>();
  const staleImageIds = new Set<string>();
  const updatedMachineIds = new Set<string>();
  const selectedHostIds = new Set<string>();
  const selectedHostFilter = options.hostIds ? new Set(options.hostIds) : null;
  const checkedAtDate = new Date(checkedAt);

  const deletedWithoutTimestamp = allMachines.filter((machine) => machine.provider === 'baremetal' && machine.status === 'deleted' && machine.deletedAt === null);
  for (const machine of deletedWithoutTimestamp) {
    await deps.updateMachine(machine.id, { deletedAt: new Date(checkedAt) });
  }

  let hostsToProcess = selectedHostFilter
    ? hosts.filter((host) => selectedHostFilter.has(host.id))
    : hosts.filter((host) => shouldReconcileHost(host, checkedAtDate, options));
  if (typeof options.maxHosts === 'number') {
    hostsToProcess = hostsToProcess.slice(0, options.maxHosts);
  }

  for (const host of hostsToProcess) {
    selectedHostIds.add(host.id);
    if (!host.runnerBaseUrl || !host.runnerToken || host.status === 'deleted') {
      results.push({
        hostId: host.id,
        status: 'skipped',
        instanceCount: 0,
        imageCount: 0,
        staleMachineIds: [],
        staleImageIds: [],
        orphanInstanceIds: [],
        warmPoolInstanceIds: [],
      });
      continue;
    }

    try {
      const cell = await ensureBaremetalHostCellAssignment({ host });
      const state = await deps.fetchRunnerState(host);
      for (const instance of state.instances) liveInstanceIds.add(instance.instanceId);
      const hostMachines = allMachines.filter((machine) => machine.provider === 'baremetal' && machineHostId(machine) === host.id);
      for (const machine of hostMachines) {
        if (!machine.baremetalHostId) {
          await deps.updateMachine(machine.id, { baremetalHostId: host.id });
        }
      }
      const activeMachines = allMachines.filter((machine) => isLiveMachineCandidate(machine, host.id));
      const instancesById = new Set(state.instances.map((instance) => instance.instanceId));
      const staleMachineRows = activeMachines.filter((machine) => machine.status !== 'provisioning' && !instancesById.has(expectedInstanceId(machine)));
      const liveMachineRows = activeMachines.filter((machine) => instancesById.has(expectedInstanceId(machine)));
      const usage = summarizeHostUsage({ host, runnerState: state, activeMachines });

      for (const machine of staleMachineRows) {
        const meta = readMachineMeta(machine);
        await deps.updateMachine(machine.id, {
          status: 'deleted',
          deletedAt: new Date(checkedAt),
          providerMeta: {
            ...meta,
            reconciliation: {
              missing_from_host: true,
              checked_at: checkedAt,
              previous_status: machine.status,
            },
          },
        });
        updatedMachineIds.add(machine.id);
      }

      for (const image of state.images) {
        for (const alias of image.aliases) runnerImageAliases.add(alias);
        runnerImageAliases.add(image.imageId);
      }
      await deps.syncHostImageAvailability({
        hostId: host.id,
        images: state.images.map((image) => ({ imageId: image.imageId, aliases: image.aliases })),
        at: new Date(checkedAt),
      });
      for (const machine of liveMachineRows) {
        await deps.syncMachinePortAllocations(machine);
      }

      await deps.updateHost(host.id, {
        status: reconciledHostStatus(host, state.incus.status),
        lastHeartbeatAt: new Date(checkedAt),
        generation: cell.generation,
        cellId: cell.id,
        usedVcpu: usage.usedVcpu,
        usedMemoryGb: usage.usedMemoryGb,
        usedDiskGb: usage.usedDiskGb,
        metadata: buildHostMetadata(host, state, {
          staleMachineIds: staleMachineRows.map((machine) => machine.id),
          staleImageIds: [],
          orphanInstanceIds: usage.orphanInstanceIds,
          warmPoolInstanceIds: usage.warmPoolInstanceIds,
        }),
        updatedAt: new Date(checkedAt),
      });

      results.push({
        hostId: host.id,
        status: 'ok',
        instanceCount: state.instances.length,
        imageCount: state.images.length,
        staleMachineIds: staleMachineRows.map((machine) => machine.id),
        staleImageIds: [],
        orphanInstanceIds: usage.orphanInstanceIds,
        warmPoolInstanceIds: usage.warmPoolInstanceIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.updateHost(host.id, {
        status: reconciledHostStatus(host, 'error'),
        metadata: {
          ...(host.metadata ?? {}),
          reconciliation: {
            checked_at: checkedAt,
            error: message,
          },
        },
        updatedAt: new Date(checkedAt),
      });
      results.push({
        hostId: host.id,
        status: 'error',
        instanceCount: 0,
        imageCount: 0,
        staleMachineIds: [],
        staleImageIds: [],
        orphanInstanceIds: [],
        warmPoolInstanceIds: [],
        error: message,
      });
    }
  }

  const fleetStaleMachines = options.skipGlobalMachineAudit ? [] : allMachines.filter((machine) => {
    if (machine.provider !== 'baremetal' || machine.deletedAt !== null || machine.status === 'deleted') return false;
    if (machine.status === 'provisioning') return false;
    if (updatedMachineIds.has(machine.id)) return false;
    if (selectedHostIds.size > 0) {
      const hostId = machineHostId(machine);
      if (hostId && !selectedHostIds.has(hostId)) return false;
    }
    return !liveInstanceIds.has(expectedInstanceId(machine));
  });

  for (const machine of fleetStaleMachines) {
    const meta = readMachineMeta(machine);
    await deps.updateMachine(machine.id, {
      status: 'deleted',
      deletedAt: new Date(checkedAt),
      providerMeta: {
        ...meta,
        reconciliation: {
          missing_from_host: true,
          checked_at: checkedAt,
          previous_status: machine.status,
        },
      },
    });
  }

  const deletedMachineIds = new Set([
    ...deletedWithoutTimestamp.map((machine) => machine.id),
    ...updatedMachineIds,
    ...fleetStaleMachines.map((machine) => machine.id),
  ]);
  const erroredMachineIds = new Set(allMachines.filter((machine) => machine.status === 'error').map((machine) => machine.id));

  for (const reservation of allReservations) {
    const machine = machinesById.get(reservation.machineId);
    const treatedAsDeleted = deletedMachineIds.has(reservation.machineId);
    const treatedAsErrored = erroredMachineIds.has(reservation.machineId);
    if (reservation.state === 'committed' && (!machine || treatedAsDeleted || shouldReleaseCommittedReservation(machine))) {
      await deps.updateReservation(reservation.id, {
        state: 'released',
        releasedAt: new Date(checkedAt),
        updatedAt: new Date(checkedAt),
        metadata: {
          ...(reservation.metadata ?? {}),
          reconciled_release_reason: machine || treatedAsDeleted ? 'machine_deleted' : 'machine_missing',
        },
      });
    }
    if (reservation.state === 'reserved' && (!machine || treatedAsDeleted || treatedAsErrored || shouldReleaseReservedReservation(machine))) {
      await deps.updateReservation(reservation.id, {
        state: 'released',
        releasedAt: new Date(checkedAt),
        updatedAt: new Date(checkedAt),
        metadata: {
          ...(reservation.metadata ?? {}),
          reconciled_release_reason: treatedAsErrored || machine?.status === 'error' ? 'machine_error' : machine || treatedAsDeleted ? 'machine_deleted' : 'machine_missing',
        },
      });
    }
  }

  const fleetStaleMachineIds = new Set(fleetStaleMachines.map((machine) => machine.id));
  for (const result of results) {
    result.staleMachineIds = unique([...result.staleMachineIds, ...fleetStaleMachineIds]);
  }

  const canReconcileImages = !options.skipGlobalImageAudit && results.every((result) => result.status !== 'error');
  const staleImages = canReconcileImages ? allImages.filter((image) => {
    if (!isLiveImageCandidate(image)) return false;
    if (image.providerImageId) return !runnerImageAliases.has(image.providerImageId);
    return image.status === 'failed';
  }) : [];

  for (const image of staleImages) {
    staleImageIds.add(image.id);
    await deps.updateImage(image.id, {
      status: 'deleted',
      description: image.description ? `${image.description} [reconciled missing from host ${checkedAt}]` : `Reconciled missing from host at ${checkedAt}`,
      updatedAt: new Date(checkedAt),
    });
  }

  if (staleImageIds.size > 0) {
    for (const result of results) {
      if (result.status !== 'ok') continue;
      result.staleImageIds = [...staleImageIds];
    }
  }

  return { checkedAt, hosts: results };
}

export async function reconcileBaremetalHost(hostId: string, depsArg?: Partial<ReconcileDeps>) {
  const result = await reconcileBaremetalFleet(depsArg, {
    hostIds: [hostId],
    skipGlobalMachineAudit: true,
    skipGlobalImageAudit: true,
  });
  return result.hosts[0] ?? null;
}
