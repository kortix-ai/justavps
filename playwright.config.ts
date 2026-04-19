import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Sequential — tests depend on state (login, created resources)
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Dev server must be running on port 4100
  webServer: {
    command: 'PORT=4100 pnpm dev',
    url: 'http://localhost:4100/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
