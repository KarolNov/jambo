import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: real browsers against the real Worker and Durable Objects, served locally by
 * `vite dev` (the Cloudflare Vite plugin runs them in workerd). Local only: the deployed dev and
 * preview environments sit behind Cloudflare Access, so these can't reach them for now.
 */
const PORT = Number(process.env.E2E_PORT ?? 5199)

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // Each test starts its own jam, but several tests time real audio (clicks, takes): running them
  // side by side on one machine makes those timings noisy.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/about`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
