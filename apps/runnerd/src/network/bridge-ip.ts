export interface IncusQuery {
  <T>(path: string): Promise<T>;
}

export async function allocateStaticBridgeIpv4(deps: { queryIncus: IncusQuery }, networkName = 'incusbr0') {
  const network = await deps.queryIncus<{
    config?: Record<string, string>;
  }>(`/1.0/networks/${encodeURIComponent(networkName)}`);
  const subnet = network.config?.['ipv4.address'];
  if (!subnet || !subnet.includes('/24')) return null;

  const prefix = subnet.split('/')[0]?.split('.').slice(0, 3).join('.');
  if (!prefix) return null;

  const leases = await deps.queryIncus<Array<{ address?: string }>>(`/1.0/networks/${encodeURIComponent(networkName)}/leases`);
  const used = new Set(
    leases
      .map((lease) => lease.address)
      .filter((address): address is string => Boolean(address)),
  );

  for (let host = 250; host >= 200; host -= 1) {
    const candidate = `${prefix}.${host}`;
    if (!used.has(candidate)) return candidate;
  }

  return null;
}
