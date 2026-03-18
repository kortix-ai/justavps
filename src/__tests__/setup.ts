/// <reference types="vitest/globals" />
/**
 * Vitest global setup.
 */

import { vi } from 'vitest';

// Set environment variables immediately
process.env.HETZNER_API_KEY = 'test-hetzner-key';
process.env.HETZNER_DEFAULT_LOCATION = 'nbg1';
process.env.CLOUDFLARE_API_KEY = 'test-cf-key';
process.env.CLOUDFLARE_GLOBAL_API_KEY = 'test-cf-key';
process.env.CLOUDFLARE_EMAIL = 'test@example.com';
process.env.CLOUDFLARE_ZONE_ID = 'test-zone-id';
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
process.env.CF_KV_NAMESPACE_ID = 'test-kv-namespace';
process.env.PROXY_DOMAIN = 'test.example.com';
process.env.COMPUTE_MARKUP = '2.5';

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});