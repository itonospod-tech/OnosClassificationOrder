import { defineConfig, devices } from '@playwright/test';

import { API_PORT, dbName, WEB_BASE } from './support/env';

// Fixes the throwaway DB name in process.env before the servers and workers inherit it.
const DB = dbName();
const reuse = process.env.E2E_REUSE_SERVERS === '1';
/**
 * Browser: the installed Google Chrome by default (`channel: 'chrome'`). `E2E_CHROME_CHANNEL=msedge` (or any
 * Playwright channel) picks another one; `E2E_CHROME_CHANNEL=` (set but EMPTY) uses Playwright's bundled
 * Chromium instead — install it once with `npx playwright install chromium`. Unset keeps the default.
 */
const CHANNEL = (process.env.E2E_CHROME_CHANNEL ?? 'chrome') || undefined;

export default defineConfig({
  testDir: './tests',
  // Serial on purpose: several pages show global numbers (queue size, totals), and the wallet/undo
  // scenarios measure "before → after". Independence comes from per-test seeds, not from parallelism.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: WEB_BASE,
    channel: CHANNEL,
    locale: 'en-US',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec\.ts/ },
    // Phone layout. Pixel 7 is a Chromium device, so the installed Chrome (or bundled Chromium) can emulate it.
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 7'], channel: CHANNEL } },
  ],
  webServer: [
    {
      command: 'node scripts/start-api.mjs',
      url: `http://localhost:${API_PORT}/api/v1/factories/options`, // 401 = up
      env: { E2E_DB: DB },
      reuseExistingServer: reuse,
      timeout: 240_000,
      stdout: process.env.E2E_SERVER_LOGS === '1' ? 'pipe' : 'ignore',
      stderr: process.env.E2E_SERVER_LOGS === '1' ? 'pipe' : 'ignore',
    },
    {
      command: 'node scripts/start-web.mjs',
      url: WEB_BASE,
      reuseExistingServer: reuse,
      timeout: 180_000,
      stdout: process.env.E2E_SERVER_LOGS === '1' ? 'pipe' : 'ignore',
      stderr: process.env.E2E_SERVER_LOGS === '1' ? 'pipe' : 'ignore',
    },
  ],
});

