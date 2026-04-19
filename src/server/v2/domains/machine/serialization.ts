import { eq } from 'drizzle-orm';

import { db } from '@/server/db';
import { images } from '@/server/db/schema';
import { getMachinePortAllocations } from "@/server/platform/baremetal/port-allocations";
import { decryptSecret } from "@/server/core/crypto";
import { serializeImageRow } from "@/server/core/image-catalog";
import { getProvider } from "@/server/platform/providers/index";
import { config } from "@/server/core/config";

type SerializedMachineStatus = 'provisioning' | 'ready' | 'error' | 'stopped' | 'deleted';
type SerializedMachineMode = 'vm' | 'container';
interface SerializedMachineView {
  id: string;
  slug: string;
  name: string;
  status: SerializedMachineStatus;
  provisioning_stage: string | null;
  provisioning_stage_updated_at: string | null;
  api_version: 'v2';
  machine_mode: SerializedMachineMode;
  requested_image_kind: 'golden' | 'catalog' | 'docker' | null;
  requested_image_ref: string | null;
  region: string;
  resources: { vcpu: number; ram_gb: number; disk_gb: number };
  billing: { mode: 'flat_monthly'; price_monthly: number | null; current_period_end: string | null };
  image: ReturnType<typeof serializeImageRow> | null;
  connectivity: {
    ssh_host: string | null;
    ssh_port: number | null;
    ssh_command: string | null;
    ssh_setup_command: string | null;
    ssh_config_block: string | null;
    ssh_private_key: string | null;
    ssh_public_key: string | null;
    urls: { proxy: string; terminal: string; port_template: string };
  };
  capabilities: {
    can_start: boolean;
    can_stop: boolean;
    can_reboot: boolean;
    can_resize: boolean;
    can_snapshot: boolean;
    can_create_image: boolean;
  };
  health: {
    cpu: number;
    memory: number;
    disk: number;
    services: Record<string, boolean>;
    last_heartbeat_at: string | null;
  } | null;
  provider_progress: number | null;
  provider_status: string | null;
  ready_via: 'heartbeat' | 'probe' | null;
  callback_expected: boolean | null;
  callback_url: string | null;
  created_at: string;
  ready_at: string | null;
}

function providerMeta(machine: { providerMeta?: Record<string, unknown> | null }) {
  return (machine.providerMeta ?? {}) as Record<string, unknown>;
}

async function resolveImageSummary(imageId: string | null): Promise<ReturnType<typeof serializeImageRow> | null> {
  if (!imageId) return null;
  const [img] = await db.select().from(images).where(eq(images.id, imageId));
  return img ? serializeImageRow(img) : null;
}

async function readSshAccess(machine: {
  id: string;
  slug: string;
  publicIpv4?: string | null;
  sshPort?: number | null;
  providerMeta?: Record<string, unknown> | null;
}) {
  const meta = providerMeta(machine);
  const portAllocations = await getMachinePortAllocations(machine.id).catch(() => ({ ssh: null, http: null, rows: [] }));
  const sshPort = machine.sshPort ?? portAllocations.ssh?.publicPort ?? (typeof meta.ssh_port === 'number'
    ? meta.ssh_port
    : typeof meta.ssh_port === 'string' && meta.ssh_port.trim()
      ? Number(meta.ssh_port)
      : null);
  const hostIp = machine.publicIpv4 ?? (typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null);
  const originHost = `origin-${machine.slug}.${config.PROXY_DOMAIN}`;
  return {
    sshHost: hostIp,
    sshOriginHost: hostIp ? originHost : null,
    sshHostFallbackIp: hostIp,
    privateIpv4: typeof meta.private_ipv4 === 'string' ? meta.private_ipv4 : null,
    sshPort,
  };
}

function decryptSshPrivateKey(machine: { sshPrivateKey?: string | null }): string | null {
  if (!machine.sshPrivateKey) return null;
  if (machine.sshPrivateKey.startsWith('-----BEGIN')) return machine.sshPrivateKey;
  try {
    return decryptSecret(machine.sshPrivateKey);
  } catch {
    return null;
  }
}

