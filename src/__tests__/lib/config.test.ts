import { afterEach, describe, expect, it, vi } from 'vitest';

const originalLegacyProxyFlag = process.env.LEGACY_PLATFORM_PROXY_ENABLED;

async function loadConfig() {
  vi.resetModules();
  return import('@/server/lib/config');
}

describe('config legacy proxy flag', () => {
  afterEach(() => {
    if (originalLegacyProxyFlag === undefined) {
      delete process.env.LEGACY_PLATFORM_PROXY_ENABLED;
    } else {
      process.env.LEGACY_PLATFORM_PROXY_ENABLED = originalLegacyProxyFlag;
    }
  });

  it('defaults the legacy platform proxy to disabled', async () => {
    delete process.env.LEGACY_PLATFORM_PROXY_ENABLED;

    const { config } = await loadConfig();

    expect(config.LEGACY_PLATFORM_PROXY_ENABLED).toBe(false);
  });

  it('still allows explicitly opting the legacy platform proxy back in', async () => {
    process.env.LEGACY_PLATFORM_PROXY_ENABLED = 'true';

    const { config } = await loadConfig();

    expect(config.LEGACY_PLATFORM_PROXY_ENABLED).toBe(true);
  });
});
