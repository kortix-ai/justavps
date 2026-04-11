import { eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db';
import { machineHeartbeatStates, machines, type Machine, type MachineHeartbeatStateRow } from '../db/schema';

export const HEARTBEAT_MACHINE_PROJECTION_MS = 2 * 60 * 1000;

export interface HeartbeatPayload {
  daemonVersion?: string | null;
  uptime: number;
  services: Record<string, boolean>;
  load: {
    cpu: number;
    memory: number;
    disk: number;
  };
  network?: {
    bytes_in: number;
    bytes_out: number;
    rate_in: number;
    rate_out: number;
    connections: number;
  };
  security?: {
    ufw_active: boolean;
    fail2ban_active: boolean;
    ssh_key_only: boolean;
  };
}

export interface HeartbeatUpsertResult {
  state: MachineHeartbeatStateRow;
  projectedMachinePatch: Partial<Machine> | null;
}

export function buildHeartbeatSnapshot(payload: HeartbeatPayload) {
  return {
    cpu: payload.load.cpu,
    memory: payload.load.memory,
    disk: payload.load.disk,
    services: payload.services,
    ...(payload.network ? { network: payload.network } : {}),
    ...(payload.security ? { security: payload.security } : {}),
  };
}

export function heartbeatProjectionDue(input: {
  machine: Pick<Machine, 'lastHeartbeatAt' | 'lastHeartbeat' | 'daemonVersion' | 'status' | 'readyAt' | 'provisioningStage' | 'providerMeta'>;
  existingState?: Pick<MachineHeartbeatStateRow, 'lastProjectedAt'> | null;
  heartbeatAt: Date;
  shouldMarkReady: boolean;
  payload: HeartbeatPayload;
}) {
  if (input.shouldMarkReady) return true;
  if (!input.machine.lastHeartbeatAt) return true;
  if (!input.existingState?.lastProjectedAt) return true;

  const ageMs = input.heartbeatAt.getTime() - input.existingState.lastProjectedAt.getTime();
  if (ageMs >= HEARTBEAT_MACHINE_PROJECTION_MS) return true;

  const daemonVersion = input.payload.daemonVersion ?? null;
  if (daemonVersion && daemonVersion !== input.machine.daemonVersion) return true;

  const currentSecurity = input.machine.lastHeartbeat?.security;
  const nextSecurity = input.payload.security;
  if (JSON.stringify(currentSecurity ?? null) !== JSON.stringify(nextSecurity ?? null)) return true;

  return false;
}

export function buildHeartbeatMachineProjection(input: {
  machine: Pick<Machine, 'status' | 'providerMeta'>;
  heartbeatAt: Date;
  shouldMarkReady: boolean;
  payload: HeartbeatPayload;
}): Partial<Machine> {
  const providerMeta = {
    ...((input.machine.providerMeta ?? {}) as Record<string, unknown>),
    last_callback_at: input.heartbeatAt.toISOString(),
    ...(input.shouldMarkReady ? { ready_via: 'heartbeat' } : {}),
  };

  return {
    lastHeartbeatAt: input.heartbeatAt,
    lastHeartbeat: buildHeartbeatSnapshot(input.payload),
    ...(input.payload.daemonVersion ? { daemonVersion: input.payload.daemonVersion } : {}),
    providerMeta,
    ...(input.shouldMarkReady ? { status: 'ready', readyAt: input.heartbeatAt, provisioningStage: 'services_ready' } : {}),
  };
}

export async function loadHeartbeatState(machineId: string) {
  const [state] = await db.select()
    .from(machineHeartbeatStates)
    .where(eq(machineHeartbeatStates.machineId, machineId))
    .limit(1);
  return state ?? null;
}

export async function listHeartbeatStatesByMachineIds(machineIds: string[]) {
  if (machineIds.length === 0) return [];
  return db.select().from(machineHeartbeatStates).where(inArray(machineHeartbeatStates.machineId, machineIds));
}

export function heartbeatStateMap(states: MachineHeartbeatStateRow[]) {
  return new Map(states.map((state) => [state.machineId, state]));
}

export async function upsertHeartbeatState(input: {
  machine: Machine;
  payload: HeartbeatPayload;
  heartbeatAt?: Date;
  shouldMarkReady: boolean;
}): Promise<HeartbeatUpsertResult> {
  const heartbeatAt = input.heartbeatAt ?? new Date();
  const existingState = await loadHeartbeatState(input.machine.id);
  const projectedMachinePatch = heartbeatProjectionDue({
    machine: input.machine,
    existingState,
    heartbeatAt,
    shouldMarkReady: input.shouldMarkReady,
    payload: input.payload,
  })
    ? buildHeartbeatMachineProjection({
        machine: input.machine,
        heartbeatAt,
        shouldMarkReady: input.shouldMarkReady,
        payload: input.payload,
      })
    : null;

  const [state] = await db.insert(machineHeartbeatStates)
    .values({
      machineId: input.machine.id,
      accountId: input.machine.accountId,
      daemonVersion: input.payload.daemonVersion ?? null,
      lastHeartbeatAt: heartbeatAt,
      lastProjectedAt: projectedMachinePatch ? heartbeatAt : existingState?.lastProjectedAt ?? null,
      heartbeatCount: 1,
      lastReadyAt: input.shouldMarkReady ? heartbeatAt : existingState?.lastReadyAt ?? null,
      uptimeSec: Math.max(0, Math.floor(input.payload.uptime)),
      services: input.payload.services,
      load: input.payload.load,
      network: input.payload.network ?? null,
      security: input.payload.security ?? null,
      updatedAt: heartbeatAt,
    })
    .onConflictDoUpdate({
      target: machineHeartbeatStates.machineId,
      set: {
        accountId: input.machine.accountId,
        daemonVersion: input.payload.daemonVersion ?? null,
        lastHeartbeatAt: heartbeatAt,
        lastProjectedAt: projectedMachinePatch ? heartbeatAt : existingState?.lastProjectedAt ?? null,
        heartbeatCount: sql`${machineHeartbeatStates.heartbeatCount} + 1`,
        lastReadyAt: input.shouldMarkReady ? heartbeatAt : existingState?.lastReadyAt ?? null,
        uptimeSec: Math.max(0, Math.floor(input.payload.uptime)),
        services: input.payload.services,
        load: input.payload.load,
        network: input.payload.network ?? null,
        security: input.payload.security ?? null,
        updatedAt: heartbeatAt,
      },
    })
    .returning();

  return { state, projectedMachinePatch };
}

export function effectiveHeartbeatForMachine(input: {
  machine: Pick<Machine, 'lastHeartbeatAt' | 'lastHeartbeat' | 'daemonVersion'>;
  state?: Pick<MachineHeartbeatStateRow, 'lastHeartbeatAt' | 'daemonVersion' | 'load' | 'services' | 'network' | 'security'> | null;
}) {
  if (!input.state) {
    return {
      lastHeartbeatAt: input.machine.lastHeartbeatAt,
      lastHeartbeat: input.machine.lastHeartbeat,
      daemonVersion: input.machine.daemonVersion,
    };
  }

  return {
    lastHeartbeatAt: input.state.lastHeartbeatAt,
    daemonVersion: input.state.daemonVersion ?? input.machine.daemonVersion,
    lastHeartbeat: {
      cpu: input.state.load.cpu,
      memory: input.state.load.memory,
      disk: input.state.load.disk,
      services: input.state.services,
      ...(input.state.network ? { network: input.state.network } : {}),
      ...(input.state.security ? { security: input.state.security } : {}),
    },
  };
}

export async function projectHeartbeatStateToMachine(input: {
  machineId: string;
  patch: Partial<Machine>;
  projectedAt?: Date;
}) {
  const projectedAt = input.projectedAt ?? new Date();
  await db.update(machines).set(input.patch).where(eq(machines.id, input.machineId));
  await db.update(machineHeartbeatStates)
    .set({ lastProjectedAt: projectedAt, updatedAt: projectedAt })
    .where(eq(machineHeartbeatStates.machineId, input.machineId));
}
