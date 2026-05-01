// Worker startup. Each worker is opt-in via env (off by default in prod
// until we've verified them against a real DB). Pattern mirrors
// startNodeProvisioningWorker — single-process setInterval, idempotent
// per tick, persists state on every cycle.

import type { AppConfig } from '../config.js';
import { IncusClient } from '../incus/client.js';
import { getPrisma } from '../db/client.js';
import { snapshotClusterTick } from './snapshotWorker.js';
import { computeBucketsForHost } from './costTickWorker.js';
import { proposeForCluster } from './autoscaleProposerWorker.js';
import { reconcileBilling, type LiveInstance, type SessionState } from './billingWorker.js';
import { decideAutoHandoffs, type HandoffHost } from './handoffWorker.js';
import { decideReapActions, DEFAULT_REAP_POLICY, type ReapableSandbox } from './idleReaper.js';
import { getSku, SKU_CATALOG, DEFAULT_SKU_ID } from '../economics/skuCatalog.js';
import { DEFAULT_PRICING, computeRevenueMicroEur } from '../economics/pricing.js';
import { parseCpuLimit, parseMemoryLimitGb, sumInstanceStorageGb } from '../economics/utilization.js';
import type { FillSample } from '../economics/autoscale.js';

// Snapshot worker — every 60s by default (V2_SNAPSHOT_TICK_MS override).
// Reads live Incus state per cluster, writes one NodeUtilizationSample
// row per host per tick.
export function startSnapshotWorker(config: AppConfig) {
  if (process.env.V2_SNAPSHOT_WORKER !== 'on') return null;
  if (!config.databaseConfigured) {
    console.warn('[snapshot-worker] database not configured — skipping');
    return null;
  }
  const tickMs = Number(process.env.V2_SNAPSHOT_TICK_MS || 60_000);
  const tick = async () => {
    const prisma = getPrisma();
    const now = new Date();
    for (const cluster of config.clusters) {
      try {
        const client = new IncusClient(cluster);
        const [members, instances] = await Promise.all([
          client.listClusterMembers(),
          client.listInstances(),
        ]);
        await snapshotClusterTick({
          cluster, members, instances, now,
          write: async (w) => {
            // Look up host_id by incus_member_name within this cluster.
            const host = await prisma.host.findFirst({
              where: { incusClusterId: w.clusterId, incusMemberName: w.hostName },
              select: { id: true },
            });
            if (!host) return; // host not registered in v2_core.hosts yet
            await prisma.nodeUtilizationSample.upsert({
              where: { hostId_ts: { hostId: host.id, ts: w.ts } },
              create: {
                hostId: host.id, ts: w.ts,
                vcpuUsed: w.vcpuUsed,
                ramGbUsed: w.ramGbUsed,
                storageGbUsed: w.storageGbUsed,
                instancesRunning: w.instancesRunning,
                instancesTotal: w.instancesTotal,
              },
              update: {},
            });
          },
        });
      } catch (e) {
        console.error(`[snapshot-worker] cluster ${cluster.id}:`, e instanceof Error ? e.message : e);
      }
    }
  };
  const timer = setInterval(() => { tick().catch((e) => console.error('[snapshot-worker]', e)); }, tickMs);
  console.log(`[v2-api] snapshot worker started (tick=${tickMs}ms)`);
  return timer;
}

