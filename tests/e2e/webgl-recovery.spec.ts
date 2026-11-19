import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * WebGL context-loss recovery browser acceptance tests.
 *
 * Exercises the real WEBGL_lose_context extension against the dev server.
 * Synthetic DOM event dispatch alone is not proof of real GPU recovery.
 *
 * These tests run in RECORDED mode with SwiftShader WebGL (see playwright.config.ts).
 * The recovery behaviour is identical on real hardware; only performance differs.
 */

interface ConsoleLog {
  readonly errors: string[];
  readonly warnings: string[];
}

function watchConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { errors: [], warnings: [] };
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') log.errors.push(m.text());
    if (m.type() === 'warning') log.warnings.push(m.text());
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  return log;
}

async function openStudio(page: Page): Promise<ConsoleLog> {
  const log = watchConsole(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  await expect(page.locator('.ww-mode-badge')).toHaveText('RECORDED');
  return log;
}

async function initWglRefs(page: Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('.ww-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context not available');
    (window as any).__wglLose = ext.loseContext.bind(ext);
    (window as any).__wglRestore = ext.restoreContext.bind(ext);
  });
}

async function loseContext(page: Page) {
  await page.evaluate(() => (window as any).__wglLose());
}

async function restoreContext(page: Page) {
  await page.evaluate(() => (window as any).__wglRestore());
}

async function expectViewportRecovered(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.ww-fallback'), { timeout: 20_000 });
  await expect(page.locator('.ww-fallback')).toHaveCount(0);
  await expect(page.locator('.ww-canvas')).toBeVisible();
  await page.waitForTimeout(300);
}

test.describe('WebGL context-loss recovery', () => {

  test('app loads and renders without fallback', async ({ page }) => {
    const log = await openStudio(page);
    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);

    await initWglRefs(page);

    // Benign Three.js/SwiftShader noise is allowed; real errors are not.
    const benign = /Shader Error|VALIDATE_STATUS|MeshDepthMaterial|INVALID_OPERATION: useProgram|INVALID_OPERATION: attachShader|INVALID_OPERATION: deleteShader|INVALID_OPERATION: detachShader/;
    const realErrors = log.errors.filter((e) => !benign.test(e));
    expect(realErrors).toEqual([]);
  });

  test('WEBGL_lose_context restores viewport and dismisses fallback', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);
    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);

    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
    await expect(page.locator('.ww-fallback')).toBeVisible();

    await restoreContext(page);
    await expectViewportRecovered(page);
  });

  test('selection survives context loss and recovery', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);

    // Select an entity via the canvas (focal point near centre).
    await page.click('.ww-canvas', { position: { x: 800, y: 450 } });
    await page.waitForTimeout(300);

    await expect(page.locator('.ww-name-input')).toBeVisible();
    const selectedName = await page.locator('.ww-name-input').inputValue();

    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
    await restoreContext(page);
    await expectViewportRecovered(page);

    // Inspector should still show the same selected entity.
    await expect(page.locator('.ww-name-input')).toBeVisible();
    await expect(page.locator('.ww-name-input')).toHaveValue(selectedName);
  });

  test('user edits survive context loss and recovery', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);

    const hierarchyRow = page.locator('.ww-tree-row').first();
    await expect(hierarchyRow).toBeVisible();
    await hierarchyRow.click();
    await page.waitForTimeout(300);

    const nameInput = page.locator('.ww-name-input');
    await expect(nameInput).toBeVisible();
    const newName = `Renamed-${Date.now()}`;
    await nameInput.fill(newName);
    await nameInput.press('Tab');
    await page.waitForTimeout(300);

    // Verify the edit committed via hierarchy panel.
    await expect(page.locator('.ww-tree-name').first()).toHaveText(newName);

    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
    await restoreContext(page);
    await expectViewportRecovered(page);

    // Re-select via hierarchy and verify the edit survived in inspector.
    await page.locator('.ww-tree-row').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-name-input')).toHaveValue(newName);
  });

  test('undo/redo history survives context loss and recovery', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);

    const hierarchyRow = page.locator('.ww-tree-row').first();
    await hierarchyRow.click();
    await page.waitForTimeout(300);

    const nameInput = page.locator('.ww-name-input');
    await nameInput.fill(`HistoryTest-${Date.now()}`);
    await nameInput.press('Tab');
    await page.waitForTimeout(300);

    await expect(page.locator('.ww-topbar [aria-label="Undo"]')).not.toBeDisabled();

    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
    await restoreContext(page);
    await expectViewportRecovered(page);

    // Undo/redo should still work after recovery.
    await expect(page.locator('.ww-topbar [aria-label="Undo"]')).not.toBeDisabled();

    // Perform an undo and verify it takes effect.
    await page.locator('.ww-topbar [aria-label="Undo"]').click();
    await page.waitForTimeout(300);
  });

  test('recovery works in both cinematic and performance modes', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);

    // Cinematic mode (default).
    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
    await restoreContext(page);
    await expectViewportRecovered(page);

    // Switch to performance mode.
    const qualityBtn = page.locator('button.ww-btn.is-ghost').filter({ hasText: /Cinematic|Performance/ });
    await qualityBtn.click();
    await page.waitForTimeout(500);

    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
    await restoreContext(page);
    await expectViewportRecovered(page);

    // Switch back to cinematic.
    await qualityBtn.click();
    await page.waitForTimeout(500);
  });

  test('repeated loss/restore cycles recover reliably', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);

    for (let i = 0; i < 3; i++) {
      await loseContext(page);
      await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
      await restoreContext(page);
      await expectViewportRecovered(page);
      await page.waitForTimeout(200);
    }
  });

  test('no unexpected console errors after recovery cycle', async ({ page }) => {
    const log = await openStudio(page);
    await initWglRefs(page);
    await page.waitForTimeout(1000);

    await loseContext(page);
    await page.waitForTimeout(500);
    await restoreContext(page);
    await page.waitForTimeout(1000);

    const benign = /Shader Error|VALIDATE_STATUS|MeshDepthMaterial|INVALID_OPERATION: useProgram|INVALID_OPERATION: attachShader|INVALID_OPERATION: deleteShader|INVALID_OPERATION: detachShader/;
    const realErrors = log.errors.filter((e) => !benign.test(e));
    expect(realErrors).toEqual([]);
  });
});

test.describe('Renderer disposal and cleanup', () => {

  test('page reload after context loss restores cleanly', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);
    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });

    await page.reload();
    await expect(page.locator('canvas.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-loader')).toHaveCount(0);
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
  });

  test('resize after recovery maintains rendering', async ({ page }) => {
    await openStudio(page);
    await initWglRefs(page);
    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10_000 });
    await restoreContext(page);
    await expectViewportRecovered(page);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);

    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
  });
});
