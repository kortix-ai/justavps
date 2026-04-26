import { describe, expect, it } from 'vitest';

describe('canonical API entrypoints', () => {
  it('re-exports top-level V1 router through canonical api index', async () => {
    const canonicalV1 = await import("@/server/v1/routes/index");

    expect(canonicalV1.v1).toBeDefined();
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