// Cost-tick worker — hourly. Walks every non-terminated host, writes
// CostLedgerEntry rows for any closed hours since the last bookkeeping.
export function startCostTickWorker(config: AppConfig) {
  if (process.env.V2_COST_TICK_WORKER !== 'on') return null;
  if (!config.databaseConfigured) {
    console.warn('[cost-tick] database not configured — skipping');
    return null;
  }
  const tickMs = Number(process.env.V2_COST_TICK_MS || 3600_000);
  const tick = async () => {
    const prisma = getPrisma();
    const now = new Date();
    const hosts = await prisma.host.findMany({
      where: { lifecycleState: { not: 'terminated' }, joinedAt: { not: null } },
    });
    for (const host of hosts) {
      try {
        const skuId = host.sku ?? DEFAULT_SKU_ID;
        const sku = getSku(skuId);
        if (!sku) continue;
        // Find the latest ledger entry for this host to know where to resume.
        const lastEntry = await prisma.costLedgerEntry.findFirst({
          where: { hostId: host.id },
          orderBy: { tsTo: 'desc' },
          select: { tsTo: true },
        });
        const lastBookedAt = lastEntry?.tsTo ?? host.joinedAt!;
        const buckets = computeBucketsForHost({
          hostId: host.id, sku, joinedAt: host.joinedAt!,
          terminatedAt: host.terminatedAt, lastBookedAt, now,
        });
        for (const b of buckets) {
          await prisma.costLedgerEntry.create({
            data: {
              hostId: b.hostId, sku: b.sku,
              tsFrom: b.tsFrom, tsTo: b.tsTo,
              microEur: BigInt(Math.round(b.microEur)),
            },
          });
        }
      } catch (e) {
        console.error(`[cost-tick] host ${host.id}:`, e instanceof Error ? e.message : e);
      }
    }
  };
  const timer = setInterval(() => { tick().catch((e) => console.error('[cost-tick]', e)); }, tickMs);
  console.log(`[v2-api] cost-tick worker started (tick=${tickMs}ms)`);
  return timer;
}

// Autoscale proposer — every 5 minutes. Reads recent utilization samples,
// emits ScalingProposal rows for clusters whose binding resource has
// crossed the threshold (sustained).
export function startAutoscaleProposerWorker(config: AppConfig) {
  if (process.env.V2_AUTOSCALE_WORKER !== 'on') return null;
  if (!config.databaseConfigured) {
    console.warn('[autoscale-proposer] database not configured — skipping');
    return null;
  }
  const tickMs = Number(process.env.V2_AUTOSCALE_TICK_MS || 5 * 60_000);
  const addThreshold = Number(process.env.V2_AUTOSCALE_ADD_THRESHOLD_PCT || 75);
  const drainThreshold = Number(process.env.V2_AUTOSCALE_DRAIN_THRESHOLD_PCT || 20);
  const sustained = Number(process.env.V2_AUTOSCALE_SUSTAINED_MINUTES || 30);
  const tick = async () => {
    const prisma = getPrisma();
    for (const cluster of config.clusters) {
      try {
        const since = new Date(Date.now() - 6 * 3600 * 1000);
        const samples = await prisma.nodeUtilizationSample.findMany({
          where: { ts: { gte: since } },
          orderBy: { ts: 'asc' },
        });
        const hosts = await prisma.host.findMany({
          where: { incusClusterId: cluster.id, lifecycleState: { not: 'terminated' } },
        });
        const hostIds = new Set(hosts.map((h) => h.id));
        const skuId = cluster.defaultMemberSku ?? DEFAULT_SKU_ID;
        const sku = SKU_CATALOG[skuId];
        if (!sku || hosts.length === 0) continue;
        const totalCap = {
          vcpu: sku.vcpus * hosts.length,
          ram: sku.ramGb * hosts.length,
          storage: sku.usableStorageGb * hosts.length,
        };
        const byTs = new Map<number, { vcpu: number; ram: number; storage: number }>();
        for (const s of samples) {
          if (!hostIds.has(s.hostId)) continue;
          const key = s.ts.getTime();
          const cur = byTs.get(key) ?? { vcpu: 0, ram: 0, storage: 0 };
          cur.vcpu += s.vcpuUsed;
          cur.ram += s.ramGbUsed;
          cur.storage += s.storageGbUsed;
          byTs.set(key, cur);
        }
        const fillSamples: FillSample[] = Array.from(byTs).map(([key, used]) => ({
          ts: new Date(key),
          vcpuPct: (used.vcpu / totalCap.vcpu) * 100,
          ramPct: (used.ram / totalCap.ram) * 100,
          storagePct: (used.storage / totalCap.storage) * 100,
        })).sort((a, b) => a.ts.getTime() - b.ts.getTime());

        const pendingCount = await prisma.scalingProposal.count({
          where: { clusterId: cluster.id, status: 'pending' },
        });

        await proposeForCluster({
          clusterId: cluster.id,
          fleetHostCount: hosts.length,
          samples: fillSamples,
          addThresholdPct: addThreshold,
          drainThresholdPct: drainThreshold,
          sustainedMinutes: sustained,
          defaultSku: sku,
          hasPendingProposalAlready: pendingCount > 0,
          write: async (w) => {
            await prisma.scalingProposal.create({
              data: {
                kind: w.kind,
                clusterId: w.clusterId,
                proposedSku: w.proposedSku,
                rationale: w.rationale,
                costImpactEurMo: w.costImpactEurMo,
                expiresAt: w.expiresAt,
                metadata: w.metadata as never,
              },
            });
          },
        });
      } catch (e) {
        console.error(`[autoscale-proposer] cluster ${cluster.id}:`, e instanceof Error ? e.message : e);
      }
    }
  };
  const timer = setInterval(() => { tick().catch((e) => console.error('[autoscale-proposer]', e)); }, tickMs);
  console.log(`[v2-api] autoscale-proposer worker started (tick=${tickMs}ms)`);
  return timer;
}

