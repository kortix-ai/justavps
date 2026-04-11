import { eq, or } from 'drizzle-orm';

import { db } from '@/server/db';
import { machineRoutingStates, machines, type MachineRoutingStateRow } from '@/server/db/schema';
import { getMachinePortAllocations } from './baremetal/port-allocations';
import { cloudflareClient, type MachineRoutingKVRecord } from './cloudflare';
import { config } from './config';

type RoutingExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>;

export type MachineRoutingDesiredState = 'present' | 'absent';
export type MachineRoutingSyncState = 'pending' | 'synced' | 'absent' | 'error';

interface DesiredRoutingSnapshot {
  machineId: string;
  accountId: string;
  machineSlug: string;
  desiredState: MachineRoutingDesiredState;
  machineStatus: string;
  desiredIp: string | null;
  desiredOriginPort: number | null;
  desiredOriginHostname: string | null;
  kvState: MachineRoutingSyncState;
  dnsState: MachineRoutingSyncState;
  metadata: Record<string, unknown>;
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function buildDesiredRoutingSnapshot(input: {
  machineId: string;
  accountId: string;
  machineSlug: string;
  machineStatus: string;
  desiredIp?: string | null;
  desiredOriginPort?: number | null;
  publicIpv4?: string | null;
  publicIpv6?: string | null;
  originHostname?: string | null;
  metadata?: Record<string, unknown>;
}): DesiredRoutingSnapshot {
  const desiredIp = normalizeText(input.desiredIp);
  const machineStatus = input.machineStatus;
  const desiredState: MachineRoutingDesiredState = machineStatus === 'deleted' || machineStatus === 'error' || !desiredIp
    ? 'absent'
    : 'present';
  const shouldHaveDns = desiredState === 'present' && !!(normalizeText(input.publicIpv4) || normalizeText(input.publicIpv6));

  return {
    machineId: input.machineId,
    accountId: input.accountId,
    machineSlug: input.machineSlug,
    desiredState,
    machineStatus,
    desiredIp,
    desiredOriginPort: typeof input.desiredOriginPort === 'number' ? input.desiredOriginPort : null,
    desiredOriginHostname: normalizeText(input.originHostname),
    kvState: desiredState === 'present' ? 'pending' : 'absent',
    dnsState: shouldHaveDns ? 'pending' : 'absent',
    metadata: {
      ...(input.metadata ?? {}),
      public_ipv4: normalizeText(input.publicIpv4),
      public_ipv6: normalizeText(input.publicIpv6),
    },
  };
}

function snapshotChanged(existing: MachineRoutingStateRow | null, next: DesiredRoutingSnapshot) {
  if (!existing) return true;
  return existing.desiredState !== next.desiredState
    || existing.machineStatus !== next.machineStatus
    || (existing.desiredIp ?? null) !== next.desiredIp
    || (existing.desiredOriginPort ?? null) !== next.desiredOriginPort
    || (existing.desiredOriginHostname ?? null) !== next.desiredOriginHostname;
}

export function routingStateNeedsRepair(state: Pick<MachineRoutingStateRow, 'desiredState' | 'kvState' | 'dnsState'>) {
  if (state.desiredState === 'absent') {
    return state.kvState !== 'absent' || state.dnsState !== 'absent';
  }
  return state.kvState !== 'synced' || !['synced', 'absent'].includes(state.dnsState);
}

export function buildRoutingKVRecord(input: {
  machineId: string;
  accountId: string;
  desiredIp: string;
  machineStatus: string;
  serverType: string;
  desiredOriginPort?: number | null;
  desiredOriginHostname?: string | null;
  routingVersion: number;
}): MachineRoutingKVRecord {
  return {
    machine_id: input.machineId,
    account_id: input.accountId,
    ip: input.desiredIp,
    origin_port: input.desiredOriginPort ?? undefined,
    origin_hostname: input.desiredOriginHostname ?? undefined,
    status: input.machineStatus,
    server_type: input.serverType,
    routing_state: input.machineStatus,
    routing_version: input.routingVersion,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertMachineRoutingState(input: {
  machineId: string;
  accountId: string;
  machineSlug: string;
  machineStatus: string;
  serverType: string;
  desiredIp?: string | null;
  desiredOriginPort?: number | null;
  publicIpv4?: string | null;
  publicIpv6?: string | null;
  originHostname?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
  executor?: RoutingExecutor;
  at?: Date;
}) {
  const executor = input.executor ?? db;
  const at = input.at ?? new Date();
  const [existing] = await executor.select().from(machineRoutingStates).where(eq(machineRoutingStates.machineId, input.machineId));
  const snapshot = buildDesiredRoutingSnapshot({
    machineId: input.machineId,
    accountId: input.accountId,
    machineSlug: input.machineSlug,
    machineStatus: input.machineStatus,
    desiredIp: input.desiredIp,
    desiredOriginPort: input.desiredOriginPort,
    publicIpv4: input.publicIpv4,
    publicIpv6: input.publicIpv6,
    originHostname: input.originHostname,
    metadata: {
      ...(input.metadata ?? {}),
      last_source: input.source,
    },
  });
  const changed = snapshotChanged(existing ?? null, snapshot);
  const version = (existing?.version ?? 0) + (changed ? 1 : 0);

  const [row] = await executor.insert(machineRoutingStates)
    .values({
      machineId: snapshot.machineId,
      accountId: snapshot.accountId,
      machineSlug: snapshot.machineSlug,
      desiredState: snapshot.desiredState,
      machineStatus: snapshot.machineStatus,
      desiredIp: snapshot.desiredIp,
      desiredOriginPort: snapshot.desiredOriginPort,
      desiredOriginHostname: snapshot.desiredOriginHostname,
      kvState: changed ? snapshot.kvState : existing?.kvState ?? snapshot.kvState,
      dnsState: changed ? snapshot.dnsState : existing?.dnsState ?? snapshot.dnsState,
      version: version || 1,
      metadata: snapshot.metadata,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: machineRoutingStates.machineId,
      set: {
        accountId: snapshot.accountId,
        machineSlug: snapshot.machineSlug,
        desiredState: snapshot.desiredState,
        machineStatus: snapshot.machineStatus,
        desiredIp: snapshot.desiredIp,
        desiredOriginPort: snapshot.desiredOriginPort,
        desiredOriginHostname: snapshot.desiredOriginHostname,
        kvState: changed ? snapshot.kvState : existing?.kvState ?? snapshot.kvState,
        dnsState: changed ? snapshot.dnsState : existing?.dnsState ?? snapshot.dnsState,
        version: version || 1,
        metadata: snapshot.metadata,
        updatedAt: at,
      },
    })
    .returning();

  return {
    row,
    changed,
    serverType: input.serverType,
    addresses: {
      ipv4: normalizeText(input.publicIpv4),
      ipv6: normalizeText(input.publicIpv6),
    },
  };
}

export async function applyMachineRoutingState(input: {
  row: MachineRoutingStateRow;
  serverType: string;
  addresses?: { ipv4?: string | null; ipv6?: string | null };
  executor?: RoutingExecutor;
  at?: Date;
}) {
  const executor = input.executor ?? db;
  const at = input.at ?? new Date();

  if (!config.isCloudflareConfigured()) {
    return input.row;
  }

  let kvState: MachineRoutingSyncState = input.row.kvState as MachineRoutingSyncState;
  let dnsState: MachineRoutingSyncState = input.row.dnsState as MachineRoutingSyncState;
  let lastError: string | null = null;

  try {
    if (input.row.desiredState === 'present' && input.row.desiredIp) {
      await cloudflareClient.writeKVMachine(input.row.machineSlug, buildRoutingKVRecord({
        machineId: input.row.machineId,
        accountId: input.row.accountId ?? '',
        desiredIp: input.row.desiredIp,
        desiredOriginPort: input.row.desiredOriginPort,
        desiredOriginHostname: input.row.desiredOriginHostname,
        machineStatus: input.row.machineStatus,
        serverType: input.serverType,
        routingVersion: input.row.version,
      }));
      kvState = 'synced';
    } else {
      await cloudflareClient.deleteKVMachine(input.row.machineSlug);
      kvState = 'absent';
    }
  } catch (error) {
    kvState = 'error';
    lastError = error instanceof Error ? error.message : String(error);
  }

  try {
    if (input.row.desiredState === 'present' && (input.addresses?.ipv4 || input.addresses?.ipv6)) {
      await cloudflareClient.addMachineDNS(input.row.machineSlug, input.addresses);
      dnsState = 'synced';
    } else {
      await cloudflareClient.removeMachineDNS(input.row.machineSlug);
      dnsState = 'absent';
    }
  } catch (error) {
    dnsState = 'error';
    lastError = [lastError, error instanceof Error ? error.message : String(error)].filter(Boolean).join('; ');
  }

  const [updated] = await executor.update(machineRoutingStates).set({
    kvState,
    dnsState,
    lastAppliedAt: at,
    lastKvSyncedAt: kvState === 'synced' ? at : input.row.lastKvSyncedAt,
    lastDnsSyncedAt: dnsState === 'synced' ? at : input.row.lastDnsSyncedAt,
    lastRepairAt: at,
    lastError,
    updatedAt: at,
  }).where(eq(machineRoutingStates.machineId, input.row.machineId)).returning();

  return updated ?? input.row;
}

export async function syncMachineRoutingState(input: {
  machineId: string;
  accountId: string;
  machineSlug: string;
  machineStatus: string;
  serverType: string;
  desiredIp?: string | null;
  desiredOriginPort?: number | null;
  publicIpv4?: string | null;
  publicIpv6?: string | null;
  originHostname?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
  executor?: RoutingExecutor;
  at?: Date;
}) {
  const { row, serverType, addresses } = await upsertMachineRoutingState(input);
  return applyMachineRoutingState({ row, serverType, addresses, executor: input.executor, at: input.at });
}

function readMachineMeta(machine: typeof machines.$inferSelect) {
  return (machine.providerMeta ?? {}) as Record<string, unknown>;
}

export async function repairStaleMachineRoutingStates(limit = 25, executor: RoutingExecutor = db) {
  const rows = await executor.select().from(machineRoutingStates).where(or(
    eq(machineRoutingStates.kvState, 'pending'),
    eq(machineRoutingStates.kvState, 'error'),
    eq(machineRoutingStates.dnsState, 'pending'),
    eq(machineRoutingStates.dnsState, 'error'),
  ));

  const batch = rows.slice(0, limit);
  for (const row of batch) {
    const [machine] = await executor.select().from(machines).where(eq(machines.id, row.machineId));
    if (!machine) continue;
    const meta = readMachineMeta(machine);
    const portAllocations = await getMachinePortAllocations(machine.id).catch(() => ({ ssh: null, http: null, rows: [] }));
    await syncMachineRoutingState({
      machineId: machine.id,
      accountId: machine.accountId ?? machine.ownerId,
      machineSlug: machine.slug,
      machineStatus: machine.status,
      serverType: machine.serverType,
      desiredIp: machine.ip,
      desiredOriginPort: portAllocations.http?.publicPort ?? (typeof meta.http_port === 'number' ? meta.http_port : null),
      publicIpv4: typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null,
      publicIpv6: typeof meta.public_ipv6 === 'string' ? meta.public_ipv6 : null,
      originHostname: `origin-${machine.slug}.${config.PROXY_DOMAIN}`,
      source: 'watchdog_repair',
      executor,
    });
  }

  return batch.length;
}
