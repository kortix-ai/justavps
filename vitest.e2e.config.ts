/**
 * Vitest config for E2E infrastructure tests.
 * These create real cloud resources (Hetzner VPS) and cost money.
 *
 * Run: PLATFORM_E2E=1 E2E_API_KEY=sk_live_xxx npx vitest run --config vitest.e2e.config.ts
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
      setupFiles: ['./src/__tests__/e2e/setup.ts'],
      include: ['src/__tests__/e2e/**/*.test.ts'],
      testTimeout: 10 * 60 * 1000, // 10 min per test
      hookTimeout: 10 * 60 * 1000,
      fileParallelism: false,
      sequence: { concurrent: false },
      env,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
