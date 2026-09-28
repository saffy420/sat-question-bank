import { defineConfig } from '@playwright/test';

const localhost = port => `https://127.0.0.1:${port}`;
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/cdn-cache.js',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || '.opencode/pipeline/lessons-00b-e2e-harness/e2e/results',
  reporter: [['list']],
  // Specs share one isolated E2E database and seeded student IDs; avoid cross-spec write-back races.
  workers: 1,
  use: {
    baseURL: localhost(8787),
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Sandboxes with a preinstalled browser that does not match this Playwright revision.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    { command: 'node tools/e2e_server.cjs enabled', url: localhost(8787) + '/login', name: 'enabled', reuseExistingServer: false, ignoreHTTPSErrors: true, timeout: 90000 },
    { command: 'node tools/e2e_server.cjs unset', url: localhost(8788) + '/login', name: 'unset', reuseExistingServer: false, ignoreHTTPSErrors: true, timeout: 90000 },
    { command: 'node tools/e2e_server.cjs production', url: localhost(8789) + '/login', name: 'production-entry', reuseExistingServer: false, ignoreHTTPSErrors: true, timeout: 90000 }
  ]
});
