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
      exclude: ['node_modules', '.opencode', 'workers', 'agent', '.next', '.kortix', 'src/__tests__/e2e/**', 'src/sdk/**'],
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
