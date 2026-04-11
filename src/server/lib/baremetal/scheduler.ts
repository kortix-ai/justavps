import { marketForRegion, resolvePlanForDisplay } from '@/lib/plan-catalog';

import { buildBaremetalCellCapacitySnapshots, buildBaremetalCellState, projectBaremetalCellUtilization } from './cells';
import type { ReservationUsageSummary } from './reservations';
import { hostHasAvailableCapacity, hostProjectedUtilizationScore, projectHostUsage } from './reservations';
import { hostAcceptsPlacement, hostPlacementBlockReason } from './host-maintenance';
import type {
  BaremetalHostCandidate,
  BaremetalPlacementCandidateEvaluation,
  BaremetalPlacementDecision,
  BaremetalPlacementPolicy,
  BaremetalPlacementRequest,
  BaremetalPlacementResources,
  BaremetalPlacementResult,
  BaremetalPlanDefinition,
  BaremetalSchedulerHostMetadata,
} from './types';

type SchedulerHostCandidate = BaremetalHostCandidate & { reservations?: ReservationUsageSummary };

const DEFAULT_POLICY: Required<Pick<BaremetalPlacementPolicy, 'warmPoolPreference' | 'requireLocalImage'>> & {
  requiredHostClass: string | null;
  requiredCellId: string | null;
  preferredHostClasses: string[];
  preferredCellIds: string[];
  cellSpreadPreference: 'spread' | 'pack' | 'neutral';
  maxProjectedUtilizationScore: number | null;
  allowRestrictedCellAdmission: boolean;
  allowReserveOnlySellability: boolean;
} = {
  requiredHostClass: null,
  requiredCellId: null,
  preferredHostClasses: [],
  preferredCellIds: [],
  warmPoolPreference: 'prefer',
  requireLocalImage: false,
  cellSpreadPreference: 'spread',
  maxProjectedUtilizationScore: null,
  allowRestrictedCellAdmission: false,
  allowReserveOnlySellability: false,
};

function toPlanDefinition(region: string, serverType: string): BaremetalPlanDefinition | null {
  const market = marketForRegion(region) ?? undefined;
  const plan = resolvePlanForDisplay(serverType, market);
  if (!plan) return null;

  return {
    id: plan.id,
    vcpu: plan.vcpu,
    memory: plan.memory,
    disk: plan.disk,
    priceMonthly: plan.priceMonthly,
    providerCostMonthly: plan.providerCostMonthly,
  };
}

function emptyReservations(): ReservationUsageSummary {
  return {
    reserved: { vcpu: 0, memoryGb: 0, diskGb: 0 },
    committed: { vcpu: 0, memoryGb: 0, diskGb: 0 },
  };
}

