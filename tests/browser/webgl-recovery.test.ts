import { test, expect } from '@playwright/test';

/**
 * WORLDWEAVER WebGL Context-Loss Recovery — Browser Tests
 *
 * Exercises the real WEBGL_lose_context extension against the production build
 * served by `vite preview`. Synthetic DOM event dispatch alone is not proof of
 * real GPU recovery.
 *
 * Prerequisites:
 * - Chrome with WebGL 2 and WEBGL_lose_context support
 * - `vite preview` on localhost:4173
 */

// Known-benign Three.js / SwiftShader console noise that does not indicate a
// real defect. The app continues to render correctly despite these messages.
const BENIGN_PATTERNS = [
  'Shader Error',
  'VALIDATE_STATUS',
  'MeshDepthMaterial',
  'INVALID_OPERATION: useProgram',
  'INVALID_OPERATION: attachShader',
  'INVALID_OPERATION: deleteShader',
  'INVALID_OPERATION: detachShader',
];

function isBenign(text: string): boolean {
  return BENIGN_PATTERNS.some((p) => text.includes(p));
}

async function wgl(page: any) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.ww-canvas') as HTMLCanvasElement | null;
    if (!canvas) return { ok: false, reason: 'no canvas' };
    const gl = canvas.getContext('webgl2');
    if (!gl) return { ok: false, reason: 'no webgl2' };
    const ext = gl.getExtension('WEBGL_lose_context');
    return { ok: !!ext, reason: ext ? null : 'no WEBGL_lose_context' };
  });
}

async function initWglRefs(page: any) {
  await page.evaluate(() => {
    const canvas = document.querySelector('.ww-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    const ext = gl.getExtension('WEBGL_lose_context');
    (window as any).__wglLose = ext.loseContext.bind(ext);
    (window as any).__wglRestore = ext.restoreContext.bind(ext);
  });
}

async function loseContext(page: any) {
  await page.evaluate(() => (window as any).__wglLose());
}

async function restoreContext(page: any) {
  await page.evaluate(() => (window as any).__wglRestore());
}

async function waitForRendererReady(page: any) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.ww-canvas', { state: 'visible', timeout: 30000 });
  await initWglRefs(page);
  await page.waitForTimeout(500);
}

async function expectViewportRecovered(page: any) {
  await page.waitForFunction(() => !document.querySelector('.ww-fallback'), { timeout: 20000 });
  await expect(page.locator('.ww-fallback')).toHaveCount(0);
  await expect(page.locator('.ww-canvas')).toBeVisible();
  await page.waitForTimeout(300);
}

test.describe('WebGL context-loss recovery', () => {

  test('app loads and renders without fallback', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: any) => {
      const text = msg.text();
      if (msg.type() === 'error' && !isBenign(text)) errors.push(text);
    });

    await waitForRendererReady(page);
    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);

    const support = await wgl(page);
    expect(support.ok).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test('WEBGL_lose_context restores viewport and dismisses fallback', async ({ page }) => {
    await waitForRendererReady(page);
    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);

    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10000 });
    await expect(page.locator('.ww-fallback')).toBeVisible();

    await restoreContext(page);
    await expectViewportRecovered(page);
  });

  test('no unexpected console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: any) => {
      const text = msg.text();
      if (msg.type() === 'error' && !isBenign(text)) errors.push(text);
    });

    await waitForRendererReady(page);
    await page.waitForTimeout(1000);

    await loseContext(page);
    await page.waitForTimeout(500);
    await restoreContext(page);
    await page.waitForTimeout(1000);

    expect(errors).toHaveLength(0);
  });
});

test.describe('Renderer disposal and cleanup', () => {

  test('resize after recovery maintains rendering', async ({ page }) => {
    await waitForRendererReady(page);
    await loseContext(page);
    await page.waitForFunction(() => !!document.querySelector('.ww-fallback'), { timeout: 10000 });
    await restoreContext(page);
    await expectViewportRecovered(page);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);

    await expect(page.locator('.ww-canvas')).toBeVisible();
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
  });
});
