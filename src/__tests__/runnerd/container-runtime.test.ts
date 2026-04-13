import { describe, expect, it } from 'vitest';

describe('runnerd container runtime helpers', () => {
  it('builds container launch args with optional static IP and cloud-init', async () => {
    const { buildContainerLaunchArgs } = await import('../../../runnerd/src/runtime/container/create');

    expect(buildContainerLaunchArgs({
      resolvedImage: 'justavps-golden-container',
      instanceName: 'justavps-demo',
      vcpu: 2,
      memoryGb: 4,
      diskGb: 20,
      staticIpv4: '10.0.0.250',
      cloudInitUserData: '#!/bin/bash\necho hi',
      incusTarget: (name) => name ?? '',
    })).toEqual([
      'launch', 'justavps-golden-container', 'justavps-demo',
      '-c', 'security.privileged=false',
      '-c', 'security.idmap.isolated=true',
      '-c', 'security.nesting=false',
      '-c', 'security.syscalls.intercept.mount=false',
      '-c', 'security.syscalls.intercept.setxattr=false',
      '-c', 'limits.cpu=2',
      '-c', 'limits.memory=4GiB',
      '-d', 'root,size=20GiB',
      '-d', 'eth0,ipv4.address=10.0.0.250',
      '-c', 'cloud-init.user-data=#!/bin/bash\necho hi',
    ]);
  });

  it('builds container response metadata with benchmark stages', async () => {
    const { buildContainerCreateMetadata } = await import('../../../runnerd/src/runtime/container/create');

    expect(buildContainerCreateMetadata({
      status: 'Running',
      requestedStaticIpv4: '10.0.0.250',
      totalMs: 1500,
      stageTimings: { launch_ms: 700, ip_ready_ms: 1400 },
    })).toEqual({
      incus_status: 'Running',
      machine_mode: 'container',
      hardening: {
        privileged: false,
        isolated_idmap: true,
        nesting: false,
      },
      network: { requested_ipv4: '10.0.0.250' },
      benchmark: {
        scenario: 'cold_create',
        total_ms: 1500,
        stage_timings: { launch_ms: 700, ip_ready_ms: 1400 },
      },
    });
  });
});