export async function serializeMachineV2(
  machine: {
    id: string;
    slug: string;
    name: string;
    status: string;
    provisioningStage?: string | null;
    provisioningStageUpdatedAt?: Date | null;
    provider: string;
    machineMode: string;
    requestedImageKind?: 'golden' | 'catalog' | 'docker' | null;
    requestedImageRef?: string | null;
    imageId: string | null;
    region: string;
    publicIpv4?: string | null;
    publicIpv6?: string | null;
    sshPort?: number | null;
    httpPort?: number | null;
    readyVia?: 'heartbeat' | 'probe' | null;
    providerProgress?: number | null;
    providerStatus?: string | null;
    callbackExpected?: boolean | null;
    callbackUrl?: string | null;
    vcpu?: number | null;
    ramGb?: number | null;
    diskGb?: number | null;
    providerMeta?: Record<string, unknown> | null;
    sshPrivateKey?: string | null;
    sshPublicKey?: string | null;
    priceMonthly?: number | null;
    lastHeartbeat?: Record<string, unknown> | null;
    lastHeartbeatAt?: Date | null;
    createdAt: Date;
    readyAt?: Date | null;
  },
  sub?: { currentPeriodEnd?: Date | null } | null,
): Promise<SerializedMachineView> {
  const ssh = await readSshAccess(machine);
  const proxyDomain = config.PROXY_DOMAIN;
  const image = await resolveImageSummary(machine.imageId);
  const provider = getProvider(machine.provider);
  const meta = providerMeta(machine);
  const providerProgressRaw = machine.providerProgress ?? (typeof meta.create_progress === 'number' ? meta.create_progress : null);
  const providerProgress = providerProgressRaw != null && providerProgressRaw <= 1
    ? Math.round(providerProgressRaw * 100)
    : providerProgressRaw;
  const providerStatus = machine.providerStatus ?? (typeof meta.create_status === 'string' ? meta.create_status : null);
  const callbackExpected = machine.callbackExpected ?? (typeof meta.callback_expected === 'boolean' ? meta.callback_expected : null);
  const callbackUrl = machine.callbackUrl ?? (typeof meta.callback_url === 'string' ? meta.callback_url : null);
  const sshPort = ssh.sshPort;
  const sshHost = ssh.sshHost;
  const sshKeyPath = `~/.ssh/justavps_${machine.slug}`;
  const sshPrivateKey = decryptSshPrivateKey(machine);

  const sshCommand = sshHost && sshPort
    ? `ssh -i ${sshKeyPath} -p ${sshPort} -o StrictHostKeyChecking=no root@${sshHost}`
    : null;

  const sshSetupCommand = sshPrivateKey && sshHost && sshPort
    ? `mkdir -p ~/.ssh && cat > ${sshKeyPath} << 'JUSTAVPSKEY'\n${sshPrivateKey.trim()}\nJUSTAVPSKEY\nchmod 600 ${sshKeyPath} && ssh -i ${sshKeyPath} -p ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${sshHost}`
    : null;

  const sshConfigBlock = sshHost && sshPort
    ? `Host ${machine.slug}\n  HostName ${sshHost}\n  Port ${sshPort}\n  User root\n  IdentityFile ${sshKeyPath}\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null`
    : null;

  const vcpu = machine.vcpu ?? (typeof meta.vcpu === 'number' ? meta.vcpu : 2);
  const ramGb = machine.ramGb ?? (typeof meta.ram_gb === 'number' ? meta.ram_gb : 4);
  const diskGb = machine.diskGb ?? (typeof meta.disk_gb === 'number' ? meta.disk_gb : 80);

  return {
    id: machine.id,
    slug: machine.slug,
    name: machine.name,
    status: machine.status as SerializedMachineStatus,
    provisioning_stage: machine.provisioningStage ?? null,
    provisioning_stage_updated_at: machine.provisioningStageUpdatedAt?.toISOString() ?? null,
    api_version: 'v2',
    machine_mode: machine.machineMode as SerializedMachineMode,
    requested_image_kind: machine.requestedImageKind ?? (typeof meta.requested_image_kind === 'string'
      ? meta.requested_image_kind as SerializedMachineView['requested_image_kind']
      : null),
    requested_image_ref: machine.requestedImageRef ?? (typeof meta.requested_image_ref === 'string' ? meta.requested_image_ref : null),
    region: machine.region,
    resources: { vcpu, ram_gb: ramGb, disk_gb: diskGb },
    billing: {
      mode: 'flat_monthly',
      price_monthly: machine.priceMonthly ?? null,
      current_period_end: sub?.currentPeriodEnd?.toISOString() ?? null,
    },
    image,
    connectivity: {
      ssh_host: sshHost,
      ssh_port: sshPort,
      ssh_command: sshCommand,
      ssh_setup_command: sshSetupCommand,
      ssh_config_block: sshConfigBlock,
      ssh_private_key: sshPrivateKey,
      ssh_public_key: machine.sshPublicKey || null,
      urls: {
        proxy: `https://${machine.slug}.${proxyDomain}`,
        terminal: `https://${machine.slug}.${proxyDomain}/_terminal`,
        port_template: `https://{port}--${machine.slug}.${proxyDomain}`,
      },
    },
    capabilities: {
      can_start: machine.status === 'stopped',
      can_stop: machine.status === 'ready',
      can_reboot: machine.status === 'ready',
      can_resize: false,
      can_snapshot: provider.capabilities.backups || provider.capabilities.images,
      can_create_image: provider.capabilities.images,
    },
    health: machine.lastHeartbeat
      ? {
          cpu: Number((machine.lastHeartbeat as Record<string, unknown>).cpu ?? 0),
          memory: Number((machine.lastHeartbeat as Record<string, unknown>).memory ?? 0),
          disk: Number((machine.lastHeartbeat as Record<string, unknown>).disk ?? 0),
          services: ((machine.lastHeartbeat as Record<string, unknown>).services as Record<string, boolean> | undefined) ?? {},
          last_heartbeat_at: machine.lastHeartbeatAt?.toISOString() ?? null,
        }
      : null,
    provider_progress: providerProgress,
    provider_status: providerStatus,
    ready_via: machine.readyVia ?? (typeof meta.ready_via === 'string' ? meta.ready_via as 'heartbeat' | 'probe' : null),
    callback_expected: callbackExpected,
    callback_url: callbackUrl,
    created_at: machine.createdAt.toISOString(),
    ready_at: machine.readyAt?.toISOString() ?? null,
  };
}
