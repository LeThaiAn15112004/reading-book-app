import { defineConfig } from '@playwright/test'

/**
 * Desktop E2E: drives the BUILT Electron app (`vite build` → dist/ + dist-electron/) through
 * Playwright's Electron API. One app instance per test, each with its own throwaway userData dir.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
