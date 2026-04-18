import { describe, expect, it } from 'vitest';

/**
 * Feature flag: FEATURE_V2_ENABLED gates the entire v2 API surface +
 * dashboard pages. Prod runs v1-only by default; v2 is enabled in dev.
 *
 * This test locks in the config default so nobody accidentally flips it on
 * in production. The actual mount-point gate lives in src/server/app.ts
 * and src/middleware.ts.
 */

describe('FEATURE_V2_ENABLED default', () => {
  it('defaults to false when NODE_ENV=production', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.FEATURE_V2_ENABLED;
    delete process.env.FEATURE_V2_ENABLED;
    (process.env as Record<string, string>).NODE_ENV = 'production';

    // Re-import config with the env flipped. Vitest caches modules, so use a
    // dynamic import inside a fresh module graph.
    const { config } = await import(`@/server/core/config?t=${Date.now()}`);
    expect(config.FEATURE_V2_ENABLED).toBe(false);

    if (prev !== undefined) (process.env as Record<string, string>).NODE_ENV = prev;
    if (prevFlag !== undefined) process.env.FEATURE_V2_ENABLED = prevFlag;
  });

  it('defaults to true outside production', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.FEATURE_V2_ENABLED;
    delete process.env.FEATURE_V2_ENABLED;
    (process.env as Record<string, string>).NODE_ENV = 'development';

    const { config } = await import(`@/server/core/config?t=${Date.now()}x`);
    expect(config.FEATURE_V2_ENABLED).toBe(true);

    if (prev !== undefined) (process.env as Record<string, string>).NODE_ENV = prev;
    if (prevFlag !== undefined) process.env.FEATURE_V2_ENABLED = prevFlag;
  });

  it('explicit FEATURE_V2_ENABLED overrides NODE_ENV default', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.FEATURE_V2_ENABLED;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.FEATURE_V2_ENABLED = 'true';

    const { config } = await import(`@/server/core/config?t=${Date.now()}y`);
    expect(config.FEATURE_V2_ENABLED).toBe(true);

    if (prev !== undefined) (process.env as Record<string, string>).NODE_ENV = prev;
    if (prevFlag !== undefined) process.env.FEATURE_V2_ENABLED = prevFlag;
    else delete process.env.FEATURE_V2_ENABLED;
  });
});