// Billing worker — reconciles live Incus instances with open
// SandboxUsageSession rows. Opens new sessions, closes ended ones (and
// emits RevenueLedgerEntry on close), ticks still-running ones with
// accumulated seconds. Runs every 30s by default.
export function startBillingWorker(config: AppConfig) {
  if (process.env.V2_BILLING_WORKER !== 'on') return null;
  if (!config.databaseConfigured) {
    console.warn('[billing-worker] database not configured — skipping');
    return null;
  }
  const tickMs = Number(process.env.V2_BILLING_TICK_MS || 30_000);
  const tick = async () => {
    const prisma = getPrisma();
    const now = new Date();
    // Collect live instances across all clusters BEFORE reconciling — the
    // session table is global, so we need a single reconcile pass against
    // the union of cluster state. If a cluster is unreachable, we skip
    // that cluster's instances rather than aborting the tick (otherwise a
    // hel1 outage would close every hel2 session and vice-versa).
    const liveAll: LiveInstance[] = [];
    let anyClusterReachable = false;
    for (const cluster of config.clusters) {
      try {
        const client = new IncusClient(cluster);
        const instances = await client.listInstances();
        anyClusterReachable = true;
        for (const inst of instances) {
          const cpu = parseCpuLimit(inst.config?.['limits.cpu']) ?? 0;
          const mem = parseMemoryLimitGb(inst.config?.['limits.memory']) ?? 0;
          const disk = sumInstanceStorageGb(inst.devices) ?? 0;
          liveAll.push({
            machineId: inst.name,
            customerId: inst.config?.['user.justavps.account_id'] ?? null,
            status: inst.status,
            vcpus: cpu, ramGb: mem, storageGb: disk,
          });
        }
      } catch (e) {
        console.warn(`[billing-worker] cluster ${cluster.id} unreachable this tick:`, e instanceof Error ? e.message : e);
      }
    }
    // If NO cluster could be reached, skip the entire tick — closing all
    // sessions on a transient network blip would be billing chaos.
    if (!anyClusterReachable) return;

    try {
        const openSessionsRaw = await prisma.sandboxUsageSession.findMany({
          where: { state: 'running', endedAt: null },
        });
        const openSessions: SessionState[] = openSessionsRaw.map((s) => ({
          id: s.id, machineId: s.machineId, customerId: s.customerId,
          vcpus: s.vcpus, ramGb: s.ramGb, storageGb: s.storageGb,
          startedAt: s.startedAt, lastTickAt: s.updatedAt,
          state: s.state,
          vcpuSeconds: s.vcpuSeconds, ramGbSeconds: s.ramGbSeconds,
          storageGbSecondsLocal: s.storageGbSecondsLocal,
          storageGbSecondsArchive: s.storageGbSecondsArchive,
        }));

        const events = reconcileBilling({ now, live: liveAll, openSessions });

        for (const ev of events) {
          if (ev.kind === 'open') {
            await prisma.sandboxUsageSession.create({
              data: {
                machineId: ev.machineId, customerId: ev.customerId,
                vcpus: ev.vcpus, ramGb: ev.ramGb, storageGb: ev.storageGb,
                startedAt: ev.startedAt, state: 'running',
              },
            });
          } else if (ev.kind === 'tick') {
            await prisma.sandboxUsageSession.update({
              where: { id: ev.sessionId },
              data: {
                vcpuSeconds: { increment: ev.vcpuSecondsAdd },
                ramGbSeconds: { increment: ev.ramGbSecondsAdd },
                storageGbSecondsLocal: { increment: ev.storageGbSecondsLocalAdd },
                updatedAt: ev.lastTickAt,
              },
            });
          } else if (ev.kind === 'close') {
            // Close out the session and emit a RevenueLedgerEntry for the
            // accumulated total. Read the session post-tick (most ticks have
            // already updated it within this loop iteration).
            const closed = await prisma.sandboxUsageSession.update({
              where: { id: ev.sessionId },
              data: { state: 'stopped', endedAt: ev.endedAt },
            });
            const microEur = computeRevenueMicroEur({
              vcpu_seconds: closed.vcpuSeconds,
              ram_gb_seconds: closed.ramGbSeconds,
              storage_gb_seconds_local: closed.storageGbSecondsLocal,
              storage_gb_seconds_archive: closed.storageGbSecondsArchive,
            }, DEFAULT_PRICING);
            if (microEur > 0) {
              await prisma.revenueLedgerEntry.create({
                data: {
                  sessionId: closed.id, machineId: closed.machineId,
                  customerId: closed.customerId,
                  tsFrom: closed.startedAt, tsTo: ev.endedAt,
                  microEur: BigInt(Math.round(microEur)),
                },
              });
            }
          }
        }
      } catch (e) {
        console.error(`[billing-worker] reconcile failed:`, e instanceof Error ? e.message : e);
      }
  };
  const timer = setInterval(() => { tick().catch((e) => console.error('[billing-worker]', e)); }, tickMs);
  console.log(`[v2-api] billing worker started (tick=${tickMs}ms)`);
  return timer;
}

