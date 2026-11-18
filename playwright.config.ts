import { defineConfig } from '@playwright/test';

/**
 * Browser acceptance tests (WW-010). Runs the real studio in the installed
 * Google Chrome (no browser download), headless with SwiftShader WebGL.
 *
 * The test server is forced into RECORDED mode with an empty key, so these
 * tests are deterministic and can never spend live Gemini quota.
 */
const PORT = 5199;

export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: software WebGL on a shared, memory-constrained machine can be ~10x slower.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 900 },
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
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
      DIRECTOR_RECORDED_LATENCY_MS: '1500',
      VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
    },
  },
});
