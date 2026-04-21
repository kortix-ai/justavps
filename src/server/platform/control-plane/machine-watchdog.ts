/**
 * Machine Watchdog — Platform-side monitoring that users cannot tamper with.
 *
 * Three layers:
 *
 * 1. **Hetzner API Polling** — Fetches network metrics directly from Hetzner.
 *    Users can't fake this because it comes from the hypervisor, not the VPS.
 *    Detects bandwidth abuse even if the daemon is killed.
 *
 * 2. **Heartbeat Watchdog** — Checks for missed heartbeats + security tampering.
 *    If a user kills the daemon, heartbeats stop and we detect it here.
 *    If they disable UFW/fail2ban, the heartbeat reports it.
 *
 * 3. **Auto-Remediation** — When heartbeat is dead for 30+ minutes, triggers a
 *    Hetzner API reboot. The VPS systemd timer will re-download and restart
 *    the daemon automatically on boot. Fully tamper-proof — users can't
 *    prevent a hypervisor-level reboot.
 *
 * Called via Vercel cron or external scheduler every 5 minutes.
 */

import { and, isNull, ne } from 'drizzle-orm';
import { db } from "@/server/db/index";
import { machines } from "@/server/db/schema";
import { config } from "@/server/core/config";
import { eventBus } from "@/server/core/event-bus";
import { effectiveHeartbeatForMachine, listHeartbeatStatesByMachineIds } from "@/server/platform/control-plane/heartbeat-state";

const HETZNER_API = 'https://api.hetzner.cloud/v1';

// ─── Thresholds ─────────────────────────────────────────────────────────────

/** Heartbeat considered stale after 5 minutes (daemon sends every 30s) */
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/** Heartbeat considered dead after 15 minutes */
const HEARTBEAT_DEAD_MS = 15 * 60 * 1000;

/** Auto-reboot threshold: daemon dead for 30+ minutes triggers Hetzner reboot */
const HEARTBEAT_REBOOT_MS = 30 * 60 * 1000;

/** Cooldown: don't reboot the same machine within 60 minutes */
const REBOOT_COOLDOWN_MS = 60 * 60 * 1000;

/** Network rate threshold for Hetzner API metrics (bytes/sec averaged over 5min) */
const HETZNER_NETWORK_ALERT_THRESHOLD = 50 * 1024 * 1024; // 50 MB/s sustained

// ─── Reboot tracking (in-memory, resets on cold start — acceptable for cron) ─

const recentReboots = new Map<string, number>(); // machineId -> timestamp

// ─── Types ──────────────────────────────────────────────────────────────────

interface WatchdogAlert {
  machineId: string;
  slug: string;
  accountId: string;
  type: 'heartbeat_stale' | 'heartbeat_dead' | 'security_tamper' | 'network_anomaly' | 'auto_reboot' | 'backup_drift' | 'backup_missing';
  details: string[];
}

interface HetznerMetricsResponse {
  metrics: {
    time_series: Record<string, {
      values: Array<[number, string]>;
    }>;
  };
}

interface HetznerServerInfo {
  id: number;
  name: string;
  backup_window: string | null;
  created: string;
}

interface HetznerImageInfo {
  id: number;
  description: string | null;
  status: string;
  created: string;
  created_from: { id: number; name: string } | null;
}

interface HetznerPaginatedResponse {
  meta?: {
    pagination?: {
      last_page?: number;
    };
  };
  [key: string]: unknown;
}

const BACKUP_GRACE_MS = 30 * 60 * 60 * 1000;
const HETZNER_PAGE_SIZE = 100;

// ─── Hetzner API Metrics ────────────────────────────────────────────────────

