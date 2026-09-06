import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4321);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec astro preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: {
      ...process.env,
      ASTRO_PREVIEW_BACKGROUND: '0',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
