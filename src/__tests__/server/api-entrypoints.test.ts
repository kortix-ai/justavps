import { describe, expect, it } from 'vitest';

describe('canonical API entrypoints', () => {
  it('loads canonical V2 API apps directly', async () => {
    const canonicalMachines = await import("@/server/v2/routes/public/machines");
    const canonicalFleet = await import("@/server/v2/routes/admin/fleet");
    const canonicalStatusStream = await import("@/server/v2/routes/public/machine-status-stream");

    expect(canonicalMachines.machinesV2App).toBeDefined();
    expect(canonicalFleet.adminFleetV2App).toBeDefined();
    expect(canonicalStatusStream.machineStatusV2App).toBeDefined();
  });

  it('re-exports top-level V1/V2 routers through canonical api indexes', async () => {
    const canonicalV1 = await import("@/server/v1/routes/index");
    const canonicalV2 = await import("@/server/v2/routes/index");

    expect(canonicalV1.v1).toBeDefined();
    expect(canonicalV2.v2).toBeDefined();
  });

  it('loads canonical V1 legacy apps directly', async () => {
    const canonicalMachines = await import("@/server/v1/routes/legacy/machines");
    const canonicalApiKeys = await import("@/server/v1/routes/legacy/api-keys");
    const canonicalProxyTokens = await import("@/server/v1/routes/legacy/proxy-tokens");

    expect(canonicalMachines.machinesApp).toBeDefined();
    expect(canonicalApiKeys.apiKeysApp).toBeDefined();
    expect(canonicalProxyTokens.proxyTokensApp).toBeDefined();
  });
});
