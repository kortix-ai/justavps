import { describe, expect, it } from 'vitest';

import { pathForVersion } from '@/shared/lib/versioning';

describe('version switcher routing', () => {
  it('maps v1 dashboard pages to v2 namespace', () => {
    expect(pathForVersion('/machines', 'v2')).toBe('/v2/machines');
    expect(pathForVersion('/images', 'v2')).toBe('/v2/images');
    expect(pathForVersion('/billing', 'v2')).toBe('/v2/billing');
    expect(pathForVersion('/admin/fleet', 'v2')).toBe('/v2/admin/fleet');
    expect(pathForVersion('/admin/machines', 'v2')).toBe('/v2/admin/machines');
  });

  it('maps v2 pages back to v1 namespace', () => {
    expect(pathForVersion('/v2/machines', 'v1')).toBe('/machines');
    expect(pathForVersion('/v2/images', 'v1')).toBe('/images');
    expect(pathForVersion('/v2/billing', 'v1')).toBe('/billing');
    expect(pathForVersion('/v2/admin/fleet', 'v1')).toBe('/admin/fleet');
    expect(pathForVersion('/v2/admin/machines', 'v1')).toBe('/admin/machines');
  });
});
