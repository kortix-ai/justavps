/**
 * Vitest config for E2E infrastructure tests.
 * These create real cloud resources (Hetzner VPS) and cost money.
 *
 * Run: PLATFORM_E2E=1 E2E_API_KEY=sk_live_xxx npx vitest run --config vitest.e2e.config.ts
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/e2e/**/*.test.ts'],
    testTimeout: 10 * 60 * 1000, // 10 min per test
    hookTimeout: 10 * 60 * 1000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
