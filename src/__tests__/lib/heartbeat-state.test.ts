import { describe, expect, it } from 'vitest';

import {
  HEARTBEAT_MACHINE_PROJECTION_MS,
  buildHeartbeatMachineProjection,
  effectiveHeartbeatForMachine,
  heartbeatProjectionDue,
} from "@/server/platform/control-plane/heartbeat-state";

describe('heartbeat state', () => {
  const payload = {
    daemonVersion: '1.2.3',
    uptime: 42,
    services: { ssh: true },
    load: { cpu: 0.2, memory: 0.4, disk: 0.6 },
    network: { bytes_in: 1, bytes_out: 2, rate_in: 3, rate_out: 4, connections: 5 },
    security: { ufw_active: true, fail2ban_active: true, ssh_key_only: true },
  } as const;

  it('projects machine heartbeat immediately for readiness transitions', () => {
    const due = heartbeatProjectionDue({
      machine: {
        lastHeartbeatAt: new Date('2026-04-04T12:00:00.000Z'),
        lastHeartbeat: null,
        daemonVersion: null,
        status: 'provisioning',
        readyAt: null,
        provisioningStage: 'server_created',
        providerMeta: {},
      } as never,
      existingState: { lastProjectedAt: new Date('2026-04-04T12:00:00.000Z') },
      heartbeatAt: new Date('2026-04-04T12:00:30.000Z'),
      shouldMarkReady: true,
      payload,
    });

    expect(due).toBe(true);
  });

  it('throttles machine-row projections while keeping heartbeat state hot', () => {
    const heartbeatAt = new Date('2026-04-04T12:01:00.000Z');
    const notDue = heartbeatProjectionDue({
      machine: {
        lastHeartbeatAt: new Date('2026-04-04T12:00:00.000Z'),
        lastHeartbeat: {
          cpu: 0.1,
          memory: 0.2,
          disk: 0.3,
          services: { ssh: true },
          security: { ufw_active: true, fail2ban_active: true, ssh_key_only: true },
        },
        daemonVersion: '1.2.3',
        status: 'ready',
        readyAt: new Date('2026-04-04T12:00:00.000Z'),
        provisioningStage: 'services_ready',
        providerMeta: {},
      } as never,
      existingState: { lastProjectedAt: new Date(heartbeatAt.getTime() - HEARTBEAT_MACHINE_PROJECTION_MS + 1_000) },
      heartbeatAt,
      shouldMarkReady: false,
      payload,
    });

    expect(notDue).toBe(false);
  });

  it('uses heartbeat rollup state as the effective watchdog health source', () => {
    const effective = effectiveHeartbeatForMachine({
      machine: {
        lastHeartbeatAt: new Date('2026-04-04T12:00:00.000Z'),
        lastHeartbeat: {
          cpu: 0.1,
          memory: 0.2,
          disk: 0.3,
          services: { ssh: false },
        },
        daemonVersion: 'old',
      } as never,
      state: {
        lastHeartbeatAt: new Date('2026-04-04T12:02:00.000Z'),
        daemonVersion: 'new',
        load: { cpu: 0.4, memory: 0.5, disk: 0.6 },
        services: { ssh: true },
        network: null,
        security: { ufw_active: true, fail2ban_active: true, ssh_key_only: true },
      },
    });

    expect(effective.lastHeartbeatAt?.toISOString()).toBe('2026-04-04T12:02:00.000Z');
    expect(effective.daemonVersion).toBe('new');
    expect(effective.lastHeartbeat).toEqual({
      cpu: 0.4,
      memory: 0.5,
      disk: 0.6,
      services: { ssh: true },
      security: { ufw_active: true, fail2ban_active: true, ssh_key_only: true },
    });
  });

  it('builds compatibility projection patches for existing machine consumers', () => {
    const heartbeatAt = new Date('2026-04-04T12:03:00.000Z');
    const patch = buildHeartbeatMachineProjection({
      machine: {
        status: 'provisioning',
        providerMeta: {},
      } as never,
      heartbeatAt,
      shouldMarkReady: true,
      payload,
    });

    expect(patch).toEqual(expect.objectContaining({
      status: 'ready',
      readyAt: heartbeatAt,
      lastHeartbeatAt: heartbeatAt,
      daemonVersion: '1.2.3',
      provisioningStage: 'services_ready',
    }));
  });
});
