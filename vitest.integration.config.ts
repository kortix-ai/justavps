/**
 * Integration test config — runs tests in tests/integration/ against a real
 * database and dev server. Slower and has external dependencies, so separate
 * from the default vitest unit-test config.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';
import { config as dotenvConfig } from 'dotenv';

export default defineConfig(() => {
  dotenvConfig();
  dotenvConfig({ path: '.env.local', override: true });
  const env = process.env as Record<string, string>;
  return {
    test: {
      environment: 'node',
      globals: true,
      setupFiles: ['./src/__tests__/setup.ts'],
      include: ['tests/integration/**/*.test.ts'],
      exclude: ['node_modules', '.next'],
      testTimeout: 120_000,
      hookTimeout: 60_000,
      env: {
        ...env,
        ...(env.TEST_DATABASE_URL && !env.DATABASE_URL ? { DATABASE_URL: env.TEST_DATABASE_URL } : {}),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
