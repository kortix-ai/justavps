import { describe, expect, it } from 'vitest';

describe('canonical API entrypoints', () => {
  it('loads canonical V2 API apps directly', async () => {
    const canonicalMachines = await import('@/server/api/v2/public/machines');
    const canonicalFleet = await import('@/server/api/v2/admin/fleet');
    const canonicalStatusStream = await import('@/server/api/v2/public/machine-status-stream');

    expect(canonicalMachines.machinesV2App).toBeDefined();
    expect(canonicalFleet.adminFleetV2App).toBeDefined();
    expect(canonicalStatusStream.machineStatusV2App).toBeDefined();
  });

  it('re-exports top-level V1/V2 routers through canonical api indexes', async () => {
    const canonicalV1 = await import('@/server/api/v1/legacy');
    const canonicalV2 = await import('@/server/api/v2');

    expect(canonicalV1.v1).toBeDefined();
    expect(canonicalV2.v2).toBeDefined();
  });

  it('loads canonical V1 legacy apps directly', async () => {
    const canonicalMachines = await import('@/server/api/v1/legacy/machines');
    const canonicalApiKeys = await import('@/server/api/v1/legacy/api-keys');
    const canonicalProxyTokens = await import('@/server/api/v1/legacy/proxy-tokens');

    expect(canonicalMachines.machinesApp).toBeDefined();
    expect(canonicalApiKeys.apiKeysApp).toBeDefined();
    expect(canonicalProxyTokens.proxyTokensApp).toBeDefined();
  });
});
