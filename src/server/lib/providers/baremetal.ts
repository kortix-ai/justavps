import { resolvePlanForDisplay } from '@/lib/plan-catalog';
import {
  type ComputeProvider,
  type CreateServerOpts,
  type ProviderActionProgress,
  type RegionInfo,
  type SSHKeyResult,
  type ServerResult,
  type ServerTypeInfo,
} from './types';
import { pickBaremetalHostForPlan } from '../baremetal/scheduler';
import { HttpBaremetalRunnerClient } from '../baremetal/runner-client';
import type { BaremetalHostCandidate, BaremetalPlacementResult, BaremetalRunnerClient } from '../baremetal/types';

type HostSelector = (input: { region: string; serverType: string }) => Promise<BaremetalPlacementResult | null>;
type RunnerClientFactory = (host: BaremetalHostCandidate) => BaremetalRunnerClient;

const DEFAULT_REGIONS: RegionInfo[] = [
  { id: 'fsn1', name: 'Falkenstein', country: 'DE', city: 'Falkenstein' },
  { id: 'nbg1', name: 'Nuremberg', country: 'DE', city: 'Nuremberg' },
  { id: 'hel1', name: 'Helsinki', country: 'FI', city: 'Helsinki' },
];

async function defaultSelectHost(input: { region: string; serverType: string }): Promise<BaremetalPlacementResult | null> {
  const { reconcileBaremetalFleet } = await import('../baremetal/reconcile');
  const { db } = await import('../../db');
  const { baremetalHosts } = await import('../../db/schema');
  await reconcileBaremetalFleet();
  const rows = await db.select().from(baremetalHosts);
  const candidates = rows.map((row) => ({
    id: row.id,
    region: row.region,
    status: row.status as BaremetalHostCandidate['status'],
    runnerBaseUrl: row.runnerBaseUrl,
    publicIpv4: row.publicIpv4,
    publicIpv6: row.publicIpv6,
    runnerToken: row.runnerToken ? row.runnerToken : null,
    capacity: {
      totalVcpu: row.totalVcpu ?? 0,
      totalMemoryGb: row.totalMemoryGb ?? 0,
      totalDiskGb: row.totalDiskGb ?? 0,
      usedVcpu: row.usedVcpu ?? 0,
      usedMemoryGb: row.usedMemoryGb ?? 0,
      usedDiskGb: row.usedDiskGb ?? 0,
    },
  }));
  return pickBaremetalHostForPlan({ ...input, hosts: candidates });
}

function defaultRunnerClientFactory(host: BaremetalHostCandidate): BaremetalRunnerClient {
  if (!host.runnerBaseUrl || !host.runnerToken) {
    throw new Error(`baremetal host ${host.id} is missing runner connection metadata`);
  }
  return new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken);
}

async function loadHostById(hostId: string): Promise<BaremetalHostCandidate | null> {
  const { db } = await import('../../db');
  const { baremetalHosts } = await import('../../db/schema');
  const rows = await db.select().from(baremetalHosts);
  const row = rows.find((item) => item.id === hostId);
  if (!row) return null;
  return {
    id: row.id,
    region: row.region,
    status: row.status as BaremetalHostCandidate['status'],
    runnerBaseUrl: row.runnerBaseUrl,
    publicIpv4: row.publicIpv4,
    publicIpv6: row.publicIpv6,
    runnerToken: row.runnerToken,
    capacity: {
      totalVcpu: row.totalVcpu ?? 0,
      totalMemoryGb: row.totalMemoryGb ?? 0,
      totalDiskGb: row.totalDiskGb ?? 0,
      usedVcpu: row.usedVcpu ?? 0,
      usedMemoryGb: row.usedMemoryGb ?? 0,
      usedDiskGb: row.usedDiskGb ?? 0,
    },
  };
}

async function loadMachineHost(serverId: string): Promise<BaremetalHostCandidate | null> {
  const { db } = await import('../../db');
  const { machines } = await import('../../db/schema');
  const rows = await db.select().from(machines);
  const orphanSlug = serverId.startsWith('justavps-') ? serverId.replace(/^justavps-/, '') : null;
  const machine = rows.find((row) => row.provider === 'baremetal' && (row.providerServerId === serverId || (orphanSlug && row.slug === orphanSlug)));
  if (!machine) return null;
  const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
  const hostId = typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null;
  if (!hostId) return null;
  return loadHostById(hostId);
}

