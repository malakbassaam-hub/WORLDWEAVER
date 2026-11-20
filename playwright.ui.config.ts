import { defineConfig } from '@playwright/test';
/**
 * Browser tests for the Causal Ledger and Parallel Futures panels on the
 * standalone demo page (ledger-futures-demo.html). Separate from the shared
 * studio suite (playwright.config.ts). Recorded mode, empty key: no live
 * Gemini calls are possible.
 *
 *   npx playwright test --config playwright.ui.config.ts
 */
const PORT = 5299;
export default defineConfig({
  testDir: 'tests/ui',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/ui-artifacts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/api/director/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    env: {
      DIRECTOR_MODE: 'recorded',
      GEMINI_API_KEY: '',
      DIRECTOR_RECORDED_LATENCY_MS: '300',
      DIRECTOR_MORPH: '1',
      VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
    },
  },
});
