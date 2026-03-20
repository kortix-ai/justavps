import { describe, expect, it } from 'vitest';
import { config } from '@/server/lib/config';
import { resolvePlatformCallbackUrl } from '@/server/lib/machine-lifecycle';

describe('resolvePlatformCallbackUrl', () => {
  it('uses the request origin for deployed hosts', () => {
    expect(resolvePlatformCallbackUrl('https://dev.justavps.com/api/v1/machines')).toBe('https://dev.justavps.com');
  });

  it('falls back to configured platform URL for localhost requests', () => {
    expect(resolvePlatformCallbackUrl('http://localhost:4100/api/v1/machines')).toBe(config.PLATFORM_URL);
  });

  it('falls back to configured platform URL for invalid request URLs', () => {
    expect(resolvePlatformCallbackUrl('not-a-url')).toBe(config.PLATFORM_URL);
  });
});