export class BaremetalProvider implements ComputeProvider {
  readonly name = 'baremetal' as const;
  readonly displayName = 'JustAVPS Bare Metal';
  readonly capabilities = {
    backups: false,
    images: true,
    bareMetal: true,
  } as const;

  constructor(
    private readonly deps: {
      selectHost?: HostSelector;
      createRunnerClient?: RunnerClientFactory;
    } = {},
  ) {}

  async validateImage(imageId: string): Promise<boolean> {
    return Boolean(imageId);
  }

  async createImage(serverId: string, description: string): Promise<{ imageId: string; diskSize: number; architecture: string }> {
    const host = await loadMachineHost(serverId);
    if (!host) throw new Error(`Bare metal instance ${serverId} is not assigned to an active host`);
    const runner = defaultRunnerClientFactory(host);
    const alias = description.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || `image-${Date.now()}`;
    const result = await runner.publishImage?.(serverId, alias);
    if (!result) throw new Error('Bare metal runner does not support image publication');
    return { imageId: result.imageId, diskSize: 0, architecture: 'x86' };
  }

  async deleteImage(imageId: string): Promise<void> {
    const { db } = await import('../../db');
    const { baremetalHosts } = await import('../../db/schema');
    const rows = await db.select().from(baremetalHosts);
    const activeHosts = rows
      .filter((row) => row.status === 'active' && row.runnerBaseUrl && row.runnerToken)
      .map((row) => ({
        id: row.id,
        region: row.region,
        status: row.status as BaremetalHostCandidate['status'],
        runnerBaseUrl: row.runnerBaseUrl,
        publicIpv4: row.publicIpv4,
        publicIpv6: row.publicIpv6,
        runnerToken: row.runnerToken,
        capacity: {
          totalVcpu: row.totalVcpu ?? 0,
          totalMemoryGb: row.totalMemoryGb ?? 0,
          totalDiskGb: row.totalDiskGb ?? 0,
          usedVcpu: row.usedVcpu ?? 0,
          usedMemoryGb: row.usedMemoryGb ?? 0,
          usedDiskGb: row.usedDiskGb ?? 0,
        },
      }));

    for (const host of activeHosts) {
      const runner = defaultRunnerClientFactory(host);
      try {
        await runner.deleteImage?.(imageId);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (!message.includes('not found') && !message.includes('404')) {
          throw error;
        }
      }
    }
  }

  async createServer(opts: CreateServerOpts): Promise<ServerResult> {
    // V2 path: custom resources passed directly, no plan lookup needed
    const hasCustomResources = opts.vcpu && opts.memoryGb && opts.diskGb;

    let hostCandidate: BaremetalHostCandidate;
    let vcpu: number;
    let memoryGb: number;
    let diskGb: number;

    if (hasCustomResources) {
      vcpu = opts.vcpu!;
      memoryGb = opts.memoryGb!;
      diskGb = opts.diskGb!;

      // Host was pre-selected and validated upstream — just load it
      const { db } = await import('../../db');
      const { baremetalHosts } = await import('../../db/schema');
      const rows = await db.select().from(baremetalHosts);
      const active = rows
        .filter((r) => r.status === 'active' && r.region === opts.region && r.runnerBaseUrl)
        .map((r) => ({
          id: r.id, region: r.region, status: r.status as BaremetalHostCandidate['status'],
          runnerBaseUrl: r.runnerBaseUrl, publicIpv4: r.publicIpv4, publicIpv6: r.publicIpv6, runnerToken: r.runnerToken,
          capacity: { totalVcpu: r.totalVcpu ?? 0, totalMemoryGb: r.totalMemoryGb ?? 0, totalDiskGb: r.totalDiskGb ?? 0, usedVcpu: r.usedVcpu ?? 0, usedMemoryGb: r.usedMemoryGb ?? 0, usedDiskGb: r.usedDiskGb ?? 0 },
        }));
      const eligible = active.filter((h) => {
        const fv = h.capacity.totalVcpu - h.capacity.usedVcpu;
        const fm = h.capacity.totalMemoryGb - h.capacity.usedMemoryGb;
        const fd = h.capacity.totalDiskGb - h.capacity.usedDiskGb;
        return fv >= vcpu && fm >= memoryGb && fd >= diskGb;
      });
      if (!eligible.length) throw new Error(`No host with enough capacity for ${vcpu} vCPU, ${memoryGb} GB RAM, ${diskGb} GB disk`);
      hostCandidate = eligible[0];
    } else {
      // V1 fallback: plan-based placement
      const selectHost = this.deps.selectHost ?? defaultSelectHost;
      const placement = await selectHost({ region: opts.region, serverType: opts.serverType });
      if (!placement) throw new Error(`No active bare metal host has enough capacity for ${opts.serverType} in ${opts.region}`);
      hostCandidate = placement.host;
      vcpu = placement.plan.vcpu;
      memoryGb = placement.plan.memory;
      diskGb = placement.plan.disk;
    }

    const runnerClientFactory = this.deps.createRunnerClient ?? defaultRunnerClientFactory;
    const runner = runnerClientFactory(hostCandidate);
    const slug = opts.labels.slug || opts.name;
    const result = await runner.createInstance({
      instanceName: opts.name,
      machineSlug: slug,
      image: opts.image,
      region: opts.region,
      serverType: opts.serverType,
      cloudInitUserData: opts.userData,
      vcpu,
      memoryGb,
      diskGb,
      labels: opts.labels,
    });

    const publicIpv4 = result.hostIpv4 ?? hostCandidate.publicIpv4 ?? null;
    const publicIpv6 = result.hostIpv6 ?? hostCandidate.publicIpv6 ?? null;
    const publicIp = publicIpv4 ?? publicIpv6;
    if (!publicIp) throw new Error(`Bare metal host ${hostCandidate.id} did not report a reachable public IP`);

    return {
      serverId: result.instanceId,
      publicIp,
      publicIpv4,
      publicIpv6,
      metadata: {
        baremetal_host_id: hostCandidate.id,
        private_ipv4: result.privateIpv4,
        ssh_port: result.sshPort,
        runner_base_url: hostCandidate.runnerBaseUrl,
        ...(result.metadata ?? {}),
      },
    };
  }

