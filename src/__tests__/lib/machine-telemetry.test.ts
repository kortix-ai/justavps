import { describe, expect, it } from 'vitest';

import {
  MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC,
  buildMachineTelemetryRollupRecord,
  machineTelemetryStorageSpec,
  telemetryBucketStart,
} from '@/server/lib/machine-telemetry';

describe('machine telemetry retention modeling', () => {
  it('stores heartbeat telemetry in minute buckets with short-lived retention', () => {
    const observedAt = new Date('2026-04-11T12:34:56.789Z');
    const record = buildMachineTelemetryRollupRecord({
      machineId: 'machine-1',
      accountId: 'account-1',
      event: 'heartbeat',
      metadata: { uptime: 42 },
      timestamp: observedAt.toISOString(),
    }, observedAt);

    expect(record.series).toBe('heartbeat');
    expect(record.retentionClass).toBe('heartbeat_minute_7d');
    expect(record.bucketResolutionSec).toBe(MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC);
    expect(record.bucketStart.toISOString()).toBe('2026-04-11T12:34:00.000Z');
    expect(record.retentionUntil.toISOString()).toBe('2026-04-18T12:34:56.789Z');
    expect(record.lastPayload).toEqual({
      event: 'heartbeat',
      timestamp: observedAt.toISOString(),
      metadata: { uptime: 42 },
    });
  });

  it('classifies machine-generated alerts into longer-lived retained series', () => {
    expect(machineTelemetryStorageSpec({
      event: 'heartbeat',
      metadata: { alert: 'security_tamper' },
    })).toEqual({
      series: 'security_tamper',
      retentionClass: 'alert_30d',
      bucketResolutionSec: MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC,
    });

    expect(machineTelemetryStorageSpec({
      event: 'heartbeat',
      metadata: { alert: 'network_anomaly' },
    })).toEqual({
      series: 'network_anomaly',
      retentionClass: 'alert_30d',
      bucketResolutionSec: MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC,
    });

    expect(machineTelemetryStorageSpec({
      event: 'heartbeat',
      metadata: { alert: 'heartbeat_dead', source: 'watchdog' },
    })).toEqual({
      series: 'watchdog_alert',
      retentionClass: 'alert_30d',
      bucketResolutionSec: MACHINE_TELEMETRY_BUCKET_RESOLUTION_SEC,
    });
  });

  it('rounds timestamps down to the configured telemetry bucket boundary', () => {
    const bucket = telemetryBucketStart(new Date('2026-04-11T12:34:59.999Z'), 300);
    expect(bucket.toISOString()).toBe('2026-04-11T12:30:00.000Z');
  });
});
