export function extractPrivateIpv4(network: Record<string, { addresses?: Array<{ family?: string; scope?: string; address?: string }> }> | undefined) {
  for (const iface of Object.values(network ?? {})) {
    const addresses = iface.addresses ?? [];
    const ipv4 = addresses.find((addr) => addr.family === 'inet' && addr.scope === 'global');
    if (ipv4?.address) return ipv4.address;
  }
  return null;
}

export async function inspectInstance(input: {
  instanceName: string;
  queryIncus: <T>(path: string) => Promise<T>;
}) {
  const state = await input.queryIncus<{
    status: string;
    network?: Record<string, { addresses?: Array<{ family?: string; scope?: string; address?: string }> }>;
  }>(`/1.0/instances/${encodeURIComponent(input.instanceName)}/state`);

  return {
    privateIpv4: extractPrivateIpv4(state?.network),
    status: state.status || null,
  };
}
