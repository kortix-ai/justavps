import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadLifecycle() {
  vi.resetModules();
  return import('@/server/lib/machine-lifecycle');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('resolveMachineCallbackConfig', () => {
  it('uses the request origin for deployed hosts', async () => {
    vi.stubEnv('MACHINE_CALLBACK_URL', '');
    vi.stubEnv('PLATFORM_URL', '');
    const { resolveMachineCallbackConfig } = await loadLifecycle();
    expect(resolveMachineCallbackConfig('https://dev.justavps.com/api/v1/machines')).toEqual({
      url: 'https://dev.justavps.com',
      callbackExpected: true,
    });
  });

  it('prefers explicit MACHINE_CALLBACK_URL when set', async () => {
    vi.stubEnv('MACHINE_CALLBACK_URL', 'https://callbacks.justavps.com');
    const { resolveMachineCallbackConfig } = await loadLifecycle();
    expect(resolveMachineCallbackConfig('http://localhost:4100/api/v1/machines')).toEqual({
      url: 'https://callbacks.justavps.com',
      callbackExpected: true,
    });
  });

  it('allows explicit private MACHINE_CALLBACK_URL for local e2e testing', async () => {
    vi.stubEnv('MACHINE_CALLBACK_URL', 'http://10.189.108.1:4102');
    const { resolveMachineCallbackConfig } = await loadLifecycle();
    expect(resolveMachineCallbackConfig('http://localhost:4100/api/v1/machines')).toEqual({
      url: 'http://10.189.108.1:4102',
      callbackExpected: true,
    });
  });

  it('marks loopback-only configs as callbackExpected=false', async () => {
    vi.stubEnv('MACHINE_CALLBACK_URL', '');
    vi.stubEnv('PLATFORM_URL', 'http://localhost:4100');
    const { resolveMachineCallbackConfig } = await loadLifecycle();
    expect(resolveMachineCallbackConfig('http://localhost:4100/api/v1/machines')).toEqual({
      url: 'http://localhost:4100',
      callbackExpected: false,
    });
  });
});

describe('resolvePlatformCallbackUrl', () => {
  it('returns the resolved callback URL', async () => {
    vi.stubEnv('MACHINE_CALLBACK_URL', '');
    vi.stubEnv('PLATFORM_URL', '');
    const { resolvePlatformCallbackUrl } = await loadLifecycle();
    expect(resolvePlatformCallbackUrl('https://dev.justavps.com/api/v1/machines')).toBe('https://dev.justavps.com');
  });

  it('falls back to configured platform URL for invalid request URLs', async () => {
    vi.stubEnv('MACHINE_CALLBACK_URL', process.env.MACHINE_CALLBACK_URL ?? '');
    vi.stubEnv('PLATFORM_URL', 'http://localhost:4100');
    const { resolvePlatformCallbackUrl } = await loadLifecycle();
    expect(resolvePlatformCallbackUrl('not-a-url')).toBe(process.env.MACHINE_CALLBACK_URL || 'http://localhost:4100');
  });
});