  async deleteServer(serverId: string): Promise<void> {
    const host = await loadMachineHost(serverId);
    if (!host) return;
    const runner = defaultRunnerClientFactory(host);
    await runner.deleteInstance(serverId);
  }

  async startServer(serverId: string): Promise<void> {
    const host = await loadMachineHost(serverId);
    if (!host) throw new Error(`Bare metal instance ${serverId} is not assigned to an active host`);
    const runner = defaultRunnerClientFactory(host);
    await runner.startInstance(serverId);
  }

  async stopServer(serverId: string): Promise<void> {
    const host = await loadMachineHost(serverId);
    if (!host) throw new Error(`Bare metal instance ${serverId} is not assigned to an active host`);
    const runner = defaultRunnerClientFactory(host);
    await runner.stopInstance(serverId);
  }

  async rebootServer(serverId: string): Promise<void> {
    const host = await loadMachineHost(serverId);
    if (!host) throw new Error(`Bare metal instance ${serverId} is not assigned to an active host`);
    const runner = defaultRunnerClientFactory(host);
    await runner.rebootInstance(serverId);
  }

  async resizeServer(_serverId: string, _serverType: string, _region?: string): Promise<void> {
    void _serverId;
    void _serverType;
    void _region;
    throw new Error('Bare metal resize is not implemented yet');
  }

  async getServerStatus(_serverId: string): Promise<string> {
    void _serverId;
    return 'running';
  }

  async getActionProgress(_actionId: string): Promise<ProviderActionProgress> {
    void _actionId;
    return { status: 'running', progress: null };
  }

  async uploadSSHKey(_name: string, publicKey: string): Promise<SSHKeyResult> {
    return { keyId: publicKey };
  }

  async deleteSSHKey(_keyId: string): Promise<void> {
    void _keyId;
    return;
  }

  async listServerTypes(region: string): Promise<ServerTypeInfo[]> {
    return ['starter', 'basic', 'pro', 'power', 'ultra']
      .map((planId) => resolvePlanForDisplay(planId, undefined))
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan))
      .map((plan) => ({
        name: plan.id,
        description: `${plan.label} — ${plan.tagline}`,
        cores: plan.vcpu,
        memory: plan.memory,
        disk: plan.disk,
        cpuType: 'shared' as const,
        architecture: 'x86' as const,
        providerPriceMonthly: plan.providerCostMonthly,
        priceMonthly: plan.priceMonthly,
        backupPriceMonthly: 0,
        region,
      }));
  }

  async listRegions(): Promise<RegionInfo[]> {
    return DEFAULT_REGIONS;
  }
}