async function fetchHetznerNetworkMetrics(serverId: string): Promise<{
  avgBytesInPerSec: number;
  avgBytesOutPerSec: number;
} | null> {
  if (!config.HETZNER_API_KEY) return null;

  const end = new Date();
  const start = new Date(end.getTime() - 5 * 60 * 1000); // last 5 minutes

  try {
    const params = new URLSearchParams({
      type: 'network',
      start: start.toISOString(),
      end: end.toISOString(),
    });

    const res = await fetch(
      `${HETZNER_API}/servers/${serverId}/metrics?${params}`,
      {
        headers: {
          Authorization: `Bearer ${config.HETZNER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      console.warn(`[WATCHDOG] Hetzner metrics for server ${serverId}: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as HetznerMetricsResponse;
    const ts = data.metrics.time_series;

    // Hetzner returns network.0.bandwidth.in and network.0.bandwidth.out
    const inSeries = ts['network.0.bandwidth.in']?.values ?? [];
    const outSeries = ts['network.0.bandwidth.out']?.values ?? [];

    const avgIn = inSeries.length > 0
      ? inSeries.reduce((sum, [, v]) => sum + parseFloat(v), 0) / inSeries.length
      : 0;
    const avgOut = outSeries.length > 0
      ? outSeries.reduce((sum, [, v]) => sum + parseFloat(v), 0) / outSeries.length
      : 0;

    return { avgBytesInPerSec: avgIn, avgBytesOutPerSec: avgOut };
  } catch (err) {
    console.warn(`[WATCHDOG] Failed to fetch Hetzner metrics for server ${serverId}:`, err);
    return null;
  }
}

async function fetchHetznerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${config.HETZNER_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(20_000),
  });

  if (res.ok) return res.json() as Promise<T>;
  const text = await res.text().catch(() => '');
  throw new Error(`Hetzner API ${path} -> ${res.status}: ${text.slice(0, 200)}`);
}

async function fetchHetznerPages<T>(path: string, key: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    let data: HetznerPaginatedResponse | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        data = await fetchHetznerJson<HetznerPaginatedResponse>(`${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=${HETZNER_PAGE_SIZE}`);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes(' 429') || attempt >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    const pageRows = Array.isArray(data?.[key]) ? (data?.[key] as T[]) : [];
    rows.push(...pageRows);
    const lastPage = data.meta?.pagination?.last_page ?? page;
    if (page >= lastPage) break;
  }
  return rows;
}

async function enableHetznerBackups(serverId: string): Promise<boolean> {
  if (!config.HETZNER_API_KEY) return false;

  try {
    await fetchHetznerJson(`/servers/${serverId}/actions/enable_backup`, { method: 'POST' });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already enabled') || message.includes(' 409')) return true;
    console.warn(`[WATCHDOG] Failed to enable backups for server ${serverId}:`, error);
    return false;
  }
}

