import { describe, expect, it } from 'vitest';

import {
  deriveMachineReadinessStrategy,
  shouldMarkReadyFromHttpProbe,
  type MachineReadinessStrategy,
} from "@/server/v2/domains/machine/readiness";

describe('machine readiness domain', () => {
  it('derives readiness strategy by runtime kind', () => {
    expect(deriveMachineReadinessStrategy({ runtimeKind: 'vm' })).toBe<MachineReadinessStrategy>('daemon_heartbeat');
    expect(deriveMachineReadinessStrategy({ runtimeKind: 'container_system' })).toBe<MachineReadinessStrategy>('daemon_heartbeat');
    expect(deriveMachineReadinessStrategy({ runtimeKind: 'container_app_docker' })).toBe<MachineReadinessStrategy>('http_probe');
  });

  it('only allows docker app containers to transition via HTTP probe', () => {
    expect(shouldMarkReadyFromHttpProbe({ runtimeKind: 'container_app_docker', host: '1.2.3.4', port: 8080 })).toBe(true);
    expect(shouldMarkReadyFromHttpProbe({ runtimeKind: 'vm', host: '1.2.3.4', port: 8080 })).toBe(false);
    expect(shouldMarkReadyFromHttpProbe({ runtimeKind: 'container_app_docker', host: null, port: 8080 })).toBe(false);
    expect(shouldMarkReadyFromHttpProbe({ runtimeKind: 'container_app_docker', host: '1.2.3.4', port: null })).toBe(false);
  });
});
