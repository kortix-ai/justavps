import { decryptSecret } from '@/server/lib/crypto';
import { config } from '@/server/lib/config';
import { planIdFromProviderSku, resolvePlanForDisplay } from '@/lib/plan-catalog';

function safeISO(d?: Date | null) {
  if (!d) return null;
  const iso = d.toISOString?.();
  return iso && !iso.includes('Invalid') ? iso : null;
}

function readProvisionMeta(machine: {
  providerMeta?: Record<string, unknown> | null;
  providerProgress?: number | null;
  providerStatus?: string | null;
  callbackExpected?: boolean | null;
  callbackUrl?: string | null;
}) {
  const value = (machine.providerMeta ?? {}) as Record<string, unknown>;
  return {
    providerProgress: machine.providerProgress ?? (typeof value.create_progress === 'number' ? value.create_progress : null),
    providerStatus: machine.providerStatus ?? (typeof value.create_status === 'string' ? value.create_status : null),
    callbackExpected: machine.callbackExpected ?? (typeof value.callback_expected === 'boolean' ? value.callback_expected : null),
    callbackUrl: (machine.callbackUrl === '' ? null : machine.callbackUrl) ?? (typeof value.callback_url === 'string' ? value.callback_url : null),
  };
}

export function serializeMachineV1(
  m: {
    id: string;
    slug: string;
    name: string;
    status: string;
    provisioningStage?: string | null;
    provisioningStageUpdatedAt?: Date | null;
    provider: string;
    imageId: string | null;
    serverType: string;
    region: string;
    ip: string | null;
    publicIpv4?: string | null;
    sshPort?: number | null;
    providerProgress?: number | null;
    providerStatus?: string | null;
  callbackExpected?: boolean | null;
  callbackUrl?: string | null;
    priceMonthly?: number | null;
    backupsEnabled?: boolean | null;
    createdAt: Date;
    readyAt?: Date | null;
    sshPrivateKey?: string | null;
    sshPublicKey?: string | null;
    providerMeta?: Record<string, unknown> | null;
    source?: string | null;
    kortixSandboxId?: string | null;
    daemonVersion?: string | null;
    lastHeartbeat?: Record<string, unknown> | null;
    lastHeartbeatAt?: Date | null;
  },
  sub?: {
    status: string;
    cancelAtPeriodEnd: boolean;
    cancelAt?: Date | null;
    cancelledAt?: Date | null;
    currentPeriodEnd?: Date | null;
  } | null,
  options?: { includeSensitive?: boolean },
) {
  const includeSensitive = options?.includeSensitive ?? true;
  const proxyDomain = config.PROXY_DOMAIN;
  const sshKeyPath = `~/.ssh/justavps_${m.slug}`;
  const providerMeta = (m.providerMeta ?? {}) as Record<string, unknown>;
  const sshPort = m.sshPort ?? (typeof providerMeta.ssh_port === 'number' ? providerMeta.ssh_port : typeof providerMeta.ssh_port === 'string' && providerMeta.ssh_port.trim() ? Number(providerMeta.ssh_port) : null);
  const sshHost = m.publicIpv4 ?? m.ip ?? (typeof providerMeta.public_ipv4 === 'string' ? providerMeta.public_ipv4 : null);

  let sshPrivateKeyPlain: string | null = null;
  if (includeSensitive && m.sshPrivateKey) {
    try {
      sshPrivateKeyPlain = decryptSecret(m.sshPrivateKey);
    } catch {
      sshPrivateKeyPlain = null;
    }
  }

  const setupCommand = sshPrivateKeyPlain && sshHost
    ? `mkdir -p ~/.ssh && echo '${sshPrivateKeyPlain.replace(/'/g, "'\\''")}' > ${sshKeyPath} && chmod 600 ${sshKeyPath} && ssh -i ${sshKeyPath}${sshPort ? ` -p ${sshPort}` : ''} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${sshHost}`
    : null;
  const sshCommand = sshHost ? `ssh -i ${sshKeyPath}${sshPort ? ` -p ${sshPort}` : ''} -o StrictHostKeyChecking=no root@${sshHost}` : null;
  const fallbackCallback = { callbackExpected: true, url: null };
  const rawProvisionMeta = readProvisionMeta(m);
  const normalizedCallbackUrl = m.callbackUrl === '' ? null : m.callbackUrl;
  const provisionMeta = {
    ...rawProvisionMeta,
    callbackExpected: rawProvisionMeta.callbackExpected ?? fallbackCallback.callbackExpected,
    callbackUrl: normalizedCallbackUrl ?? rawProvisionMeta.callbackUrl ?? fallbackCallback.url,
  };
  const planId = planIdFromProviderSku(m.serverType) ?? m.serverType;
  const planMeta = resolvePlanForDisplay(m.serverType);

  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    status: m.status,
    provisioning_stage: m.provisioningStage ?? null,
    provisioning_stage_updated_at: m.provisioningStageUpdatedAt?.toISOString() ?? null,
    provider: m.provider,
    image_id: m.imageId,
    server_type: planId,
    plan_label: planMeta?.label ?? null,
    region: m.region,
    ip: m.ip,
    provider_progress: provisionMeta.providerProgress,
    provider_status: provisionMeta.providerStatus,
    callback_expected: provisionMeta.callbackExpected,
    callback_url: provisionMeta.callbackUrl,
    price_monthly: m.priceMonthly || null,
    backups_enabled: m.backupsEnabled,
    created_at: m.createdAt.toISOString(),
    ready_at: m.readyAt?.toISOString() ?? null,
    urls: m.ip ? {
      proxy: `https://${m.slug}.${proxyDomain}`,
      terminal: `https://${m.slug}.${proxyDomain}/_terminal`,
      port_template: `https://{port}--${m.slug}.${proxyDomain}`,
    } : null,
    ssh: sshCommand,
    ssh_key: sshPrivateKeyPlain ? {
      private_key: sshPrivateKeyPlain,
      public_key: m.sshPublicKey,
      setup_command: setupCommand,
      key_path: sshKeyPath,
    } : null,
    connect: {
      ssh_command: sshCommand,
      setup_command: setupCommand,
      vscode_url: `https://${m.slug}.${proxyDomain}`,
      cursor_ssh: m.ip ? `ssh -i ${sshKeyPath} root@${m.ip}` : null,
    },
    source: m.source || 'user',
    kortix_sandbox_id: m.kortixSandboxId ?? null,
    daemon_version: m.daemonVersion ?? null,
    subscription: sub ? {
      status: sub.status,
      cancel_at_period_end: sub.cancelAtPeriodEnd,
      cancel_at: safeISO(sub.cancelAt),
      cancelled_at: safeISO(sub.cancelledAt),
      current_period_end: safeISO(sub.currentPeriodEnd),
    } : null,
    health: m.lastHeartbeat ? {
      ...m.lastHeartbeat,
      last_heartbeat_at: m.lastHeartbeatAt?.toISOString() ?? null,
    } : null,
  };
}
