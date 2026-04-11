/// <reference types="vitest/globals" />
/**
 * Vitest global setup.
 */

import { vi } from 'vitest';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();
dotenvConfig({ path: '.env.local', override: true });

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Set environment variables immediately
process.env.HETZNER_API_KEY = 'test-hetzner-key';
process.env.HETZNER_DEFAULT_LOCATION = 'nbg1';
process.env.HETZNER_ROBOT_USER = 'robot-user';
process.env.HETZNER_ROBOT_PASSWORD = 'robot-pass';
process.env.BAREMETAL_ENABLED = 'true';
process.env.CLOUDFLARE_API_KEY = 'test-cf-key';
process.env.CLOUDFLARE_GLOBAL_API_KEY = 'test-cf-key';
process.env.CLOUDFLARE_EMAIL = 'test@example.com';
process.env.CLOUDFLARE_ZONE_ID = 'test-zone-id';
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
process.env.CF_KV_NAMESPACE_ID = 'test-kv-namespace';
process.env.PROXY_DOMAIN = 'test.example.com';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key-for-vitest-only';

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
