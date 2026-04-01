import { marketForRegion, resolvePlanForDisplay } from '@/lib/plan-catalog';
import type {
  BaremetalHostCandidate,
  BaremetalPlacementResult,
  BaremetalPlanDefinition,
} from './types';

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

function hasCapacity(host: BaremetalHostCandidate, plan: BaremetalPlanDefinition): boolean {
  const freeVcpu = host.capacity.totalVcpu - host.capacity.usedVcpu;
  const freeMemory = host.capacity.totalMemoryGb - host.capacity.usedMemoryGb;
  const freeDisk = host.capacity.totalDiskGb - host.capacity.usedDiskGb;
  return freeVcpu >= plan.vcpu && freeMemory >= plan.memory && freeDisk >= plan.disk;
}

function utilizationScore(host: BaremetalHostCandidate, plan: BaremetalPlanDefinition): number {
  const cpu = (host.capacity.usedVcpu + plan.vcpu) / Math.max(host.capacity.totalVcpu, 1);
  const mem = (host.capacity.usedMemoryGb + plan.memory) / Math.max(host.capacity.totalMemoryGb, 1);
  const disk = (host.capacity.usedDiskGb + plan.disk) / Math.max(host.capacity.totalDiskGb, 1);
  return cpu * 0.45 + mem * 0.4 + disk * 0.15;
}

export function pickBaremetalHostForPlan(input: {
  region: string;
  serverType: string;
  hosts: BaremetalHostCandidate[];
}): BaremetalPlacementResult | null {
  const plan = toPlanDefinition(input.region, input.serverType);
  if (!plan) return null;

  const eligible = input.hosts
    .filter((host) => host.region === input.region)
    .filter((host) => host.status === 'active')
    .filter((host) => !!host.runnerBaseUrl)
    .filter((host) => hasCapacity(host, plan))
    .sort((a, b) => utilizationScore(a, plan) - utilizationScore(b, plan));

  const host = eligible[0];
  if (!host) return null;
  return { host, plan };
}
