/**
 * Machine Watchdog — Platform-side monitoring that users cannot tamper with.
 *
 * Two layers:
 *
 * 1. **Hetzner API Polling** — Fetches network metrics directly from Hetzner.
 *    Users can't fake this because it comes from the hypervisor, not the VPS.
 *    Detects bandwidth abuse even if the daemon is killed.
 *
 * 2. **Heartbeat Watchdog** — Checks for missed heartbeats + security tampering.
 *    If a user kills the daemon, heartbeats stop and we detect it here.
 *    If they disable UFW/fail2ban, the heartbeat reports it.
 *
 * Called via Vercel cron or external scheduler every 5 minutes.
 */

import { and, isNull, ne } from 'drizzle-orm';
import { db } from '../db';
import { machines } from '../db/schema';
import { config } from './config';
import { eventBus } from './event-bus';

const HETZNER_API = 'https://api.hetzner.cloud/v1';

// ─── Thresholds ─────────────────────────────────────────────────────────────

/** Heartbeat considered stale after 5 minutes (daemon sends every 30s) */
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/** Heartbeat considered dead after 15 minutes */
const HEARTBEAT_DEAD_MS = 15 * 60 * 1000;

/** Network rate threshold for Hetzner API metrics (bytes/sec averaged over 5min) */
const HETZNER_NETWORK_ALERT_THRESHOLD = 50 * 1024 * 1024; // 50 MB/s sustained

// ─── Types ──────────────────────────────────────────────────────────────────

interface WatchdogAlert {
  machineId: string;
  slug: string;
  ownerId: string;
  type: 'heartbeat_stale' | 'heartbeat_dead' | 'security_tamper' | 'network_anomaly';
  details: string[];
}

interface HetznerMetricsResponse {
  metrics: {
    time_series: Record<string, {
      values: Array<[number, string]>;
    }>;
  };
}

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

  const now = Date.now();

  for (const machine of activeMachines) {
    const machineAlerts: string[] = [];

    // ── 1. Heartbeat staleness check (tamper-proof) ───────────────────
    if (machine.lastHeartbeatAt) {
      const elapsed = now - machine.lastHeartbeatAt.getTime();

      if (elapsed > HEARTBEAT_DEAD_MS) {
        alerts.push({
          machineId: machine.id,
          slug: machine.slug,
          ownerId: machine.ownerId,
          type: 'heartbeat_dead',
          details: [`No heartbeat for ${Math.round(elapsed / 60_000)} minutes — daemon may be killed or machine unreachable`],
        });
      } else if (elapsed > HEARTBEAT_STALE_MS) {
        alerts.push({
          machineId: machine.id,
          slug: machine.slug,
          ownerId: machine.ownerId,
          type: 'heartbeat_stale',
          details: [`Heartbeat stale for ${Math.round(elapsed / 60_000)} minutes`],
        });
      }
    }

    // ── 2. Security tamper check (from last heartbeat data) ───────────
    if (machine.lastHeartbeat?.security) {
      const sec = machine.lastHeartbeat.security;
      if (!sec.ufw_active) machineAlerts.push('UFW firewall disabled');
      if (!sec.fail2ban_active) machineAlerts.push('fail2ban disabled');
      if (!sec.ssh_key_only) machineAlerts.push('SSH password auth enabled');

      if (machineAlerts.length > 0) {
        alerts.push({
          machineId: machine.id,
          slug: machine.slug,
          ownerId: machine.ownerId,
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
            ownerId: machine.ownerId,
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
      ownerId: alert.ownerId,
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
