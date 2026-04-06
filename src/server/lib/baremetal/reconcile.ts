import { resolvePlanForDisplay } from '@/lib/plan-catalog';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { baremetalHosts, images, machines } from '../../db/schema';
import { HttpBaremetalRunnerClient } from './runner-client';
import type { RunnerHostState } from './types';

type HostRow = typeof baremetalHosts.$inferSelect;
type MachineRow = typeof machines.$inferSelect;
type ImageRow = typeof images.$inferSelect;

type ReconcileDeps = {
  loadHosts: () => Promise<HostRow[]>;
  loadMachines: () => Promise<MachineRow[]>;
  loadImages: () => Promise<ImageRow[]>;
  fetchRunnerState: (host: HostRow) => Promise<RunnerHostState>;
  updateHost: (hostId: string, patch: Partial<HostRow>) => Promise<void>;
  updateMachine: (machineId: string, patch: Partial<MachineRow>) => Promise<void>;
  updateImage: (imageId: string, patch: Partial<ImageRow>) => Promise<void>;
};

export interface BaremetalHostReconciliationResult {
  hostId: string;
  status: 'ok' | 'error' | 'skipped';
  instanceCount: number;
  imageCount: number;
  staleMachineIds: string[];
  staleImageIds: string[];
  orphanInstanceIds: string[];
  error?: string;
}

export interface BaremetalFleetReconciliationResult {
  checkedAt: string;
  hosts: BaremetalHostReconciliationResult[];
}

function defaultDeps(): ReconcileDeps {
  return {
    loadHosts: () => db.select().from(baremetalHosts),
    loadMachines: () => db.select().from(machines),
    loadImages: () => db.select().from(images),
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
  };
}

function readMachineMeta(machine: MachineRow) {
  return (machine.providerMeta ?? {}) as Record<string, unknown>;
}

function machineHostId(machine: MachineRow) {
  const meta = readMachineMeta(machine);
  return typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null;
}

function expectedInstanceId(machine: MachineRow) {
  return machine.providerServerId || `justavps-${machine.slug}`;
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

function buildHostMetadata(host: HostRow, state: RunnerHostState, details: { staleMachineIds: string[]; staleImageIds: string[]; orphanInstanceIds: string[]; }) {
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
    },
  };
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

  for (const instance of input.runnerState.instances) {
    if (typeof instance.vcpu === 'number') usedVcpu += instance.vcpu;
    if (typeof instance.memoryGb === 'number') usedMemoryGb += instance.memoryGb;
    if (typeof instance.diskGb === 'number') usedDiskGb += instance.diskGb;

    if (!machinesByInstanceId.has(instance.instanceId)) {
      orphanInstanceIds.push(instance.instanceId);
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
  };
}

export async function reconcileBaremetalFleet(depsArg?: Partial<ReconcileDeps>): Promise<BaremetalFleetReconciliationResult> {
  const deps = { ...defaultDeps(), ...(depsArg ?? {}) } as ReconcileDeps;
  const checkedAt = new Date().toISOString();
  const [hosts, allMachines, allImages] = await Promise.all([
    deps.loadHosts(),
    deps.loadMachines(),
    deps.loadImages(),
  ]);

  const results: BaremetalHostReconciliationResult[] = [];
  const runnerImageAliases = new Set<string>();
  const liveInstanceIds = new Set<string>();
  const staleImageIds = new Set<string>();
  const updatedMachineIds = new Set<string>();

  const deletedWithoutTimestamp = allMachines.filter((machine) => machine.provider === 'baremetal' && machine.status === 'deleted' && machine.deletedAt === null);
  for (const machine of deletedWithoutTimestamp) {
    await deps.updateMachine(machine.id, { deletedAt: new Date(checkedAt) });
  }

  for (const host of hosts) {
    if (!host.runnerBaseUrl || !host.runnerToken || host.status === 'deleted') {
      results.push({
        hostId: host.id,
        status: 'skipped',
        instanceCount: 0,
        imageCount: 0,
        staleMachineIds: [],
        staleImageIds: [],
        orphanInstanceIds: [],
      });
      continue;
    }

    try {
      const state = await deps.fetchRunnerState(host);
      for (const instance of state.instances) liveInstanceIds.add(instance.instanceId);
      const activeMachines = allMachines.filter((machine) => isLiveMachineCandidate(machine, host.id));
      const instancesById = new Set(state.instances.map((instance) => instance.instanceId));
      const staleMachineRows = activeMachines.filter((machine) => machine.status !== 'provisioning' && !instancesById.has(expectedInstanceId(machine)));
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

      await deps.updateHost(host.id, {
        status: state.incus.status === 'ok' ? 'active' : 'error',
        lastHeartbeatAt: new Date(checkedAt),
        usedVcpu: usage.usedVcpu,
        usedMemoryGb: usage.usedMemoryGb,
        usedDiskGb: usage.usedDiskGb,
        metadata: buildHostMetadata(host, state, {
          staleMachineIds: staleMachineRows.map((machine) => machine.id),
          staleImageIds: [],
          orphanInstanceIds: usage.orphanInstanceIds,
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.updateHost(host.id, {
        status: 'error',
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
        error: message,
      });
    }
  }

  const fleetStaleMachines = allMachines.filter((machine) => {
    if (machine.provider !== 'baremetal' || machine.deletedAt !== null || machine.status === 'deleted') return false;
    if (machine.status === 'provisioning') return false;
    if (updatedMachineIds.has(machine.id)) return false;
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

  const fleetStaleMachineIds = new Set(fleetStaleMachines.map((machine) => machine.id));
  for (const result of results) {
    result.staleMachineIds = unique([...result.staleMachineIds, ...fleetStaleMachineIds]);
  }

  const canReconcileImages = results.every((result) => result.status !== 'error');
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
