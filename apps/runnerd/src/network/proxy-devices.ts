interface IncusCommandRunner {
  (args: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string }>;
}

interface ProxyDeviceSetupInput {
  instanceName: string;
  sshPort: number | null;
  httpPort: number;
  publicIpv4: string;
  runIncus: IncusCommandRunner;
  incusTarget: (name?: string) => string;
}

export async function setupProxyDevices(input: ProxyDeviceSetupInput & { vmIp: string }) {
  const { instanceName, vmIp, sshPort, httpPort, publicIpv4, runIncus, incusTarget } = input;

  for (const dev of ['ssh', 'http', 'eth0']) {
    try {
      await runIncus(['config', 'device', 'remove', incusTarget(instanceName), dev], 5000);
    } catch {
      // ignore missing device
    }
  }

  await runIncus(['config', 'device', 'add', incusTarget(instanceName), 'eth0', 'nic', 'name=eth0', 'nictype=bridged', 'parent=incusbr0', `ipv4.address=${vmIp}`], 10000);
  if (sshPort) {
    await runIncus(['config', 'device', 'add', incusTarget(instanceName), 'ssh', 'proxy', 'nat=true', `listen=tcp:${publicIpv4}:${sshPort}`, `connect=tcp:${vmIp}:22`], 10000);
  }
  await runIncus(['config', 'device', 'add', incusTarget(instanceName), 'http', 'proxy', 'nat=true', `listen=tcp:${publicIpv4}:${httpPort}`, `connect=tcp:${vmIp}:80`], 10000);
}

export async function setupWarmClaimProxyDevices(input: ProxyDeviceSetupInput & { vmIp: string }) {
  const { instanceName, vmIp, sshPort, httpPort, publicIpv4, runIncus, incusTarget } = input;

  for (const dev of ['ssh', 'http']) {
    try {
      await runIncus(['config', 'device', 'remove', incusTarget(instanceName), dev], 5000);
    } catch {
      // ignore missing device
    }
  }

  if (sshPort) {
    await runIncus(['config', 'device', 'add', incusTarget(instanceName), 'ssh', 'proxy', 'nat=true', `listen=tcp:${publicIpv4}:${sshPort}`, `connect=tcp:${vmIp}:22`], 10000);
  }
  await runIncus(['config', 'device', 'add', incusTarget(instanceName), 'http', 'proxy', 'nat=true', `listen=tcp:${publicIpv4}:${httpPort}`, `connect=tcp:${vmIp}:80`], 10000);
}

export async function setupContainerProxyDevices(input: ProxyDeviceSetupInput & { containerIp: string }) {
  const { instanceName, containerIp, sshPort, httpPort, publicIpv4, runIncus, incusTarget } = input;

  for (const dev of ['ssh', 'http']) {
    try {
      await runIncus(['config', 'device', 'remove', incusTarget(instanceName), dev], 5000);
    } catch {
      // ignore missing device
    }
  }

  if (sshPort) {
    await runIncus(['config', 'device', 'add', incusTarget(instanceName), 'ssh', 'proxy', 'nat=true', `listen=tcp:${publicIpv4}:${sshPort}`, `connect=tcp:${containerIp}:22`], 10000);
  }
  await runIncus(['config', 'device', 'add', incusTarget(instanceName), 'http', 'proxy', 'nat=true', `listen=tcp:${publicIpv4}:${httpPort}`, `connect=tcp:${containerIp}:80`], 10000);
}
