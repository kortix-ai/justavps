import { runWatchdog } from '@/server/lib/machine-watchdog';

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from './service-state';

export const CONTROL_PLANE_WATCHDOG_SERVICE = 'watchdog' as const;
export const WATCHDOG_SCOPE = 'global';

export async function runWatchdogServicePass(options?: {
  leaseMs?: number;
  leaseOwner?: string;
}) {
  const lease = await acquireControlPlaneServiceLease({
    service: CONTROL_PLANE_WATCHDOG_SERVICE,
    scope: WATCHDOG_SCOPE,
    leaseMs: options?.leaseMs,
    leaseOwner: options?.leaseOwner,
  });
  if (!lease.acquired) {
    return {
      acquired: false,
      alerts: 0,
      leaseOwner: lease.leaseOwner,
      scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_WATCHDOG_SERVICE, scope: WATCHDOG_SCOPE }),
    };
  }

  const alerts = await runWatchdog();
  const alertSummaries = alerts.map((alert) => ({
    machineId: alert.machineId,
    slug: alert.slug,
    type: alert.type,
    details: alert.details,
  }));
  await releaseControlPlaneServiceLease({
    service: CONTROL_PLANE_WATCHDOG_SERVICE,
    scope: WATCHDOG_SCOPE,
    leaseOwner: lease.leaseOwner,
    checkpoint: {
      last_watchdog_at: new Date().toISOString(),
      last_alert_count: alerts.length,
      last_alert_machine_ids: alerts.map((alert) => alert.machineId).slice(0, 25),
    },
  });

  return {
    acquired: true,
    alerts: alerts.length,
    alertSummaries,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_WATCHDOG_SERVICE, scope: WATCHDOG_SCOPE }),
  };
}
