import { plansForRegion } from '@/shared/lib/plan-catalog';

interface PublicRegion {
  id: string;
  name: string;
  country: string;
  city: string;
}

interface PublicPlanOffering {
  plan: string;
  label: string;
  tagline: string;
  vcpu: number;
  ramGb: number;
  diskGb: number;
  traffic: string;
  priceMonthly: number;
  features: {
    persistence: 'persistent';
    runtime: 'agent-computer';
    snapshots: boolean;
    backups: boolean;
  };
}

const PUBLIC_REGIONS: PublicRegion[] = [
  { id: 'eu', name: 'Europe', country: 'EU', city: 'Europe' },
  { id: 'us', name: 'United States', country: 'US', city: 'United States' },
];

export function listPublicRegions(): PublicRegion[] {
  return PUBLIC_REGIONS;
}

function listPlanOfferings(region: string): PublicPlanOffering[] {
  return plansForRegion(region).map((plan) => ({
    plan: plan.id,
    label: plan.label,
    tagline: plan.tagline,
    vcpu: plan.vcpu,
    ramGb: plan.memory,
    diskGb: plan.disk,
    traffic: plan.traffic,
    priceMonthly: plan.priceMonthly,
    features: {
      persistence: 'persistent',
      runtime: 'agent-computer',
      snapshots: true,
      backups: true,
    },
  }));
}
