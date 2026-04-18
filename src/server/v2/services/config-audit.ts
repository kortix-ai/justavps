import { db, resetDbConnection } from '@/server/db';
import { baremetalHosts, cellAdmissionControls, cells } from '@/server/db/schema';
import { buildBaremetalCellCapacitySnapshots, buildBaremetalCellState } from "@/server/platform/baremetal/cells";
import { config } from "@/server/core/config";

type ConfigAuditSeverity = 'ok' | 'warning' | 'error';

interface ConfigAuditCheck {
  key: string;
  severity: ConfigAuditSeverity;
  message: string;
  details?: string;
}

interface FleetHostAuditSummary {
  total_hosts: number;
  active_schedulable_hosts: number;
  bootstrapping_hosts: number;
  pending_validation_hosts: number;
  quarantined_hosts: number;
  warning_drift_hosts: number;
  blocking_drift_hosts: number;
}

interface FleetHostAuditEntry {
  id: string;
  name: string;
  status: string;
  quarantined: boolean;
  unschedulable_reason: string | null;
  drift_status: 'in_policy' | 'warning_drift' | 'blocking_drift' | null;
  validation_status: 'passed' | 'warning' | 'failed' | null;
}

const AUDIT_DB_TIMEOUT_MS = 5_000;

function buildConfigAuditChecks(): ConfigAuditCheck[] {
  const checks: ConfigAuditCheck[] = [];

  checks.push(config.isDatabaseConfigured()
    ? { key: 'database_url', severity: 'ok', message: 'DATABASE_URL configured' }
    : { key: 'database_url', severity: 'error', message: 'DATABASE_URL missing' });

  checks.push(config.AUTH_SECRET
    ? { key: 'auth_secret', severity: 'ok', message: 'AUTH_SECRET configured' }
    : { key: 'auth_secret', severity: 'error', message: 'AUTH_SECRET missing' });

  checks.push(config.PROXY_AUTH_SECRET
    ? { key: 'proxy_auth_secret', severity: 'ok', message: 'PROXY_AUTH_SECRET configured' }
    : { key: 'proxy_auth_secret', severity: 'error', message: 'PROXY_AUTH_SECRET missing' });

  checks.push(config.DATA_ENCRYPTION_KEY
    ? { key: 'data_encryption_key', severity: 'ok', message: 'DATA_ENCRYPTION_KEY configured' }
    : { key: 'data_encryption_key', severity: 'error', message: 'DATA_ENCRYPTION_KEY missing' });

  checks.push(config.isCloudProviderConfigured()
    ? { key: 'hetzner_api', severity: 'ok', message: 'Hetzner Cloud API configured' }
    : { key: 'hetzner_api', severity: 'warning', message: 'Hetzner Cloud API key missing' });

  checks.push(config.hasHetznerRobotCredentials()
    ? { key: 'hetzner_robot', severity: 'ok', message: 'Hetzner Robot credentials configured' }
    : { key: 'hetzner_robot', severity: 'warning', message: 'Hetzner Robot credentials missing' });

  checks.push(config.isCloudflareConfigured()
    ? { key: 'cloudflare_core', severity: 'ok', message: 'Cloudflare core config present' }
    : { key: 'cloudflare_core', severity: 'warning', message: 'Cloudflare API/zone config incomplete' });

  checks.push(process.env.CF_KV_NAMESPACE_ID
    ? { key: 'cloudflare_kv_namespace', severity: 'ok', message: 'Cloudflare KV namespace configured' }
    : { key: 'cloudflare_kv_namespace', severity: 'warning', message: 'Cloudflare KV namespace missing' });

  checks.push(config.BROKER_SHARED_SECRET
    ? { key: 'broker_shared_secret', severity: 'ok', message: 'BROKER_SHARED_SECRET configured' }
    : { key: 'broker_shared_secret', severity: 'warning', message: 'BROKER_SHARED_SECRET missing' });

  checks.push(config.MACHINE_CALLBACK_URL
    ? { key: 'machine_callback_url', severity: 'ok', message: 'MACHINE_CALLBACK_URL configured', details: config.MACHINE_CALLBACK_URL }
    : { key: 'machine_callback_url', severity: 'warning', message: 'MACHINE_CALLBACK_URL missing' });

  checks.push(config.isStripeConfigured()
    ? { key: 'stripe_secret_key', severity: 'ok', message: 'Stripe secret key configured' }
    : { key: 'stripe_secret_key', severity: 'warning', message: 'Stripe secret key missing' });

  checks.push(config.STRIPE_WEBHOOK_SECRET
    ? { key: 'stripe_webhook_secret', severity: 'ok', message: 'Stripe webhook secret configured' }
    : { key: 'stripe_webhook_secret', severity: 'warning', message: 'Stripe webhook secret missing' });

  checks.push(config.isMailtrapConfigured()
    ? { key: 'mail_provider', severity: 'ok', message: 'Mail provider configured' }
    : { key: 'mail_provider', severity: 'warning', message: 'Mail provider missing' });

  checks.push(config.LEGACY_PLATFORM_PROXY_ENABLED
    ? { key: 'legacy_platform_proxy', severity: 'warning', message: 'Legacy direct platform proxy is still enabled' }
    : { key: 'legacy_platform_proxy', severity: 'ok', message: 'Legacy direct platform proxy disabled' });

  checks.push(config.CONTROL_PLANE_RUNTIME_DISABLED === true || process.env.CONTROL_PLANE_RUNTIME_DISABLED === 'true'
    ? { key: 'control_plane_runtime_mode', severity: 'warning', message: 'Web process control-plane runtime disabled; separate worker required' }
    : { key: 'control_plane_runtime_mode', severity: 'ok', message: 'Control-plane runtime enabled in current app process' });

  return checks;
}