function hostToReservationHost(host: BaremetalHostCandidate) {
  return {
    ...host,
    usedVcpu: host.capacity.usedVcpu,
    usedMemoryGb: host.capacity.usedMemoryGb,
    usedDiskGb: host.capacity.usedDiskGb,
    totalVcpu: host.capacity.totalVcpu,
    totalMemoryGb: host.capacity.totalMemoryGb,
    totalDiskGb: host.capacity.totalDiskGb,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : null;
}

function asNumberArray(value: unknown): number[] | null {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : null;
}

function asImageLocalityState(value: unknown): 'local' | 'remote' | 'warming' | 'unknown' | null {
  return value === 'local' || value === 'remote' || value === 'warming' || value === 'unknown' ? value : null;
}

function normalizeSchedulerMetadata(host: BaremetalHostCandidate): BaremetalSchedulerHostMetadata {
  const metadata = asRecord(host.metadata);
  const scheduler = asRecord(metadata?.scheduler) ?? metadata;

  if (!scheduler) return {};

  const warmPool = asRecord(scheduler.warmPool) ?? asRecord(scheduler.warm_pool);
  const imageLocality = asRecord(scheduler.imageLocality) ?? asRecord(scheduler.image_locality);
  const hostClassPolicy = asRecord(scheduler.hostClassPolicy) ?? asRecord(scheduler.host_class_policy);

  return {
    schedulable: typeof scheduler.schedulable === 'boolean'
      ? scheduler.schedulable
      : typeof scheduler.unschedulable === 'boolean'
        ? !scheduler.unschedulable
        : null,
    unschedulableReason: typeof scheduler.unschedulableReason === 'string'
      ? scheduler.unschedulableReason
      : typeof scheduler.unschedulable_reason === 'string'
        ? scheduler.unschedulable_reason
        : null,
    warmPool: warmPool ? {
      enabled: typeof warmPool.enabled === 'boolean' ? warmPool.enabled : null,
      availableCpuBuckets: asNumberArray(warmPool.availableCpuBuckets) ?? asNumberArray(warmPool.available_cpu_buckets),
      exactResourceKeys: asStringArray(warmPool.exactResourceKeys) ?? asStringArray(warmPool.exact_resource_keys),
      ready: typeof warmPool.ready === 'number' ? warmPool.ready : null,
      target: typeof warmPool.target === 'number' ? warmPool.target : null,
    } : null,
    imageLocality: imageLocality ? {
      state: asImageLocalityState(imageLocality.state),
      imageIds: asStringArray(imageLocality.imageIds) ?? asStringArray(imageLocality.image_ids),
      aliases: asStringArray(imageLocality.aliases),
    } : null,
    hostClassPolicy: hostClassPolicy ? {
      scoreAdjustment: typeof hostClassPolicy.scoreAdjustment === 'number'
        ? hostClassPolicy.scoreAdjustment
        : typeof hostClassPolicy.score_adjustment === 'number'
          ? hostClassPolicy.score_adjustment
          : null,
      labels: asStringArray(hostClassPolicy.labels),
    } : null,
  };
}

function resourceKey(resources: BaremetalPlacementResources) {
  return `${resources.vcpu}:${resources.memoryGb}:${resources.diskGb}`;
}

function warmPoolMatch(metadata: BaremetalSchedulerHostMetadata, resources: BaremetalPlacementResources) {
  const warmPool = metadata.warmPool;
  if (!warmPool) return 'unknown' as const;
  if (warmPool.enabled === false) return 'none' as const;
  if (warmPool.exactResourceKeys?.includes(resourceKey(resources))) return 'exact' as const;
  if (warmPool.availableCpuBuckets?.includes(resources.vcpu)) return 'cpu_bucket' as const;
  if ((warmPool.ready ?? 0) > 0) return 'cpu_bucket' as const;
  return 'none' as const;
}

function imageLocalityMatch(metadata: BaremetalSchedulerHostMetadata, request: BaremetalPlacementRequest) {
  const locality = metadata.imageLocality;
  if (!locality) return 'unknown' as const;
  if (request.imageId && locality.imageIds?.includes(request.imageId)) return 'local' as const;
  if (request.imageAlias && locality.aliases?.includes(request.imageAlias)) return 'local' as const;
  if (locality.state === 'warming') return 'warming' as const;
  if (locality.state === 'remote') return 'remote' as const;
  if (locality.state === 'local') return 'local' as const;
  return 'unknown' as const;
}

function normalizePolicy(policy?: BaremetalPlacementPolicy): BaremetalPlacementDecision['policy'] {
  return {
    ...DEFAULT_POLICY,
    requiredHostClass: policy?.requiredHostClass ?? DEFAULT_POLICY.requiredHostClass,
    requiredCellId: policy?.requiredCellId ?? DEFAULT_POLICY.requiredCellId,
    preferredHostClasses: policy?.preferredHostClasses ?? DEFAULT_POLICY.preferredHostClasses,
    preferredCellIds: policy?.preferredCellIds ?? DEFAULT_POLICY.preferredCellIds,
    warmPoolPreference: policy?.warmPoolPreference ?? DEFAULT_POLICY.warmPoolPreference,
    requireLocalImage: policy?.requireLocalImage ?? DEFAULT_POLICY.requireLocalImage,
    cellSpreadPreference: policy?.cellSpreadPreference ?? DEFAULT_POLICY.cellSpreadPreference,
    maxProjectedUtilizationScore: policy?.maxProjectedUtilizationScore ?? DEFAULT_POLICY.maxProjectedUtilizationScore,
    allowRestrictedCellAdmission: policy?.allowRestrictedCellAdmission ?? DEFAULT_POLICY.allowRestrictedCellAdmission,
    allowReserveOnlySellability: policy?.allowReserveOnlySellability ?? DEFAULT_POLICY.allowReserveOnlySellability,
  };
}

function candidateExplanation(args: {
  host: SchedulerHostCandidate;
  request: BaremetalPlacementRequest;
  policy: BaremetalPlacementDecision['policy'];
  reservations: ReservationUsageSummary;
  cellSnapshots: ReturnType<typeof buildBaremetalCellCapacitySnapshots>;
}): BaremetalPlacementCandidateEvaluation {
  const { host, request, policy, reservations, cellSnapshots } = args;
  const reasons: string[] = [];
  const metadata = normalizeSchedulerMetadata(host);
  const hostCell = host.cell;
  const cell = host.cell ?? buildBaremetalCellState({
    region: host.region,
    hostClass: host.hostClass,
    generation: host.generation,
    cellId: host.cellId,
    metadata: host.metadata,
    cell: hostCell ? {
      id: hostCell.id ?? undefined,
      slug: hostCell.slug,
      name: hostCell.name,
      region: hostCell.region,
      hostClass: hostCell.hostClass,
      generation: hostCell.generation,
    } : null,
  });
  const cellSnapshot = cell ? cellSnapshots.find((snapshot) => snapshot.cell.slug === cell.slug) ?? null : null;
  const cellProjectedUtilization = projectBaremetalCellUtilization(cellSnapshot, request.resources);
  const requestedHost = request.requestedHostId === host.id;
  const locality = imageLocalityMatch(metadata, request);
  const warmPool = warmPoolMatch(metadata, request.resources);
  const disqualifiers = {
    region: false,
    requestedHost: false,
    lifecycle: false,
    schedulable: false,
    hostClass: false,
    cell: false,
    capacity: false,
    locality: false,
    utilization: false,
    admission: false,
    reserve: false,
  };

  if (host.region !== request.region) {
    disqualifiers.region = true;
    reasons.push(`host region ${host.region} does not match requested region ${request.region}`);
  }
  if (request.requestedHostId && !requestedHost) {
    disqualifiers.requestedHost = true;
    reasons.push(`host does not match requested host ${request.requestedHostId}`);
  }

  const placementBlockReason = hostPlacementBlockReason(host);
  if (placementBlockReason) {
    disqualifiers.lifecycle = true;
    reasons.push(placementBlockReason);
  }

  if (metadata.schedulable === false) {
    disqualifiers.schedulable = true;
    reasons.push(metadata.unschedulableReason ?? 'host marked unschedulable by scheduler metadata');
  }

  if (policy.requiredHostClass && host.hostClass !== policy.requiredHostClass) {
    disqualifiers.hostClass = true;
    reasons.push(`host class ${host.hostClass ?? 'unknown'} does not match required class ${policy.requiredHostClass}`);
  }

  if (policy.requiredCellId && cell?.id !== policy.requiredCellId) {
    disqualifiers.cell = true;
    reasons.push(`host cell ${cell?.id ?? 'unassigned'} does not match required cell ${policy.requiredCellId}`);
  }

  if (!hostHasAvailableCapacity(hostToReservationHost(host), reservations, request.resources)) {
    disqualifiers.capacity = true;
    reasons.push(`insufficient capacity for ${request.resources.vcpu} vCPU / ${request.resources.memoryGb} GB RAM / ${request.resources.diskGb} GB disk`);
  }

  if (policy.requireLocalImage && request.imageId && locality !== 'local') {
    disqualifiers.locality = true;
    reasons.push(`image ${request.imageId} is not local on host`);
  }

  const projectedUsage = {
    ...projectHostUsage(hostToReservationHost(host), reservations),
  };
  projectedUsage.vcpu += request.resources.vcpu;
  projectedUsage.memoryGb += request.resources.memoryGb;
  projectedUsage.diskGb += request.resources.diskGb;

  const projectedScore = hostProjectedUtilizationScore(hostToReservationHost(host), reservations, request.resources);
  if (policy.maxProjectedUtilizationScore != null && projectedScore > policy.maxProjectedUtilizationScore) {
    disqualifiers.utilization = true;
    reasons.push(`projected utilization score ${projectedScore.toFixed(3)} exceeds policy max ${policy.maxProjectedUtilizationScore.toFixed(3)}`);
  }

  if (cellSnapshot) {
    const admission = cellSnapshot.cell.admission;
    if (admission.state === 'closed') {
      disqualifiers.admission = true;
      reasons.push(`cell ${cellSnapshot.cell.slug} admission is closed${admission.reason ? `: ${admission.reason}` : ''}`);
    } else if (admission.state === 'restricted' && !policy.allowRestrictedCellAdmission) {
      disqualifiers.admission = true;
      reasons.push(`cell ${cellSnapshot.cell.slug} admission is restricted${admission.reason ? `: ${admission.reason}` : ''}`);
    }

    if (admission.sellability === 'unsellable') {
      disqualifiers.admission = true;
      reasons.push(`cell ${cellSnapshot.cell.slug} is marked unsellable${admission.reason ? `: ${admission.reason}` : ''}`);
    } else if (admission.sellability === 'reserve_only' && !policy.allowReserveOnlySellability) {
      disqualifiers.admission = true;
      reasons.push(`cell ${cellSnapshot.cell.slug} is reserve-only and not sellable for general placement`);
    }
  }

  if (cellProjectedUtilization && !cellProjectedUtilization.reserveSatisfied) {
    disqualifiers.reserve = true;
    reasons.push(`cell reserve budget would be breached; projected sellable capacity becomes ${cellProjectedUtilization.projectedSellable.vcpu} vCPU / ${cellProjectedUtilization.projectedSellable.memoryGb} GB RAM / ${cellProjectedUtilization.projectedSellable.diskGb} GB disk`);
  }

  let score = projectedScore;
  if (warmPool === 'exact') score -= policy.warmPoolPreference === 'avoid' ? -0.04 : 0.06;
  if (warmPool === 'cpu_bucket') score -= policy.warmPoolPreference === 'avoid' ? -0.02 : 0.03;
  if (warmPool === 'exact' || warmPool === 'cpu_bucket') {
    reasons.push(warmPool === 'exact' ? 'warm pool exact resource match available' : 'warm pool CPU bucket available');
  }
  if (locality === 'local') {
    score -= 0.03;
    reasons.push('image already local on host');
  }
  if (locality === 'warming') {
    score += 0.01;
    reasons.push('image is warming on host');
  }
  if (locality === 'remote') {
    score += 0.03;
    reasons.push('image would need remote fetch');
  }
  if (cellProjectedUtilization) {
    const projectedSellablePressure = Math.max(
      1 - (cellProjectedUtilization.projectedSellable.vcpu / Math.max(request.resources.vcpu, 1)),
      1 - (cellProjectedUtilization.projectedSellable.memoryGb / Math.max(request.resources.memoryGb, 1)),
      1 - (cellProjectedUtilization.projectedSellable.diskGb / Math.max(request.resources.diskGb, 1)),
      0,
    );
    if (policy.cellSpreadPreference === 'spread') {
      score += cellProjectedUtilization.score * 0.15;
      reasons.push(`cell projected utilization score ${cellProjectedUtilization.score.toFixed(4)} considered for spread policy`);
    }
    if (policy.cellSpreadPreference === 'pack') {
      score -= cellProjectedUtilization.score * 0.1;
      reasons.push(`cell projected utilization score ${cellProjectedUtilization.score.toFixed(4)} considered for pack policy`);
    }
    if (projectedSellablePressure > 0) {
      score += Math.min(projectedSellablePressure, 1) * 0.05;
      reasons.push(`cell sellable headroom penalty applied from reserve-aware pressure (${projectedSellablePressure.toFixed(3)})`);
    }
  }
  if (policy.preferredHostClasses.includes(host.hostClass ?? '')) {
    score -= 0.02;
    reasons.push(`preferred host class match (${host.hostClass})`);
  }
  if (cell?.id && policy.preferredCellIds.includes(cell.id)) {
    score -= 0.02;
    reasons.push(`preferred cell match (${cell.slug})`);
  }
  score += metadata.hostClassPolicy?.scoreAdjustment ?? 0;

  const eligible = !Object.values(disqualifiers).some(Boolean);

  return {
    hostId: host.id,
    eligible,
    score: eligible ? Number(score.toFixed(4)) : null,
    reasons,
    cell,
    projectedUsage,
    cellProjectedUtilization,
    projectedUtilization: {
      vcpuPercent: Number(((projectedUsage.vcpu / Math.max(host.capacity.totalVcpu, 1)) * 100).toFixed(1)),
      memoryPercent: Number(((projectedUsage.memoryGb / Math.max(host.capacity.totalMemoryGb, 1)) * 100).toFixed(1)),
      diskPercent: Number(((projectedUsage.diskGb / Math.max(host.capacity.totalDiskGb, 1)) * 100).toFixed(1)),
      score: Number(projectedScore.toFixed(4)),
    },
    schedulingHints: {
      requestedHost,
      warmPool,
      imageLocality: locality,
      hostClass: host.hostClass ?? null,
      generation: cell?.generation ?? host.generation ?? null,
      cellId: cell?.id ?? host.cellId ?? null,
      cellSlug: cell?.slug ?? null,
      maintenanceState: host.maintenanceState ?? null,
      schedulable: metadata.schedulable !== false && hostAcceptsPlacement(host),
      admissionState: cellSnapshot?.cell.admission.state ?? 'open',
      sellabilityState: cellSnapshot?.cell.admission.sellability ?? 'sellable',
    },
  };
}

function summarizeDecision(request: BaremetalPlacementRequest, candidates: BaremetalPlacementCandidateEvaluation[], selected: BaremetalPlacementCandidateEvaluation | null) {
  if (!selected) {
    return `No schedulable host could place ${request.resources.vcpu} vCPU / ${request.resources.memoryGb} GB RAM / ${request.resources.diskGb} GB disk in ${request.region}`;
  }
  const eligibleCount = candidates.filter((candidate) => candidate.eligible).length;
  return `Selected host ${selected.hostId} for ${request.region}; ${eligibleCount} eligible host${eligibleCount === 1 ? '' : 's'} considered`;
}

export function scheduleBaremetalPlacement(input: {
  request: BaremetalPlacementRequest;
  hosts: SchedulerHostCandidate[];
}): BaremetalPlacementDecision {
  const policy = normalizePolicy(input.request.policy);
  const cellSnapshots = buildBaremetalCellCapacitySnapshots(input.hosts);
  const candidates = input.hosts
    .map((host) => candidateExplanation({
      host,
      request: input.request,
      policy,
      reservations: host.reservations ?? emptyReservations(),
      cellSnapshots,
    }))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (a.score != null && b.score != null && a.score !== b.score) return a.score - b.score;
      return a.hostId.localeCompare(b.hostId);
    });

  const selected = candidates.find((candidate) => candidate.eligible) ?? null;
  const explanation = selected
    ? [
        `${selected.hostId} had the best projected score (${selected.score?.toFixed(4) ?? 'n/a'}) after policy adjustments.`,
        ...selected.reasons,
      ]
    : candidates.flatMap((candidate) => candidate.reasons.map((reason) => `${candidate.hostId}: ${reason}`)).slice(0, 8);

  return {
    outcome: selected ? 'placed' : 'rejected',
    selectedHostId: selected?.hostId ?? null,
    summary: summarizeDecision(input.request, candidates, selected),
    explanation,
    request: input.request,
    policy,
    cells: cellSnapshots,
    candidates,
  };
}

