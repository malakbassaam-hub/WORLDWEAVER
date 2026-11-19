import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        // Reuse the system Chrome installation instead of downloading Playwright binaries.
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        channel: 'chrome',
        launchOptions: {
          args: [
            '--enable-webgl',
            '--use-gl=swiftshader',
            '--no-sandbox',
            '--disable-gpu-sandbox',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
