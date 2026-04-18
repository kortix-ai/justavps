export async function waitForInstance(input: {
  instanceName: string;
  queryIncus: <T>(path: string) => Promise<T>;
  delay: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 180000;
  const intervalMs = input.intervalMs ?? 1000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await input.queryIncus(`/1.0/instances/${encodeURIComponent(input.instanceName)}`);
      return;
    } catch {
      await input.delay(intervalMs);
    }
  }
  throw new Error(`Timed out waiting for instance ${input.instanceName} to appear`);
}

export async function waitForPrivateIpv4<T extends { privateIpv4?: string | null }>(input: {
  instanceName: string;
  inspectInstance: (instanceName: string) => Promise<T>;
  delay: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 120000;
  const intervalMs = input.intervalMs ?? 1000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const inspected = await input.inspectInstance(input.instanceName);
    if (inspected.privateIpv4) return inspected;
    await input.delay(intervalMs);
  }
  throw new Error(`Timed out waiting for private IPv4 on ${input.instanceName}`);
}
