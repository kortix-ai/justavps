import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.V2_API_BASE_URL || process.env.BASE_URL || 'http://localhost:4200';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'v2-api-admin.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 420_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