async function runAuditQuery<T>(query: () => Promise<T>): Promise<T> {
  const attempt = async () => Promise.race<T>([
    query(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`audit query timed out after ${AUDIT_DB_TIMEOUT_MS}ms`)), AUDIT_DB_TIMEOUT_MS)),
  ]);

  try {
    return await attempt();
  } catch {
    await resetDbConnection().catch(() => {});
    return attempt();
  }
}

function appendFleetHostAuditChecks(
  checks: ConfigAuditCheck[],
  hostRows: Array<typeof baremetalHosts.$inferSelect>,
  summary: FleetHostAuditSummary,
  context?: {
    cellsById: Map<string, typeof cells.$inferSelect>;
    admissionsByCellId: Map<string, typeof cellAdmissionControls.$inferSelect>;
  },
) {
  const driftStatuses = hostRows.map((host) => {
    const bootstrap = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
      ? (host.metadata.bootstrap as Record<string, unknown> | undefined)
      : undefined;
    return bootstrap?.drift_status;
  });
  const blockingHosts = hostRows.filter((host, index) => driftStatuses[index] === 'blocking_drift');
  const warningHosts = hostRows.filter((host, index) => driftStatuses[index] === 'warning_drift');

  if (summary.pending_validation_hosts > 0) {
    checks.push({
      key: 'fleet_host_pending_validation',
      severity: 'warning',
      message: `${summary.pending_validation_hosts} host(s) are awaiting bootstrap validation`,
    });
  }

  if (summary.total_hosts > 0 && summary.active_schedulable_hosts === 0) {
    checks.push({
      key: 'fleet_no_schedulable_capacity',
      severity: 'error',
      message: 'No schedulable active hosts are available for new placements',
    });
  }

  const cellSnapshots = buildBaremetalCellCapacitySnapshots(hostRows.map((host) => ({
    id: host.id,
    region: host.region,
    hostClass: host.hostClass,
    generation: host.generation,
    cellId: host.cellId,
    status: host.status,
    maintenanceState: host.maintenanceState,
    metadata: host.metadata,
    cell: buildBaremetalCellState({
      region: host.region,
      hostClass: host.hostClass,
      generation: host.generation,
      cellId: host.cellId,
      metadata: host.metadata,
      cell: context?.cellsById.get(host.cellId ?? '') ?? undefined,
      admission: context?.admissionsByCellId.get(host.cellId ?? '') ?? undefined,
    }) ?? undefined,
    capacity: {
      totalVcpu: host.totalVcpu ?? 0,
      totalMemoryGb: host.totalMemoryGb ?? 0,
      totalDiskGb: host.totalDiskGb ?? 0,
      usedVcpu: host.usedVcpu ?? 0,
      usedMemoryGb: host.usedMemoryGb ?? 0,
      usedDiskGb: host.usedDiskGb ?? 0,
    },
  })));
  const sellableCellsWithoutSchedulableHosts = cellSnapshots.filter((snapshot) => snapshot.cell.admission.state === 'open'
    && snapshot.cell.admission.sellability === 'sellable'
    && snapshot.activeSchedulableHostCount === 0);

  if (sellableCellsWithoutSchedulableHosts.length > 0) {
    checks.push({
      key: 'fleet_cell_no_schedulable_capacity',
      severity: 'error',
      message: `${sellableCellsWithoutSchedulableHosts.length} sellable cell(s) have zero schedulable active hosts`,
      details: sellableCellsWithoutSchedulableHosts.map((snapshot) => snapshot.cell.slug).join(', '),
    });
  }

  const quarantinedHosts = hostRows.filter((host) => {
    const scheduler = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
      ? (host.metadata.scheduler as Record<string, unknown> | undefined)
      : undefined;
    return scheduler?.schedulable === false;
  });

  if (quarantinedHosts.length > 0) {
    checks.push({
      key: 'fleet_host_quarantined',
      severity: 'warning',
      message: `${quarantinedHosts.length} host(s) are quarantined from scheduling`,
      details: quarantinedHosts.map((host) => host.name).join(', '),
    });
  }

  if (blockingHosts.length > 0) {
    checks.push({
      key: 'fleet_host_blocking_drift',
      severity: 'error',
      message: `${blockingHosts.length} host(s) have blocking bootstrap drift`,
      details: blockingHosts.map((host) => host.name).join(', '),
    });
  } else if (warningHosts.length > 0) {
    checks.push({
      key: 'fleet_host_warning_drift',
      severity: 'warning',
      message: `${warningHosts.length} host(s) have warning bootstrap drift`,
      details: warningHosts.map((host) => host.name).join(', '),
    });
  } else {
    checks.push({
      key: 'fleet_host_drift',
      severity: 'ok',
      message: 'No host bootstrap drift detected',
    });
  }

  return checks;
}

