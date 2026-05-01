// Procurement → init auto-handoff. The piece that closes the "1-click
// order to running cluster member" loop.
//
// Trigger: Host row exists with a target_cluster_id (operator's choice
// of where the new node should join), no incus_member_name yet (not
// joined), and lifecycle_state in {requested, ordered, delivered,
// bootstrapping}. We auto-create a NodeProvisioningRun pointing at the
// host's IP, with from_rescue=true so the runner re-installs Ubuntu
// from Hetzner Rescue and joins the target cluster.
//
// Operator override: setting target_cluster_id is the explicit consent
// to auto-bootstrap. Without it, hosts sit in inventory until an
// operator manually creates a run.
//
// Pure function. Worker tick injects DB reads/writes.

export type HandoffHost = {
  id: string;
  publicIpv4: string | null;
  publicIpv6: string | null;
  incusMemberName: string | null;
  lifecycleState: string;
  // Stored in Host.metadata.target_cluster_id (no schema change). The
  // operator sets this via UI/API to opt this host into auto-handoff.
  targetClusterId: string | null;
};

export type HandoffRun = {
  sshHost: string;
  status: string;
  // Time the run was created. We use this to back off on auto-retries:
  // any run within the cooldown window (default 1h) blocks new
  // auto-handoffs for the same host, regardless of status. Operator
  // explicitly /retry's via the existing run endpoint to override.
  createdAt: Date;
};

export type HandoffEvent = {
  hostId: string;
  clusterId: string;
  sshHost: string;
  fromRescue: boolean;
};

const ELIGIBLE_STATES = new Set(['requested', 'ordered', 'delivered', 'bootstrapping']);
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — see HandoffRun.createdAt

export function decideAutoHandoffs(opts: {
  hosts: HandoffHost[];
  openRuns: HandoffRun[];
  now?: Date;
}): HandoffEvent[] {
  const now = opts.now ?? new Date();
  // Any run for an IP within the cooldown blocks new handoffs — failed
  // runs need operator triage before auto-retry; succeeded runs mean the
  // host already joined; pending/running just shouldn't be piled on.
  const cooldownIps = new Set<string>();
  for (const r of opts.openRuns) {
    if (now.getTime() - r.createdAt.getTime() < COOLDOWN_MS) {
      cooldownIps.add(r.sshHost);
    }
  }
  const events: HandoffEvent[] = [];
  for (const host of opts.hosts) {
    if (!host.targetClusterId) continue;
    if (host.incusMemberName) continue; // already joined
    if (!ELIGIBLE_STATES.has(host.lifecycleState)) continue;
    const ip = host.publicIpv4 ?? host.publicIpv6;
    if (!ip) continue;
    if (cooldownIps.has(ip)) continue;
    events.push({
      hostId: host.id,
      clusterId: host.targetClusterId,
      sshHost: ip,
      fromRescue: true,
    });
  }
  return events;
}
