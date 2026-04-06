import { describe, expect, it } from 'vitest';

import { normalizeResolvedImageForProvider } from '@/server/lib/v2/machines';

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
