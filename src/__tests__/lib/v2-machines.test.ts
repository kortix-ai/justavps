import { describe, expect, it } from 'vitest';

import { defaultPlacementImageAlias, normalizeResolvedImageForProvider } from "@/server/v2/domains/machine/image-source";

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

  it('does not force a locality alias when a docker image is requested', () => {
    expect(defaultPlacementImageAlias(null, 'docker:nginx:latest')).toBeNull();
  });
});
