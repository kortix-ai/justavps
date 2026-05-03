import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppConfig } from './config.js';
import { createApp } from './app.js';
import { resetMemoryTelemetryStoreForTests } from './telemetry-store.js';

function config(): AppConfig {
  return {
    port: 4200,
    adminToken: 'admin-secret',
    corsOrigins: [],
    databaseConfigured: false,
    clusters: [],
    proxyDomain: 'kortix.cloud',
    appUrl: 'http://localhost:4200',
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
      ingestToken: 'telemetry-secret',
      ingestBaseUrl: 'http://localhost:4200',
      ingestReachableFromSandbox: false,
      warnings: [],
      metricIntervalSeconds: 5,
    },
  };
}

async function json(response: Response) {
  return await response.json() as Record<string, any>;
}

test('telemetry ingest token can write and admin can query latest/logs/traces/events', async () => {
  resetMemoryTelemetryStoreForTests();
  const app = createApp(config());
  const machineId = 'route-telemetry-e2e';

  const ingestHeaders = { 'content-type': 'application/json', 'x-justavps-telemetry-token': 'telemetry-secret' };
  const adminHeaders = { authorization: 'Bearer admin-secret' };

  let response = await app.request(`/internal/telemetry/machines/${machineId}/metrics`, {
    method: 'POST',
    headers: ingestHeaders,
    body: JSON.stringify({ load: { cpu: 0.33, memory: 0.44, disk: 0.55 }, network: { connections: 4 }, services: {}, security: {} }),
  });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).ok, true);

  response = await app.request(`/internal/telemetry/machines/${machineId}/logs`, {
    method: 'POST',
    headers: ingestHeaders,
    body: JSON.stringify({ logs: [{ severity: 'error', source: 'daemon', body: 'route error log' }] }),
  });
  assert.equal(response.status, 200);

  response = await app.request(`/internal/telemetry/machines/${machineId}/traces`, {
    method: 'POST',
    headers: ingestHeaders,
    body: JSON.stringify({ spans: [{ trace_id: 'r1', span_id: 's1', operation: 'toolbox.exec', name: 'echo route', status: 'ok' }] }),
  });
  assert.equal(response.status, 200);

  response = await app.request(`/internal/telemetry/machines/${machineId}/events`, {
    method: 'POST',
    headers: ingestHeaders,
    body: JSON.stringify({ events: [{ type: 'sandbox.created', category: 'lifecycle', body: 'created' }] }),
  });
  assert.equal(response.status, 200);

  response = await app.request(`/admin/telemetry/machines/${machineId}/latest`, { headers: adminHeaders });
  assert.equal(response.status, 200);
  const latest = await json(response);
  assert.equal(latest.latest.metrics['justavps.sandbox.cpu.utilization'].value, 33);

  response = await app.request(`/admin/telemetry/machines/${machineId}/logs?level=error`, { headers: adminHeaders });
  assert.equal(response.status, 200);
  const logs = await json(response);
  assert.equal(logs.logs[0].body, 'route error log');

  response = await app.request(`/admin/telemetry/machines/${machineId}/traces?operation=toolbox.exec`, { headers: adminHeaders });
  assert.equal(response.status, 200);
  const traces = await json(response);
  assert.equal(traces.traces[0].name, 'echo route');

  response = await app.request(`/admin/telemetry/machines/${machineId}/events`, { headers: adminHeaders });
  assert.equal(response.status, 200);
  const events = await json(response);
  assert.equal(events.events.some((event: { type: string }) => event.type === 'sandbox.created'), true);
});
