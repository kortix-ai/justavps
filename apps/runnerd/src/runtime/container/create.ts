export function buildContainerLaunchArgs(input: {
  resolvedImage: string;
  instanceName: string;
  vcpu: number;
  memoryGb: number;
  diskGb: number;
  staticIpv4: string | null;
  cloudInitUserData: string;
  incusTarget: (name?: string) => string;
}) {
  const launchArgs = [
    'launch', input.resolvedImage, input.incusTarget(input.instanceName),
    '-c', 'security.privileged=false',
    '-c', 'security.idmap.isolated=true',
    '-c', 'security.nesting=false',
    '-c', 'security.syscalls.intercept.mount=false',
    '-c', 'security.syscalls.intercept.setxattr=false',
    '-c', `limits.cpu=${input.vcpu}`,
    '-c', `limits.memory=${input.memoryGb}GiB`,
    '-d', `root,size=${input.diskGb}GiB`,
  ];

  if (input.staticIpv4) {
    launchArgs.push('-d', `eth0,ipv4.address=${input.staticIpv4}`);
  }
  if (input.cloudInitUserData.trim()) {
    launchArgs.push('-c', `cloud-init.user-data=${input.cloudInitUserData}`);
  }

  return launchArgs;
}

export function buildContainerCreateMetadata(input: {
  status: string | null;
  requestedStaticIpv4: string | null;
  totalMs: number;
  stageTimings: Record<string, number>;
}) {
  return {
    incus_status: input.status,
    machine_mode: 'container',
    hardening: {
      privileged: false,
      isolated_idmap: true,
      nesting: false,
    },
    network: {
      requested_ipv4: input.requestedStaticIpv4,
    },
    benchmark: {
      scenario: 'cold_create',
      total_ms: input.totalMs,
      stage_timings: input.stageTimings,
    },
  };
}
