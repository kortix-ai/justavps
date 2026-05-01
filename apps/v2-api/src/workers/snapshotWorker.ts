// Utilization snapshot worker. Every 60 seconds, queries each cluster for
// live state, breaks down per-host, and persists one row per host per tick
// to NodeUtilizationSample. Pure-function tick — DB writes are injected
// via writeFn so we can unit-test the math without Postgres.

import type { IncusClusterConfig } from '../config.js';
import type { IncusClusterMember, IncusInstance } from '../incus/types.js';
import { parseCpuLimit, parseMemoryLimitGb, sumInstanceStorageGb } from '../economics/utilization.js';

export type SnapshotWrite = {
  clusterId: string;
  hostName: string;        // Incus member name (used to look up host_id at DB write time)
  ts: Date;
  vcpuUsed: number;
  ramGbUsed: number;
  storageGbUsed: number;
  instancesRunning: number;
  instancesTotal: number;
};

export async function snapshotClusterTick(opts: {
  cluster: IncusClusterConfig;
  members: IncusClusterMember[];
  instances: IncusInstance[];
  now: Date;
  write: (w: SnapshotWrite) => Promise<void>;
}): Promise<void> {
  const memberNames = new Set(opts.members.map((m) => m.server_name));

  // Group instances by location (host).
  const byHost = new Map<string, IncusInstance[]>();
  for (const inst of opts.instances) {
    const host = inst.location ?? '';
    if (!memberNames.has(host)) continue; // drop instances on hosts we don't track
    const list = byHost.get(host) ?? [];
    list.push(inst);
    byHost.set(host, list);
  }

  for (const member of opts.members) {
    const insts = byHost.get(member.server_name) ?? [];
    let vcpuUsed = 0;
    let ramGbUsed = 0;
    let storageGbUsed = 0;
    let running = 0;
    for (const inst of insts) {
      const isRunning = (inst.status ?? '').toLowerCase() === 'running';
      if (isRunning) {
        running += 1;
        const cpu = parseCpuLimit(inst.config?.['limits.cpu']);
        const mem = parseMemoryLimitGb(inst.config?.['limits.memory']);
        if (cpu !== null) vcpuUsed += cpu;
        if (mem !== null) ramGbUsed += mem;
      }
      // Storage charges run regardless of instance state (datasets pinned).
      const disk = sumInstanceStorageGb(inst.devices);
      if (disk !== null) storageGbUsed += disk;
    }
    await opts.write({
      clusterId: opts.cluster.id,
      hostName: member.server_name,
      ts: opts.now,
      vcpuUsed,
      ramGbUsed,
      storageGbUsed,
      instancesRunning: running,
      instancesTotal: insts.length,
    });
  }
}
