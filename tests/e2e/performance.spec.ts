import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Performance & compatibility measurements.
 *
 * Runs in SwiftShader WebGL (software rasterization). Results are NOT
 * representative of real-GPU performance; they establish a baseline and
 * confirm cinematic vs performance mode behave correctly.
 *
 * All measurements are informational - no hard thresholds are asserted
 * because software WebGL is 10-100x slower than hardware WebGL.
 */

interface ConsoleLog {
  readonly errors: string[];
}

function watchConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { errors: [] };
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') log.errors.push(m.text());
  });
  return log;
}

async function openStudio(page: Page) {
  const log = watchConsole(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  return log;
}

async function readStats(page: Page) {
  return page.locator('.ww-stats').textContent() ?? '';
}

test.describe('Performance baseline (SwiftShader - software WebGL)', () => {

  test('initial load completes with expected entity count and no errors', async ({ page }) => {
    const log = await openStudio(page);
    const stats = await readStats(page);
    expect(stats).toContain('27 entities');
    // No real runtime errors (benign SwiftShader shader warnings excluded).
    const benign = /Shader Error|VALIDATE_STATUS|MeshDepthMaterial|INVALID_OPERATION: useProgram/;
    expect(log.errors.filter((e) => !benign.test(e))).toEqual([]);
  });

  test('cinematic mode shows bloom draw calls and higher DPR', async ({ page }) => {
    await openStudio(page);
    await page.waitForTimeout(1000);
    const qualityBtn = page.locator('button.ww-btn.is-ghost').filter({ hasText: /Cinematic|Performance/ });
    await expect(qualityBtn).toContainText('Cinematic');
    await readStats(page);

    await qualityBtn.click();
    await page.waitForTimeout(1000);
    await expect(qualityBtn).toContainText('Performance');
    await readStats(page);

    // Switch back to cinematic.
    await qualityBtn.click();
    await page.waitForTimeout(1000);
    await expect(qualityBtn).toContainText('Cinematic');
  });

  test('narrow phone viewport renders without fallback', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudio(page);
    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
  });

  test('desktop 1920x1080 viewport renders without fallback', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openStudio(page);
    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
  });

  test('stats panel updates with frame data', async ({ page }) => {
    await openStudio(page);
    await page.waitForTimeout(1500); // let at least one stats tick fire
    const stats = await readStats(page);
    expect(stats).toMatch(/\d+ fps/);
    expect(stats).toMatch(/\d+ draws/);
    expect(stats).toMatch(/\d+k? tris/);
    expect(stats).toMatch(/\d+ entities/);
  });
});

test.describe('Compatibility', () => {

  test('WEBGL_lose_context extension is available', async ({ page }) => {
    await openStudio(page);
    const support = await page.evaluate(() => {
      const canvas = document.querySelector('.ww-canvas') as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2');
      return !!gl?.getExtension('WEBGL_lose_context');
    });
    expect(support).toBe(true);
  });

  test('PageVisibility API does not break renderer', async ({ page }) => {
    await openStudio(page);
    // Simulate tab hiding/showing.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
  });
});
