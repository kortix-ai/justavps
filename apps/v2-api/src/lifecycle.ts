import type { AppConfig, IncusClusterConfig } from './config.js';
import { getPrisma } from './db/client.js';
import { IncusClient } from './incus/client.js';

// Background sweeper: every tick, look at every Prisma-tracked machine, read
// its lifecycle policy from metadata, and fire the appropriate transition.
//
// Three timers, ordered by escalating destructiveness:
//   • auto_stop_min — wall-clock since `metadata.last_used_at` (bumped on
//     create/start/exec). When it elapses, we stop the instance.
//   • auto_archive_min — wall-clock since `metadata.stopped_at`. Marks the
//     row `archived` (status only — instance stays around) so you can revive
//     later. Equivalent to "keep but cold."
//   • auto_delete_min — wall-clock since `metadata.stopped_at`. Hard-deletes.
//
// Disabled by default. Set `V2_LIFECYCLE_SWEEPER=on` to start it. Tick
// interval default is 60s; override via `V2_LIFECYCLE_TICK_MS`.

type MachineMeta = {
  env?: Record<string, string>;
  labels?: Record<string, string>;
  lifecycle?: { auto_stop_min?: number; auto_archive_min?: number; auto_delete_min?: number; ephemeral?: boolean };
  last_used_at?: string;
  stopped_at?: string;
};

function readMeta(value: unknown): MachineMeta {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MachineMeta : {};
}

function minutesSince(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60_000;
}

export type SweepResult = {
  scanned: number;
  stopped: string[];
  archived: string[];
  deleted: string[];
  errors: Array<{ id: string; error: string }>;
};

export async function sweepOnce(config: AppConfig, clientFor: (cluster: IncusClusterConfig) => IncusClient): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, stopped: [], archived: [], deleted: [], errors: [] };
  if (!config.databaseConfigured) return result;
  const prisma = getPrisma();

  const candidates = await prisma.machine.findMany({
    where: { status: { notIn: ['deleted', 'archived', 'warm_pool', 'warm_pool_claiming'] } },
  });
  result.scanned = candidates.length;

  for (const machine of candidates) {
    const meta = readMeta(machine.metadata);
    const lc = meta.lifecycle ?? {};
    const cluster = config.clusters.find((c) => c.id === machine.incusClusterId);
    if (!cluster) continue;
    const client = clientFor(cluster);

    try {
      const idleMin = minutesSince(meta.last_used_at);
      const stoppedMin = minutesSince(meta.stopped_at);

      // Auto-stop: only meaningful if currently running.
      if (machine.status !== 'Stopped' && lc.auto_stop_min && lc.auto_stop_min > 0 && idleMin !== null && idleMin >= lc.auto_stop_min) {
        await client.stopInstance(machine.incusInstanceName).catch(() => undefined);
        await prisma.machine.update({
          where: { id: machine.id },
          data: { status: 'Stopped', metadata: { ...meta, stopped_at: new Date().toISOString() } as object },
        });
        result.stopped.push(machine.id);
        if (lc.ephemeral) {
          // Ephemeral: collapse stop+delete into one transition.
          await client.deleteInstance(machine.incusInstanceName, { force: true }).catch(() => undefined);
          await prisma.machine.update({ where: { id: machine.id }, data: { status: 'deleted' } });
          result.deleted.push(machine.id);
        }
        continue;
      }

      // Auto-delete (checked BEFORE archive — delete is the more destructive
      // transition and should win when both timers have fired).
      if (machine.status === 'Stopped' && lc.auto_delete_min && lc.auto_delete_min > 0 && stoppedMin !== null && stoppedMin >= lc.auto_delete_min) {
        await client.deleteInstance(machine.incusInstanceName, { force: true }).catch(() => undefined);
        await prisma.machine.update({ where: { id: machine.id }, data: { status: 'deleted' } });
        result.deleted.push(machine.id);
        continue;
      }

      // Auto-archive: marks the row archived but doesn't touch the Incus
      // instance; revival is just a status flip + start.
      if (machine.status === 'Stopped' && lc.auto_archive_min && lc.auto_archive_min > 0 && stoppedMin !== null && stoppedMin >= lc.auto_archive_min) {
        await prisma.machine.update({ where: { id: machine.id }, data: { status: 'archived' } });
        result.archived.push(machine.id);
      }
    } catch (error) {
      result.errors.push({ id: machine.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

export function startLifecycleSweeper(config: AppConfig, clientFor: (cluster: IncusClusterConfig) => IncusClient) {
  if (process.env.V2_LIFECYCLE_SWEEPER !== 'on') return null;
  const tickMs = Number(process.env.V2_LIFECYCLE_TICK_MS || 60_000);
  const timer = setInterval(() => {
    sweepOnce(config, clientFor)
      .then((r) => {
        if (r.stopped.length || r.archived.length || r.deleted.length || r.errors.length) {
          // eslint-disable-next-line no-console
          console.log(`[v2-api] lifecycle sweep: scanned=${r.scanned} stopped=${r.stopped.length} archived=${r.archived.length} deleted=${r.deleted.length} errors=${r.errors.length}`);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[v2-api] lifecycle sweep failed:', error instanceof Error ? error.stack : error);
      });
  }, tickMs);
  // eslint-disable-next-line no-console
  console.log(`[v2-api] lifecycle sweeper started (tick=${tickMs}ms)`);
  return timer;
}
