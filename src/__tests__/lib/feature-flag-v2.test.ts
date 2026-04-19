import { describe, expect, it } from 'vitest';

/**
 * Feature flag: FEATURE_V2_ENABLED gates the entire v2 API surface +
 * dashboard pages.
 *
 * Default is FALSE in every environment. Fail-closed: no environment can
 * accidentally expose v2 without setting the env var explicitly.
 *
 * This test locks in the default so a future config refactor can't flip v2
 * on silently anywhere.
 */

describe('FEATURE_V2_ENABLED default', () => {
  async function loadConfigFresh(cacheBuster: string) {
    return import(`@/server/core/config?t=${cacheBuster}`);
  }

  it('defaults to false when no env var is set (production)', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.FEATURE_V2_ENABLED;
    delete process.env.FEATURE_V2_ENABLED;
    (process.env as Record<string, string>).NODE_ENV = 'production';

    const { config } = await loadConfigFresh(`prod-${Date.now()}`);
    expect(config.FEATURE_V2_ENABLED).toBe(false);

    if (prev !== undefined) (process.env as Record<string, string>).NODE_ENV = prev;
    if (prevFlag !== undefined) process.env.FEATURE_V2_ENABLED = prevFlag;
  });

  it('defaults to false when no env var is set (development)', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.FEATURE_V2_ENABLED;
    delete process.env.FEATURE_V2_ENABLED;
    (process.env as Record<string, string>).NODE_ENV = 'development';

    const { config } = await loadConfigFresh(`dev-${Date.now()}`);
    // Fail-closed: dev is also off by default; opt in via .env.local.
    expect(config.FEATURE_V2_ENABLED).toBe(false);

    if (prev !== undefined) (process.env as Record<string, string>).NODE_ENV = prev;
    if (prevFlag !== undefined) process.env.FEATURE_V2_ENABLED = prevFlag;
  });

  it('explicit FEATURE_V2_ENABLED=true opts in', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.FEATURE_V2_ENABLED;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.FEATURE_V2_ENABLED = 'true';

    const { config } = await loadConfigFresh(`opt-in-${Date.now()}`);
    expect(config.FEATURE_V2_ENABLED).toBe(true);

    if (prev !== undefined) (process.env as Record<string, string>).NODE_ENV = prev;
    if (prevFlag !== undefined) process.env.FEATURE_V2_ENABLED = prevFlag;
    else delete process.env.FEATURE_V2_ENABLED;
  });

  it('any non-true value keeps it off', async () => {
    const prev = process.env.NODE_ENV;
    const prevFlag = process.env.FEATURE_V2_ENABLED;
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    for (const bad of ['', 'false', 'FALSE', '0', 'no', 'maybe']) {
      process.env.FEATURE_V2_ENABLED = bad;
      const { config } = await loadConfigFresh(`${bad}-${Date.now()}`);
      expect(config.FEATURE_V2_ENABLED, `input=${JSON.stringify(bad)}`).toBe(false);
    }

    if (prev !== undefined) (process.env as Record<string, string>).NODE_ENV = prev;
    if (prevFlag !== undefined) process.env.FEATURE_V2_ENABLED = prevFlag;
    else delete process.env.FEATURE_V2_ENABLED;
  });
});