// Procurement → init auto-handoff worker. Polls Host rows that the
// operator has tagged with metadata.target_cluster_id. For any such host
// that's delivered + has an IP + isn't already in a cluster + has no
// active provisioning run → auto-create a NodeProvisioningRun. Closes
// the "ordered to joined" loop without operator intervention beyond
// setting the target cluster.
export function startHandoffWorker(config: AppConfig) {
  if (process.env.V2_HANDOFF_WORKER !== 'on') return null;
  if (!config.databaseConfigured) {
    console.warn('[handoff-worker] database not configured — skipping');
    return null;
  }
  const tickMs = Number(process.env.V2_HANDOFF_TICK_MS || 30_000);
  const tick = async () => {
    const prisma = getPrisma();
    const hosts = await prisma.host.findMany({
      where: {
        lifecycleState: { in: ['requested', 'ordered', 'delivered', 'bootstrapping'] },
        incusMemberName: null,
      },
    });
    if (hosts.length === 0) return;

    // Pull recent runs for these hosts to gate on "already provisioning."
    const ips = new Set<string>();
    for (const h of hosts) {
      if (h.publicIpv4) ips.add(h.publicIpv4);
      if (h.publicIpv6) ips.add(h.publicIpv6);
    }
    // Pull ALL recent runs (any status) for these IPs — the decider uses
    // a cooldown window to prevent retry-loops after failures.
    const sinceCooldown = new Date(Date.now() - 60 * 60 * 1000);
    const openRunsRaw = ips.size > 0
      ? await prisma.nodeProvisioningRun.findMany({
          where: { sshHost: { in: Array.from(ips) }, createdAt: { gte: sinceCooldown } },
        })
      : [];
    const openRuns = openRunsRaw.map((r) => ({
      sshHost: r.sshHost ?? '', status: r.status, createdAt: r.createdAt,
    }));

    const handoffHosts: HandoffHost[] = hosts.map((h) => ({
      id: h.id,
      publicIpv4: h.publicIpv4 ?? null,
      publicIpv6: h.publicIpv6 ?? null,
      incusMemberName: h.incusMemberName ?? null,
      lifecycleState: h.lifecycleState,
      targetClusterId: ((h.metadata as Record<string, unknown> | null)?.target_cluster_id as string | null) ?? null,
    }));

    const events = decideAutoHandoffs({ hosts: handoffHosts, openRuns });
    for (const ev of events) {
      try {
        const created = await prisma.nodeProvisioningRun.create({
          data: {
            clusterId: ev.clusterId,
            source: 'hetzner-buy',
            targetOs: 'ubuntu-incus',
            sshHost: ev.sshHost,
            sshUser: 'root',
            sshPort: 22,
            metadata: { from_rescue: ev.fromRescue, auto_handoff: true } as never,
            status: 'pending',
          },
        });
        // Move host into 'bootstrapping' so we don't re-pick it next tick.
        await prisma.host.update({
          where: { id: ev.hostId },
          data: { lifecycleState: 'bootstrapping' },
        });
        console.log(`[handoff-worker] created run ${created.id} for host ${ev.hostId} → cluster ${ev.clusterId}`);
      } catch (e) {
        console.error(`[handoff-worker] failed to create run for ${ev.hostId}:`, e instanceof Error ? e.message : e);
      }
    }
  };
  const timer = setInterval(() => { tick().catch((e) => console.error('[handoff-worker]', e)); }, tickMs);
  console.log(`[v2-api] handoff worker started (tick=${tickMs}ms)`);
  return timer;
}

