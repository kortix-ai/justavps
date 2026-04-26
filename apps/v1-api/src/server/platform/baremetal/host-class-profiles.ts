type BaremetalHostClassRole = 'starter_edge' | 'mainstream' | 'specialized';

interface BaremetalHostClassProfile {
  hostClass: string;
  role: BaremetalHostClassRole;
  label: string;
  capacityStrategy: 'bootstrap' | 'mainstream' | 'specialized';
  preferredGrowthHostClass: string;
  defaultGeneration: string;
  notes: string[];
}

const BAREMETAL_HOST_CLASS_PROFILES: Record<string, BaremetalHostClassProfile> = {
  'general-small': {
    hostClass: 'general-small',
    role: 'starter_edge',
    label: 'General Small',
    capacityStrategy: 'bootstrap',
    preferredGrowthHostClass: 'general-medium',
    defaultGeneration: 'gen1',
    notes: [
      'Good for bootstrap regions, edge capacity, and starter-tier warm pools.',
      'Not the preferred long-term mainstream production class for 10k-100k scale.',
    ],
  },
  'general-medium': {
    hostClass: 'general-medium',
    role: 'mainstream',
    label: 'General Medium',
    capacityStrategy: 'mainstream',
    preferredGrowthHostClass: 'general-medium',
    defaultGeneration: 'gen2',
    notes: [
      'Preferred mainstream production class for denser shared capacity.',
      'Use this as the default target for new mainstream growth clusters.',
    ],
  },
  'memory-heavy': {
    hostClass: 'memory-heavy',
    role: 'specialized',
    label: 'Memory Heavy',
    capacityStrategy: 'specialized',
    preferredGrowthHostClass: 'memory-heavy',
    defaultGeneration: 'gen2',
    notes: [
      'Reserved for memory-dense workloads and specialized customer demand.',
    ],
  },
  gpu: {
    hostClass: 'gpu',
    role: 'specialized',
    label: 'GPU',
    capacityStrategy: 'specialized',
    preferredGrowthHostClass: 'gpu',
    defaultGeneration: 'gen2',
    notes: [
      'Reserved for accelerator-backed workloads and premium specialized clusters.',
    ],
  },
};

export function getBaremetalHostClassProfile(hostClass: string | null | undefined): BaremetalHostClassProfile {
  if (hostClass && BAREMETAL_HOST_CLASS_PROFILES[hostClass]) {
    return BAREMETAL_HOST_CLASS_PROFILES[hostClass];
  }

  return {
    hostClass: hostClass ?? 'unknown',
    role: 'specialized',
    label: hostClass ?? 'Unknown',
    capacityStrategy: 'specialized',
    preferredGrowthHostClass: hostClass ?? 'unknown',
    defaultGeneration: 'gen1',
    notes: ['Unclassified host class — review before using as a mainstream production tier.'],
  };
}
