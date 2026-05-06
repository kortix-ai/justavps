type PlacementHost = {
  status: string;
  runnerBaseUrl: string | null;
  maintenanceState?: string | null;
};

export function hostAcceptsPlacement(host: PlacementHost) {
  return host.status === 'active'
    && !!host.runnerBaseUrl
    && (host.maintenanceState ?? 'in_service') === 'in_service';
}

export function hostPlacementBlockReason(host: PlacementHost) {
  if (host.status !== 'active') return `host status is ${host.status}`;
  if (!host.runnerBaseUrl) return 'host runner is not registered';
  if ((host.maintenanceState ?? 'in_service') !== 'in_service') {
    return `host maintenance state is ${host.maintenanceState}`;
  }
  return null;
}
