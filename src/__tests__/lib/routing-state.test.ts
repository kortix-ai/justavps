import { describe, expect, it } from 'vitest';

import { buildDesiredRoutingSnapshot, buildRoutingKVRecord, routingStateNeedsRepair } from '@/server/lib/routing-state';

describe('routing state helpers', () => {
  it('models present routing with explicit pending artifact sync', () => {
    const snapshot = buildDesiredRoutingSnapshot({
      machineId: 'machine-1',
      accountId: 'account-1',
      machineSlug: 'alpha',
      machineStatus: 'ready',
      desiredIp: '203.0.113.10',
      desiredOriginPort: 40231,
      publicIpv4: '203.0.113.10',
      originHostname: 'origin-alpha.example.com',
    });

    expect(snapshot).toMatchObject({
      desiredState: 'present',
      kvState: 'pending',
      dnsState: 'pending',
      desiredIp: '203.0.113.10',
      desiredOriginPort: 40231,
    });
  });

  it('models absent routing for deleted or unroutable machines', () => {
    const snapshot = buildDesiredRoutingSnapshot({
      machineId: 'machine-1',
      accountId: 'account-1',
      machineSlug: 'alpha',
      machineStatus: 'deleted',
      desiredIp: null,
    });

    expect(snapshot.desiredState).toBe('absent');
    expect(snapshot.kvState).toBe('absent');
    expect(snapshot.dnsState).toBe('absent');
    expect(routingStateNeedsRepair({ desiredState: 'absent', kvState: 'error', dnsState: 'absent' })).toBe(true);
    expect(routingStateNeedsRepair({ desiredState: 'absent', kvState: 'absent', dnsState: 'absent' })).toBe(false);
  });

  it('builds kv payloads with explicit routing metadata', () => {
    expect(buildRoutingKVRecord({
      machineId: 'machine-1',
      accountId: 'account-1',
      desiredIp: '203.0.113.10',
      machineStatus: 'ready',
      serverType: 'custom',
      desiredOriginPort: 40231,
      desiredOriginHostname: 'origin-alpha.example.com',
      routingVersion: 7,
    })).toMatchObject({
      machine_id: 'machine-1',
      account_id: 'account-1',
      ip: '203.0.113.10',
      origin_port: 40231,
      origin_hostname: 'origin-alpha.example.com',
      status: 'ready',
      routing_state: 'ready',
      routing_version: 7,
    });
  });
});
