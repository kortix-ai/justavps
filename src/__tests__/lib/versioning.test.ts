import { describe, expect, it } from 'vitest';

import { detectUiVersionFromPath, pathForVersion } from '@/lib/versioning';

describe('versioning helpers', () => {
  it('detects v1 for unversioned dashboard paths', () => {
    expect(detectUiVersionFromPath('/machines')).toBe('v1');
    expect(detectUiVersionFromPath('/billing')).toBe('v1');
  });

  it('detects v2 for versioned routes', () => {
    expect(detectUiVersionFromPath('/v2/machines')).toBe('v2');
    expect(detectUiVersionFromPath('/v2/admin/fleet')).toBe('v2');
  });

  it('maps paths between v1 and v2 namespaces cleanly', () => {
    expect(pathForVersion('/machines/abc', 'v2')).toBe('/v2/machines/abc');
    expect(pathForVersion('/v2/machines/abc', 'v1')).toBe('/machines/abc');
    expect(pathForVersion('/admin/fleet', 'v2')).toBe('/v2/admin/fleet');
  });

  it('keeps non-versioned surfaces stable across versions', () => {
    expect(pathForVersion('/keys', 'v2')).toBe('/keys');
    expect(pathForVersion('/docs', 'v2')).toBe('/docs');
    expect(pathForVersion('/api/docs', 'v2')).toBe('/api/docs');
  });
});
