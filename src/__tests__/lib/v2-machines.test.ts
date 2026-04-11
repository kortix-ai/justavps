import { describe, expect, it } from 'vitest';

import { buildBaremetalCellSlug, deriveBaremetalCellIdentity } from '@/server/lib/baremetal/cells';
import { defaultPlacementImageAlias, normalizeResolvedImageForProvider } from '@/server/lib/v2/machines';

describe('normalizeResolvedImageForProvider', () => {
  it('maps default ubuntu image to an Incus image alias for baremetal', () => {
    expect(normalizeResolvedImageForProvider('baremetal', 'ubuntu-24.04')).toBe('images:ubuntu/noble/cloud');
  });

  it('leaves explicit Incus image aliases untouched', () => {
    expect(normalizeResolvedImageForProvider('baremetal', 'images:ubuntu/noble/cloud')).toBe('images:ubuntu/noble/cloud');
  });

  it('keeps cloud provider image names unchanged', () => {
    expect(normalizeResolvedImageForProvider('cloud', 'ubuntu-24.04')).toBe('ubuntu-24.04');
  });

  it('maps legacy Hetzner snapshot identifiers to the baremetal base image', () => {
    expect(normalizeResolvedImageForProvider('baremetal', '370623330')).toBe('images:ubuntu/noble/cloud');
  });
});

describe('defaultPlacementImageAlias', () => {
  it('defaults scheduler locality hints to the golden image when no custom image is requested', () => {
    expect(defaultPlacementImageAlias()).toBe('justavps-golden');
    expect(defaultPlacementImageAlias(null)).toBe('justavps-golden');
  });

  it('does not force a locality alias when a custom image id is requested', () => {
    expect(defaultPlacementImageAlias('image-123')).toBeNull();
  });
});

describe('baremetal cell helpers', () => {
  it('derives the baseline cell identity from region, host class, and generation', () => {
    const cell = deriveBaremetalCellIdentity({
      region: 'hel1',
      hostClass: 'general-small',
      generation: 'gen2',
      cellId: 'cell-123',
    });

    expect(cell).toEqual({
      id: 'cell-123',
      slug: 'hel1--general-small--gen2',
      name: 'HEL1 general-small gen2',
      region: 'hel1',
      hostClass: 'general-small',
      generation: 'gen2',
      status: 'active',
      reservePolicy: {
        warmReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 },
        failureReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 },
        procurementReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 },
      },
      admission: {
        state: 'open',
        sellability: 'sellable',
        reason: null,
        source: null,
        setAt: null,
      },
    });
    expect(buildBaremetalCellSlug({ region: 'hel1', hostClass: 'general-small', generation: 'gen2' })).toBe('hel1--general-small--gen2');
  });
});