async function createHetznerBackup(serverId: string, description: string): Promise<boolean> {
  if (!config.HETZNER_API_KEY) return false;

  try {
    await fetchHetznerJson(`/servers/${serverId}/actions/create_image`, {
      method: 'POST',
      body: JSON.stringify({ type: 'backup', description }),
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(' 423') || message.includes('locked')) return true;
    console.warn(`[WATCHDOG] Failed to create backup for server ${serverId}:`, error);
    return false;
  }
}

async function auditHetznerBackups(activeMachines: typeof machines.$inferSelect[]): Promise<WatchdogAlert[]> {
  const candidates = activeMachines.filter((machine) =>
    machine.backupsEnabled
    && machine.provider === 'cloud'
    && typeof machine.providerServerId === 'string'
    && /^\d+$/.test(machine.providerServerId),
  );

  if (candidates.length === 0 || !config.HETZNER_API_KEY) return [];

  const [servers, backups] = await Promise.all([
    fetchHetznerPages<HetznerServerInfo>('/servers', 'servers'),
    fetchHetznerPages<HetznerImageInfo>('/images?type=backup', 'images'),
  ]);

  const serverById = new Map(servers.map((server) => [String(server.id), server]));
  const backupsByServerId = new Map<string, HetznerImageInfo[]>();
  for (const backup of backups) {
    const serverId = backup.created_from?.id;
    if (!serverId) continue;
    const key = String(serverId);
    const list = backupsByServerId.get(key) ?? [];
    list.push(backup);
    backupsByServerId.set(key, list);
  }

  const alerts: WatchdogAlert[] = [];
  for (const machine of candidates) {
    const serverId = machine.providerServerId!;
    const server = serverById.get(serverId);
    const machineBackups = (backupsByServerId.get(serverId) ?? []).sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
    const machineAgeMs = Date.now() - new Date(machine.createdAt).getTime();

    if (!server) {
      alerts.push({
        machineId: machine.id,
        slug: machine.slug,
        accountId: machine.accountId ?? machine.ownerId,
        type: 'backup_drift',
        details: [`Backups enabled in DB but Hetzner server ${serverId} was not found during backup audit`],
      });
      continue;
    }

    if (!server.backup_window) {
      const repaired = await enableHetznerBackups(serverId);
      alerts.push({
        machineId: machine.id,
        slug: machine.slug,
        accountId: machine.accountId ?? machine.ownerId,
        type: 'backup_drift',
        details: [
          'Backups enabled in DB but Hetzner automatic backups were disabled',
          repaired ? 'Watchdog re-enabled Hetzner automatic backups' : 'Watchdog could not re-enable Hetzner automatic backups',
        ],
      });
      continue;
    }

    if (machineBackups.length === 0 && machineAgeMs > BACKUP_GRACE_MS) {
      const seeded = await createHetznerBackup(serverId, `Watchdog safety backup ${new Date().toISOString().slice(0, 10)}`);
      alerts.push({
        machineId: machine.id,
        slug: machine.slug,
        accountId: machine.accountId ?? machine.ownerId,
        type: 'backup_missing',
        details: [
          `Hetzner automatic backups are enabled (${server.backup_window}) but no backup image exists after ${Math.round(machineAgeMs / 3_600_000)}h`,
          seeded ? 'Watchdog requested a safety backup seed' : 'Watchdog could not request a safety backup seed',
        ],
      });
    }
  }

  return alerts;
}

// ─── Hetzner API Reboot ─────────────────────────────────────────────────────

async function rebootViaHetzner(serverId: string): Promise<boolean> {
  if (!config.HETZNER_API_KEY) return false;

  try {
    const res = await fetch(
      `${HETZNER_API}/servers/${serverId}/actions/reboot`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.HETZNER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      // Soft reboot can fail — fall back to hard reset
      const resetRes = await fetch(
        `${HETZNER_API}/servers/${serverId}/actions/reset`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.HETZNER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      return resetRes.ok;
    }

    return true;
  } catch (err) {
    console.error(`[WATCHDOG] Failed to reboot server ${serverId}:`, err);
    return false;
  }
}

// ─── Watchdog Check ─────────────────────────────────────────────────────────

/**
 * Run watchdog checks on all active machines.
 * Returns alerts for logging/notification.
 */
export async function runWatchdog(): Promise<WatchdogAlert[]> {
  const alerts: WatchdogAlert[] = [];

  // Fetch all active (non-deleted) machines
  const activeMachines = await db
    .select()
    .from(machines)
    .where(
      and(
        isNull(machines.deletedAt),
        ne(machines.status, 'provisioning'),
        ne(machines.status, 'deleted'),
      ),
    );
  const heartbeatStates = await listHeartbeatStatesByMachineIds(activeMachines.map((machine) => machine.id));
  const heartbeatStateByMachineId = new Map(heartbeatStates.map((state) => [state.machineId, state]));
  alerts.push(...await auditHetznerBackups(activeMachines));

  const now = Date.now();

  for (const machine of activeMachines) {
    const machineAlerts: string[] = [];
    const heartbeat = effectiveHeartbeatForMachine({
      machine,
      state: heartbeatStateByMachineId.get(machine.id),
    });

    // ── 1. Heartbeat staleness check (tamper-proof) ───────────────────
    if (heartbeat.lastHeartbeatAt) {
      const elapsed = now - heartbeat.lastHeartbeatAt.getTime();

      if (elapsed > HEARTBEAT_DEAD_MS) {
        alerts.push({
          machineId: machine.id,
          slug: machine.slug,
          accountId: machine.accountId ?? machine.ownerId,
          type: 'heartbeat_dead',
          details: [`No heartbeat for ${Math.round(elapsed / 60_000)} minutes — daemon may be killed or machine unreachable`],
        });

        // ── Auto-reboot if dead long enough and not recently rebooted ──
        if (
          elapsed > HEARTBEAT_REBOOT_MS &&
          machine.providerServerId &&
          machine.status === 'ready'
        ) {
          const lastReboot = recentReboots.get(machine.id) ?? 0;
          if (now - lastReboot > REBOOT_COOLDOWN_MS) {
            console.warn(`[WATCHDOG] Auto-rebooting ${machine.slug} (dead for ${Math.round(elapsed / 60_000)}min)`);
            const rebooted = await rebootViaHetzner(machine.providerServerId);
            if (rebooted) {
              recentReboots.set(machine.id, now);
              alerts.push({
                machineId: machine.id,
                slug: machine.slug,
                accountId: machine.accountId ?? machine.ownerId,
                type: 'auto_reboot',
                details: [`Auto-rebooted via Hetzner API after ${Math.round(elapsed / 60_000)} minutes without heartbeat`],
              });
            }
          }
        }
      } else if (elapsed > HEARTBEAT_STALE_MS) {
        alerts.push({
          machineId: machine.id,
          slug: machine.slug,
          accountId: machine.accountId ?? machine.ownerId,
          type: 'heartbeat_stale',
          details: [`Heartbeat stale for ${Math.round(elapsed / 60_000)} minutes`],
        });
      }
    }

    // ── 2. Security tamper check (from last heartbeat data) ───────────
    if (heartbeat.lastHeartbeat?.security) {
      const sec = heartbeat.lastHeartbeat.security;
      if (!sec.ufw_active) machineAlerts.push('UFW firewall disabled');
      if (!sec.fail2ban_active) machineAlerts.push('fail2ban disabled');
      if (!sec.ssh_key_only) machineAlerts.push('SSH password auth enabled');

      if (machineAlerts.length > 0) {
        alerts.push({
          machineId: machine.id,
          slug: machine.slug,
          accountId: machine.accountId ?? machine.ownerId,
          type: 'security_tamper',
          details: machineAlerts,
        });
      }
    }

    // ── 3. Hetzner API network check (fully tamper-proof) ─────────────
    if (machine.providerServerId && machine.status === 'ready') {
      const metrics = await fetchHetznerNetworkMetrics(machine.providerServerId);
      if (metrics) {
        const netAlerts: string[] = [];
        if (metrics.avgBytesOutPerSec > HETZNER_NETWORK_ALERT_THRESHOLD) {
          netAlerts.push(
            `Hetzner API: sustained outbound ${(metrics.avgBytesOutPerSec / 1024 / 1024).toFixed(1)} MB/s over 5min`,
          );
        }
        if (metrics.avgBytesInPerSec > HETZNER_NETWORK_ALERT_THRESHOLD) {
          netAlerts.push(
            `Hetzner API: sustained inbound ${(metrics.avgBytesInPerSec / 1024 / 1024).toFixed(1)} MB/s over 5min`,
          );
        }
        if (netAlerts.length > 0) {
          alerts.push({
            machineId: machine.id,
            slug: machine.slug,
            accountId: machine.accountId ?? machine.ownerId,
            type: 'network_anomaly',
            details: netAlerts,
          });
        }
      }
    }
  }

  // ── Log and emit alerts ─────────────────────────────────────────────
  for (const alert of alerts) {
    console.warn(
      `[WATCHDOG] ${alert.type} on ${alert.slug}: ${alert.details.join(', ')}`,
    );

    // Emit as transient event for webhook delivery
    eventBus.emitTransient({
      machineId: alert.machineId,
      accountId: alert.accountId,
      event: 'heartbeat',
      metadata: {
        alert: alert.type,
        details: alert.details,
        source: 'watchdog',
      },
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  return alerts;
}
