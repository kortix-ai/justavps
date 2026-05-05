import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppConfig } from './config.js';
import {
  getTelemetryStore,
  logEntriesFromPayload,
  metricSamplesFromPayload,
  resetMemoryTelemetryStoreForTests,
  traceSpansFromPayload,
} from './telemetry-store.js';

function config(): AppConfig {
  return {
    port: 4200,
    corsOrigins: [],
    databaseConfigured: false,
    clusters: [],
    proxyDomain: 'kortix.cloud',
    appUrl: 'http://localhost:4200',
    daemonCallbackUrl: 'http://localhost:4200',
    daemonDownloadUrl: 'http://localhost/daemon',
    daemonEnsureWorker: false,
    sshGatewayEnabled: false,
    sshGatewayHost: 'localhost',
    sshGatewayPort: 2222,
    telemetry: {
      enabled: true,
      driver: 'memory',
      clickhouseDatabase: 'justavps_telemetry',
      rawRetentionDays: 7,
      ingestBaseUrl: 'http://localhost:4200',
      ingestReachableFromSandbox: false,
      warnings: [],
      metricIntervalSeconds: 5,
    },
  };
}

test('metricSamplesFromPayload normalizes daemon heartbeat metrics', () => {
  const rows = metricSamplesFromPayload('m-1', {
    account_id: 'acct',
    load: { cpu: 0.25, memory: 0.5, disk: 0.75 },
    network: { bytes_in: 100, bytes_out: 200, rate_in: 10, rate_out: 20, connections: 3 },
    uptime: 42,
    services: { docker: true },
    security: { ufw_active: false },
  });
  const byName = new Map(rows.map((row) => [row.name, row]));
  assert.equal(byName.get('justavps.sandbox.cpu.utilization')?.value, 25);
  assert.equal(byName.get('justavps.sandbox.memory.utilization')?.value, 50);
  assert.equal(byName.get('justavps.sandbox.filesystem.utilization')?.value, 75);
  assert.equal(byName.get('justavps.sandbox.network.connections')?.value, 3);
  assert.equal(byName.get('justavps.daemon.up')?.value, 1);
});

test('memory telemetry store ingests and queries metrics/logs/traces', async () => {
  resetMemoryTelemetryStoreForTests();
  const store = getTelemetryStore(config());
  await store.insertMetrics(metricSamplesFromPayload('machine-1', { load: { cpu: 0.5 }, network: {}, services: {}, security: {} }));
  await store.insertLogs(logEntriesFromPayload('machine-1', { logs: [{ severity: 'error', source: 'daemon', body: 'boom' }] }));
  await store.insertTraces(traceSpansFromPayload('machine-1', { spans: [{ trace_id: 't1', span_id: 's1', operation: 'toolbox.exec', name: 'echo ok', status: 'ok', duration_ms: 12 }] }));

  const latest = await store.latest('machine-1');
  assert.equal(latest.metrics['justavps.sandbox.cpu.utilization'].value, 50);
  assert.equal(latest.health, 'healthy');

  const logs = await store.logs('machine-1', { level: 'error', limit: 10 });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].body, 'boom');

  const traces = await store.traces('machine-1', { operation: 'toolbox.exec', limit: 10 });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].name, 'echo ok');

  const overview = await store.overview({});
  assert.equal(overview.machines_seen, 1);
  assert.equal(overview.error_log_rows, 1);
});