export async function loadConfigAuditChecks(hostRowsInput?: Array<typeof baremetalHosts.$inferSelect>, options?: { databaseReachable?: boolean }): Promise<ConfigAuditCheck[]> {
  const checks = buildConfigAuditChecks();
  const loaded = hostRowsInput ? null : await loadFleetHostAuditSummary();
  const hostRows = hostRowsInput ?? loaded?.hostRows ?? [];
  let cellRows: Array<typeof cells.$inferSelect> = [];
  let admissionRows: Array<typeof cellAdmissionControls.$inferSelect> = [];
  let dbConnectivityOk = options?.databaseReachable ?? true;
  if (dbConnectivityOk) {
    try {
      [cellRows, admissionRows] = await Promise.all([
        runAuditQuery(() => db.select().from(cells)),
        runAuditQuery(() => db.select().from(cellAdmissionControls)),
      ]);
    } catch {
      dbConnectivityOk = false;
      cellRows = [];
      admissionRows = [];
    }
  }
  checks.push(dbConnectivityOk
    ? { key: 'database_connectivity', severity: 'ok', message: 'Database connectivity check passed' }
    : { key: 'database_connectivity', severity: 'error', message: 'Database connectivity check failed' });
  const safeCellRows = Array.isArray(cellRows) ? cellRows : [];
  const safeAdmissionRows = Array.isArray(admissionRows) ? admissionRows : [];
  const cellsById = new Map(safeCellRows.map((row) => [row.id, row]));
  const admissionsByCellId = new Map(safeAdmissionRows.map((row) => [row.cellId, row]));
  const summary = hostRowsInput
      ? {
        total_hosts: hostRows.length,
        active_schedulable_hosts: hostRows.filter((host) => {
          const scheduler = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
            ? (host.metadata.scheduler as Record<string, unknown> | undefined)
            : undefined;
          return host.status === 'active' && scheduler?.schedulable !== false;
        }).length,
        bootstrapping_hosts: hostRows.filter((host) => host.status === 'bootstrapping').length,
        pending_validation_hosts: hostRows.filter((host) => {
          const bootstrap = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
            ? (host.metadata.bootstrap as Record<string, unknown> | undefined)
            : undefined;
          const validationArtifact = bootstrap?.validation_artifact;
          const validationStatus = validationArtifact && typeof validationArtifact === 'object' && !Array.isArray(validationArtifact)
            ? (validationArtifact as Record<string, unknown>).status
            : null;
          return host.status === 'bootstrapping' || !validationStatus;
        }).length,
        quarantined_hosts: hostRows.filter((host) => {
          const scheduler = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
            ? (host.metadata.scheduler as Record<string, unknown> | undefined)
            : undefined;
          return scheduler?.schedulable === false;
        }).length,
        warning_drift_hosts: hostRows.filter((host) => ((host.metadata as Record<string, unknown> | null)?.bootstrap as Record<string, unknown> | undefined)?.drift_status === 'warning_drift').length,
        blocking_drift_hosts: hostRows.filter((host) => ((host.metadata as Record<string, unknown> | null)?.bootstrap as Record<string, unknown> | undefined)?.drift_status === 'blocking_drift').length,
      }
    : loaded?.summary ?? {
        total_hosts: 0,
        active_schedulable_hosts: 0,
        bootstrapping_hosts: 0,
        pending_validation_hosts: 0,
        quarantined_hosts: 0,
        warning_drift_hosts: 0,
        blocking_drift_hosts: 0,
      };
  return appendFleetHostAuditChecks(checks, hostRows, summary, { cellsById, admissionsByCellId });
}

