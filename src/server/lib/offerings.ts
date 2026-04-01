import { plansForRegion } from '@/lib/plan-catalog';

export interface PublicRegion {
  id: string;
  name: string;
  country: string;
  city: string;
}

export interface PublicPlanOffering {
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
  { id: 'fsn1', name: 'Falkenstein', country: 'DE', city: 'Falkenstein' },
  { id: 'nbg1', name: 'Nuremberg', country: 'DE', city: 'Nuremberg' },
  { id: 'hel1', name: 'Helsinki', country: 'FI', city: 'Helsinki' },
];

export function listPublicRegions(): PublicRegion[] {
  return PUBLIC_REGIONS;
}

export function listPlanOfferings(region: string): PublicPlanOffering[] {
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
