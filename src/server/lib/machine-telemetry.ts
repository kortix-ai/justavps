import { sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { machineTelemetryRollups } from '@/server/db/schema';
import type { MachineEvent } from '@/server/lib/event-bus';

export const MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC = 60;

export const MACHINE_TELEMETRY_RETENTION_MS = {
  heartbeat_minute_7d: 7 * 24 * 60 * 60 * 1000,
  alert_30d: 30 * 24 * 60 * 60 * 1000,
} as const;

export type MachineTelemetryRetentionClass = keyof typeof MACHINE_TELEMETRY_RETENTION_MS;
export type MachineTelemetrySeries = 'heartbeat' | 'security_tamper' | 'network_anomaly' | 'watchdog_alert';

export interface MachineTelemetryStorageSpec {
  series: MachineTelemetrySeries;
  retentionClass: MachineTelemetryRetentionClass;
  bucketResolutionSec: number;
}

export function telemetryBucketStart(observedAt: Date, bucketResolutionSec = MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC) {
  const bucketMs = Math.max(1, bucketResolutionSec) * 1000;
  return new Date(Math.floor(observedAt.getTime() / bucketMs) * bucketMs);
}

export function machineTelemetryStorageSpec(event: Pick<MachineEvent, 'event' | 'metadata'>): MachineTelemetryStorageSpec {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const alert = typeof metadata.alert === 'string' ? metadata.alert : null;
  const source = typeof metadata.source === 'string' ? metadata.source : null;

  if (alert === 'security_tamper') {
    return { series: 'security_tamper', retentionClass: 'alert_30d', bucketResolutionSec: MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC };
  }

  if (alert === 'network_anomaly') {
    return { series: 'network_anomaly', retentionClass: 'alert_30d', bucketResolutionSec: MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC };
  }

  if (source === 'watchdog' || alert === 'heartbeat_stale' || alert === 'heartbeat_dead' || alert === 'auto_reboot') {
    return { series: 'watchdog_alert', retentionClass: 'alert_30d', bucketResolutionSec: MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC };
  }

  return { series: 'heartbeat', retentionClass: 'heartbeat_minute_7d', bucketResolutionSec: MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC };
}

export function machineTelemetryRetentionUntil(
  observedAt: Date,
  retentionClass: MachineTelemetryRetentionClass,
) {
  return new Date(observedAt.getTime() + MACHINE_TELEMETRY_RETENTION_MS[retentionClass]);
}

export function buildMachineTelemetryRollupRecord(event: MachineEvent, observedAt = new Date(event.timestamp)) {
  const spec = machineTelemetryStorageSpec(event);

  return {
    machineId: event.machineId,
    accountId: event.accountId,
    series: spec.series,
    retentionClass: spec.retentionClass,
    bucketStart: telemetryBucketStart(observedAt, spec.bucketResolutionSec),
    bucketResolutionSec: spec.bucketResolutionSec,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    sampleCount: 1,
    lastPayload: {
      event: event.event,
      timestamp: event.timestamp,
      ...(event.metadata ? { metadata: event.metadata } : {}),
      ...(event.message ? { message: event.message } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(event.stage ? { stage: event.stage } : {}),
    },
    retentionUntil: machineTelemetryRetentionUntil(observedAt, spec.retentionClass),
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

export async function recordMachineTelemetry(event: MachineEvent) {
  const observedAt = new Date(event.timestamp);
  const record = buildMachineTelemetryRollupRecord(event, observedAt);

  await db.insert(machineTelemetryRollups)
    .values(record)
    .onConflictDoUpdate({
      target: [
        machineTelemetryRollups.machineId,
        machineTelemetryRollups.series,
        machineTelemetryRollups.bucketStart,
        machineTelemetryRollups.bucketResolutionSec,
      ],
      set: {
        accountId: record.accountId,
        retentionClass: record.retentionClass,
        lastObservedAt: record.lastObservedAt,
        sampleCount: sql`${machineTelemetryRollups.sampleCount} + 1`,
        lastPayload: record.lastPayload,
        retentionUntil: record.retentionUntil,
        updatedAt: record.updatedAt,
      },
    });
}
