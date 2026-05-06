/**
 * Vitest configuration with path aliases matching tsconfig.
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
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      exclude: ['node_modules', '.opencode', 'apps/proxy-worker', 'apps/daemon', 'apps/broker', '.next', '.kortix', 'src/sdk/**', 'tests/e2e/**', 'tests/scripts/**', 'tests/benchmarks/**', 'tests/integration/**'],
      env: {
        ...env,
        ...(env.TEST_DATABASE_URL && !env.DATABASE_URL ? { DATABASE_URL: env.TEST_DATABASE_URL } : {}),
      },
    },
    resolve: {
      alias: [
        { find: /^@\/server\/(.*)$/, replacement: path.resolve(__dirname, './apps/v1-api/src/server') + '/$1' },
        { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src') + '/$1' },
      ],
    },
  };
});