// Idle reaper. Daily by default. Reads stopped + archived
// SandboxUsageSession rows, decides which to archive (free local NVMe)
// and which to delete (gone for good). The actual archive transfer is
// out of scope here — for now we just transition state in the DB and
// log so operator can do the dataset move. Wiring that to actual ZFS
// snapshot send/receive is a follow-up.
export function startIdleReaper(config: AppConfig) {
  if (process.env.V2_REAPER_WORKER !== 'on') return null;
  if (!config.databaseConfigured) {
    console.warn('[idle-reaper] database not configured — skipping');
    return null;
  }
  const tickMs = Number(process.env.V2_REAPER_TICK_MS || 24 * 3600 * 1000);
  const policy = {
    stopped_to_archive_days: Number(process.env.V2_REAP_STOPPED_DAYS || DEFAULT_REAP_POLICY.stopped_to_archive_days),
    archive_to_delete_days: Number(process.env.V2_REAP_ARCHIVE_DAYS || DEFAULT_REAP_POLICY.archive_to_delete_days),
  };
  const tick = async () => {
    const prisma = getPrisma();
    const sessions = await prisma.sandboxUsageSession.findMany({
      where: { state: { in: ['stopped', 'archived'] } },
    });
    const candidates: ReapableSandbox[] = sessions.map((s) => ({
      machineId: s.machineId,
      customerId: s.customerId,
      state: s.state,
      lastTransitionAt: s.endedAt ?? s.updatedAt,
      storageGb: s.storageGb,
    }));
    const now = new Date();
    const actions = decideReapActions({ sandboxes: candidates, now, policy });
    for (const action of actions) {
      const next = action.kind === 'archive' ? 'archived' : 'terminated';
      try {
        await prisma.sandboxUsageSession.updateMany({
          where: { machineId: action.machineId, state: action.kind === 'archive' ? 'stopped' : 'archived' },
          data: { state: next, updatedAt: now },
        });
        console.log(`[idle-reaper] ${action.kind} ${action.machineId}: ${action.reason}`);
      } catch (e) {
        console.error(`[idle-reaper] ${action.kind} ${action.machineId} failed:`, e instanceof Error ? e.message : e);
      }
    }
  };
  const timer = setInterval(() => { tick().catch((e) => console.error('[idle-reaper]', e)); }, tickMs);
  console.log(`[v2-api] idle-reaper worker started (tick=${tickMs}ms, archive=${policy.stopped_to_archive_days}d, delete=${policy.archive_to_delete_days}d)`);
  return timer;
}

export function startEconomicsWorkers(config: AppConfig) {
  return {
    snapshot: startSnapshotWorker(config),
    costTick: startCostTickWorker(config),
    autoscale: startAutoscaleProposerWorker(config),
    billing: startBillingWorker(config),
    handoff: startHandoffWorker(config),
    reaper: startIdleReaper(config),
  };
}
