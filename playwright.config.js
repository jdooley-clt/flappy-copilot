import { defineConfig, devices } from '@playwright/test';
import { origin } from './scripts/cabinet.mjs';

const browserSpecs = /(?:cabinet|standalone|a11y)\.spec\.js/;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local runs surface every flake; CI runners are slow and shared, so they may retry.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: origin, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node scripts/serve-compat.mjs',
    url: `${origin}/health`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop-chromium', testMatch: browserSpecs, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-chromium',
      testMatch: browserSpecs,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      // WebKit paints and reloads several times slower than Chromium on CI runners.
      name: 'mobile-webkit',
      testMatch: browserSpecs,
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
      timeout: 120_000,
      expect: { timeout: 20_000 },
    },
    // Static checks of the build output run once, not once per browser.
    { name: 'payload-budget', testMatch: /budget\.spec\.js/ },
  ],
});
