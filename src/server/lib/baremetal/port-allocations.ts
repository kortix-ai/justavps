import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import net from 'node:net';

import { db } from '@/server/db';
import { baremetalHosts, machinePortAllocations, machines, type MachinePortAllocationRow } from '@/server/db/schema';

type BaremetalMachineRow = typeof machines.$inferSelect;

type PortAllocationExecutor = Pick<typeof db, 'select' | 'insert' | 'delete' | 'execute'>;

const SSH_PORT_RANGE = { start: 22000, end: 41999, target: 22 } as const;
const HTTP_PORT_RANGE = { start: 42000, end: 61999, target: 80 } as const;

async function isTcpPortReachable(host: string, port: number, timeoutMs = 250) {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function firstAllocatablePort(usedPorts: Set<number>, range: { start: number; end: number }, hostPublicIp?: string | null) {
  for (let port = range.start; port <= range.end; port += 1) {
    if (usedPorts.has(port)) continue;
    if (hostPublicIp && await isTcpPortReachable(hostPublicIp, port)) continue;
    return port;
  }
  return null;
}

export async function getMachinePortAllocations(machineId: string, executor: PortAllocationExecutor = db) {
  const rows = await executor.select().from(machinePortAllocations).where(eq(machinePortAllocations.machineId, machineId));
  return {
    rows,
    ssh: rows.find((row) => row.protocol === 'ssh') ?? null,
    http: rows.find((row) => row.protocol === 'http') ?? null,
  };
}

export async function reserveMachinePortAllocations(input: {
  machineId: string;
  hostId: string;
  hostPublicIp?: string | null;
  executor?: PortAllocationExecutor;
}) {
  const executor = input.executor ?? db;
  const existing = await getMachinePortAllocations(input.machineId, executor);
  if (existing.ssh && existing.http) {
    return {
      sshPort: existing.ssh.publicPort,
      httpPort: existing.http.publicPort,
      allocations: existing.rows,
    };
  }

  await executor.execute(sql`select ${baremetalHosts.id} from ${baremetalHosts} where ${baremetalHosts.id} = ${input.hostId} for update`);
  const rows = await executor.select().from(machinePortAllocations).where(eq(machinePortAllocations.hostId, input.hostId));
  const usedSshPorts = new Set(rows.filter((row) => row.protocol === 'ssh').map((row) => row.publicPort));
  const usedHttpPorts = new Set(rows.filter((row) => row.protocol === 'http').map((row) => row.publicPort));

  const legacyMachines = await executor.select().from(machines).where(eq(machines.provider, 'baremetal'));
  for (const machine of legacyMachines) {
    if (machine.id === input.machineId || machine.provider !== 'baremetal' || machine.deletedAt) continue;
    const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
    if (meta.baremetal_host_id !== input.hostId) continue;
    const sshPort = typeof meta.ssh_port === 'number' ? meta.ssh_port : typeof meta.ssh_port === 'string' ? Number(meta.ssh_port) : null;
    const httpPort = typeof meta.http_port === 'number' ? meta.http_port : typeof meta.http_port === 'string' ? Number(meta.http_port) : null;
    if (sshPort && Number.isInteger(sshPort) && sshPort > 0) usedSshPorts.add(sshPort);
    if (httpPort && Number.isInteger(httpPort) && httpPort > 0) usedHttpPorts.add(httpPort);
  }

  const sshPort = existing.ssh?.publicPort ?? await firstAllocatablePort(usedSshPorts, SSH_PORT_RANGE, input.hostPublicIp ?? null);
  const httpPort = existing.http?.publicPort ?? await firstAllocatablePort(usedHttpPorts, HTTP_PORT_RANGE, input.hostPublicIp ?? null);
  if (!sshPort || !httpPort) {
    throw new Error(`No public ${!sshPort ? 'SSH' : 'HTTP'} ports available on host ${input.hostId}`);
  }

  const inserts: Array<{ machineId: string; hostId: string; protocol: 'ssh' | 'http'; publicPort: number; targetPort: number; metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date }> = [];
  const now = new Date();
  if (!existing.ssh) {
    inserts.push({ machineId: input.machineId, hostId: input.hostId, protocol: 'ssh', publicPort: sshPort, targetPort: SSH_PORT_RANGE.target, metadata: {}, createdAt: now, updatedAt: now });
  }
  if (!existing.http) {
    inserts.push({ machineId: input.machineId, hostId: input.hostId, protocol: 'http', publicPort: httpPort, targetPort: HTTP_PORT_RANGE.target, metadata: {}, createdAt: now, updatedAt: now });
  }
  if (inserts.length > 0) {
    await executor.insert(machinePortAllocations).values(inserts);
  }

  const allocated = await getMachinePortAllocations(input.machineId, executor);
  if (!allocated.ssh || !allocated.http) {
    throw new Error(`Failed to persist machine port allocations for ${input.machineId}`);
  }

  return {
    sshPort: allocated.ssh.publicPort,
    httpPort: allocated.http.publicPort,
    allocations: allocated.rows,
  };
}

export async function releaseMachinePortAllocations(machineId: string, executor: PortAllocationExecutor = db) {
  await executor.delete(machinePortAllocations).where(eq(machinePortAllocations.machineId, machineId));
}

export async function backfillMachinePortAllocationsFromMachine(machine: BaremetalMachineRow, executor: PortAllocationExecutor = db) {
  if (machine.provider !== 'baremetal' || machine.deletedAt) return null;
  const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
  const hostId = typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null;
  if (!hostId) return null;

  const sshPort = typeof meta.ssh_port === 'number' ? meta.ssh_port : typeof meta.ssh_port === 'string' ? Number(meta.ssh_port) : null;
  const httpPort = typeof meta.http_port === 'number' ? meta.http_port : typeof meta.http_port === 'string' ? Number(meta.http_port) : null;
  const existing = await getMachinePortAllocations(machine.id, executor);
  const now = new Date();
  const inserts: Array<{ machineId: string; hostId: string; protocol: 'ssh' | 'http'; publicPort: number; targetPort: number; metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date }> = [];

  if (!existing.ssh && sshPort && Number.isInteger(sshPort) && sshPort > 0) {
    inserts.push({ machineId: machine.id, hostId, protocol: 'ssh', publicPort: sshPort, targetPort: SSH_PORT_RANGE.target, metadata: { source: 'legacy_provider_meta' }, createdAt: now, updatedAt: now });
  }
  if (!existing.http && httpPort && Number.isInteger(httpPort) && httpPort > 0) {
    inserts.push({ machineId: machine.id, hostId, protocol: 'http', publicPort: httpPort, targetPort: HTTP_PORT_RANGE.target, metadata: { source: 'legacy_provider_meta' }, createdAt: now, updatedAt: now });
  }
  if (inserts.length > 0) {
    await executor.insert(machinePortAllocations).values(inserts);
  }

  return getMachinePortAllocations(machine.id, executor);
}

export type MachinePortAllocationSummary = Pick<MachinePortAllocationRow, 'machineId' | 'hostId' | 'protocol' | 'publicPort' | 'targetPort'>;