export async function loadFleetHostAuditSummary(): Promise<{
  hostRows: Array<typeof baremetalHosts.$inferSelect>;
  summary: FleetHostAuditSummary;
  pendingValidation: FleetHostAuditEntry[];
  quarantined: FleetHostAuditEntry[];
  warningDrift: FleetHostAuditEntry[];
  blockingDrift: FleetHostAuditEntry[];
}> {
  let hosts: Array<typeof baremetalHosts.$inferSelect> = [];
  try {
    hosts = await runAuditQuery(() => db.select().from(baremetalHosts));
  } catch {
    hosts = [];
  }
  const hostRows = Array.isArray(hosts) ? hosts : [];
  const summaries = hostRows.map((host) => {
    const bootstrap = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
      ? (host.metadata.bootstrap as Record<string, unknown> | undefined)
      : undefined;
    const scheduler = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
      ? (host.metadata.scheduler as Record<string, unknown> | undefined)
      : undefined;
    const validationArtifact = bootstrap?.validation_artifact;
    const validationStatus = validationArtifact && typeof validationArtifact === 'object' && !Array.isArray(validationArtifact)
      ? (validationArtifact as Record<string, unknown>).status
      : null;
    const schedulable = typeof scheduler?.schedulable === 'boolean' ? scheduler.schedulable : null;
    const unschedulableReason = typeof scheduler?.unschedulableReason === 'string'
      ? scheduler.unschedulableReason
      : typeof scheduler?.unschedulable_reason === 'string'
        ? scheduler.unschedulable_reason
        : null;
    return {
      id: host.id,
      name: host.name,
      status: host.status,
      quarantined: schedulable === false,
      unschedulableReason,
      driftStatus: bootstrap?.drift_status,
      validationStatus: typeof validationStatus === 'string' ? validationStatus : null,
      bootstrapping: host.status === 'bootstrapping',
    };
  });
  return {
    hostRows,
    summary: {
      total_hosts: hostRows.length,
      active_schedulable_hosts: summaries.filter((row) => row.status === 'active' && !row.quarantined).length,
      bootstrapping_hosts: summaries.filter((row) => row.bootstrapping).length,
      pending_validation_hosts: summaries.filter((row) => row.bootstrapping || !row.validationStatus).length,
      quarantined_hosts: summaries.filter((row) => row.quarantined).length,
      warning_drift_hosts: summaries.filter((row) => row.driftStatus === 'warning_drift').length,
      blocking_drift_hosts: summaries.filter((row) => row.driftStatus === 'blocking_drift').length,
    },
    pendingValidation: summaries
      .filter((row) => row.bootstrapping || !row.validationStatus)
      .map((row) => ({ id: row.id, name: row.name, status: row.status, quarantined: row.quarantined, unschedulable_reason: row.unschedulableReason, drift_status: row.driftStatus as 'in_policy' | 'warning_drift' | 'blocking_drift' | null, validation_status: row.validationStatus as 'passed' | 'warning' | 'failed' | null })),
    quarantined: summaries
      .filter((row) => row.quarantined)
      .map((row) => ({ id: row.id, name: row.name, status: row.status, quarantined: true, unschedulable_reason: row.unschedulableReason, drift_status: row.driftStatus as 'in_policy' | 'warning_drift' | 'blocking_drift' | null, validation_status: row.validationStatus as 'passed' | 'warning' | 'failed' | null })),
    warningDrift: summaries
      .filter((row) => row.driftStatus === 'warning_drift')
      .map((row) => ({ id: row.id, name: row.name, status: row.status, quarantined: row.quarantined, unschedulable_reason: row.unschedulableReason, drift_status: 'warning_drift' as const, validation_status: row.validationStatus as 'passed' | 'warning' | 'failed' | null })),
    blockingDrift: summaries
      .filter((row) => row.driftStatus === 'blocking_drift')
      .map((row) => ({ id: row.id, name: row.name, status: row.status, quarantined: row.quarantined, unschedulable_reason: row.unschedulableReason, drift_status: 'blocking_drift' as const, validation_status: row.validationStatus as 'passed' | 'warning' | 'failed' | null })),
  };
}

export function summarizeConfigAudit(checks: ConfigAuditCheck[]) {
  const counts = {
    ok: checks.filter((check) => check.severity === 'ok').length,
    warning: checks.filter((check) => check.severity === 'warning').length,
    error: checks.filter((check) => check.severity === 'error').length,
  };

  return {
    status: counts.error > 0 ? 'degraded' : counts.warning > 0 ? 'warning' : 'ok',
    counts,
  };
}