export function pickBaremetalHostForResources(input: {
  region: string;
  resources: BaremetalPlacementResources;
  requestedHostId?: string;
  imageId?: string | null;
  imageAlias?: string | null;
  policy?: BaremetalPlacementPolicy;
  hosts: SchedulerHostCandidate[];
}) {
  const decision = scheduleBaremetalPlacement({
    request: {
      region: input.region,
      resources: input.resources,
      requestedHostId: input.requestedHostId,
      imageId: input.imageId,
      imageAlias: input.imageAlias,
      policy: input.policy,
    },
    hosts: input.hosts,
  });

  if (!decision.selectedHostId) return null;
  return input.hosts.find((host) => host.id === decision.selectedHostId) ?? null;
}

export function pickBaremetalHostForPlan(input: {
  region: string;
  serverType: string;
  requestedHostId?: string;
  imageId?: string | null;
  imageAlias?: string | null;
  policy?: BaremetalPlacementPolicy;
  hosts: SchedulerHostCandidate[];
}): BaremetalPlacementResult | null {
  const plan = toPlanDefinition(input.region, input.serverType);
  if (!plan) return null;

  const decision = scheduleBaremetalPlacement({
    request: {
      region: input.region,
      resources: { vcpu: plan.vcpu, memoryGb: plan.memory, diskGb: plan.disk },
      requestedHostId: input.requestedHostId,
      imageId: input.imageId,
      imageAlias: input.imageAlias,
      policy: input.policy,
    },
    hosts: input.hosts,
  });

  const host = decision.selectedHostId
    ? input.hosts.find((candidate) => candidate.id === decision.selectedHostId) ?? null
    : null;
  if (!host) return null;
  return { host, plan, decision };
}
