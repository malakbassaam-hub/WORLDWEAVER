import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:5199';
const RESOLUTIONS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1727x900', width: 1727, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1180x800', width: 1180, height: 800 },
  { name: '860x800', width: 860, height: 800 },
  { name: '390x844', width: 390, height: 844 },
];

function viewportPercent(viewportBox: { width: number; height: number }, pageWidth: number, pageHeight: number): number {
  const viewportArea = viewportBox.width * viewportBox.height;
  const pageArea = pageWidth * pageHeight;
  return (viewportArea / pageArea) * 100;
}

for (const { name, width, height } of RESOLUTIONS) {
  test.describe(`Visual acceptance @ ${name}`, () => {
    test.use({ viewport: { width, height } });

    test('Default Studio Mode: unobstructed viewport >= 70%', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForSelector('.ww-studio:not(.is-immersive)', { state: 'visible', timeout: 60000 });
      await page.waitForTimeout(2000);

      const studio = page.locator('.ww-studio');
      const studioClasses = await studio.getAttribute('class');
      expect(studioClasses).not.toContain('is-immersive');
      expect(studioClasses).not.toContain('has-active-tool');

      const viewport = page.locator('.ww-viewport');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      if (!viewportBox) throw new Error('Viewport not found');

      const pct = viewportPercent(viewportBox!, width, height);
      console.log(`${name}: viewport ${viewportBox!.width}x${viewportBox!.height} = ${pct.toFixed(1)}% of page`);
      expect(pct).toBeGreaterThanOrEqual(70);

      // No large panels open by default
      const activeTool = page.locator('.ww-tool-btn.is-active');
      expect(await activeTool.count()).toBe(0);

      const panelArea = page.locator('.ww-panel-area');
      const panelTransform = await panelArea.evaluate(el => window.getComputedStyle(el).transform);
      // When closed, panel is at translateX(100%) which renders as matrix(1, 0, 0, 1, width, 0)
      const panelX = parseFloat(panelTransform.split(',')[4] || '0');
      expect(panelX).toBeGreaterThan(0);

      const bottomDrawer = page.locator('.ww-bottom-drawer');
      const drawerTransform = await bottomDrawer.evaluate(el => window.getComputedStyle(el).transform);
      // When closed, drawer is at translateY(100%) which renders as matrix(1, 0, 0, 1, 0, height)
      const drawerY = parseFloat(drawerTransform.split(',')[5] || '0');
      expect(drawerY).toBeGreaterThan(0);

      await page.screenshot({ path: `test-results/screenshots/studio-default-${name}.png`, fullPage: true });
    });

    test('One side panel open (AI World Director)', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForSelector('.ww-studio:not(.is-immersive)', { state: 'visible', timeout: 60000 });
      await page.waitForTimeout(500);

      await page.click('.ww-tool-btn[data-tool="director"]');
      await page.waitForTimeout(500);

      const panelArea = page.locator('.ww-panel-area');
      await expect(panelArea).toHaveClass(/is-open/);

      const viewport = page.locator('.ww-viewport');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      if (!viewportBox) throw new Error('Viewport not found');

      const pct = viewportPercent(viewportBox!, width, height);
      console.log(`${name}: viewport with panel open = ${pct.toFixed(1)}%`);
      // With panel open, viewport should still be substantial (though less than 70%)
      // Panel is 320px, so at 1920px viewport should be ~1600px = 83%

      await page.screenshot({ path: `test-results/screenshots/panel-director-${name}.png`, fullPage: true });
    });

    test('Bottom drawer open (Timeline + Ledger)', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForSelector('.ww-studio:not(.is-immersive)', { state: 'visible', timeout: 60000 });
      await page.waitForTimeout(500);

      await page.keyboard.press('b');
      await page.waitForTimeout(500);

      const bottomDrawer = page.locator('.ww-bottom-drawer');
      await expect(bottomDrawer).toHaveClass(/is-open/);

      const viewport = page.locator('.ww-viewport');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      if (!viewportBox) throw new Error('Viewport not found');

      const pct = viewportPercent(viewportBox!, width, height);
      console.log(`${name}: viewport with drawer open = ${pct.toFixed(1)}%`);

      await page.screenshot({ path: `test-results/screenshots/drawer-open-${name}.png`, fullPage: true });
    });

    test('Explore World (Immersive Mode)', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForSelector('.ww-studio:not(.is-immersive)', { state: 'visible', timeout: 60000 });
      await page.waitForTimeout(500);

      await page.click('button[aria-label="Enter immersive explore mode"]');
      await page.waitForTimeout(500);

      const studio = page.locator('.ww-studio');
      await expect(studio).toHaveClass(/is-immersive/);

      // Topbar and tool dock should be hidden
      await expect(page.locator('.ww-topbar')).toBeHidden();
      await expect(page.locator('.ww-tool-dock')).toBeHidden();
      await expect(page.locator('.ww-panel-area')).toBeHidden();
      await expect(page.locator('.ww-bottom-drawer')).toBeHidden();

      // Immersive controls should be visible
      await expect(page.locator('.ww-immersive-controls')).toBeVisible();

      const viewport = page.locator('.ww-viewport');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      if (!viewportBox) throw new Error('Viewport not found');

      const pct = viewportPercent(viewportBox!, width, height);
      console.log(`${name}: immersive viewport = ${pct.toFixed(1)}%`);
      expect(pct).toBeGreaterThanOrEqual(95); // Near full screen

      await page.screenshot({ path: `test-results/screenshots/immersive-${name}.png`, fullPage: true });
    });

    test('Exit Immersive restores Studio Mode', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForSelector('.ww-studio:not(.is-immersive)', { state: 'visible', timeout: 60000 });
      await page.waitForTimeout(500);

      await page.click('button[aria-label="Enter immersive explore mode"]');
      await page.waitForTimeout(500);

      await page.click('button[aria-label="Exit immersive mode"]');
      await page.waitForTimeout(500);

      const studio = page.locator('.ww-studio');
      await expect(studio).not.toHaveClass(/is-immersive/);

      // Topbar and tool dock should be visible again
      await expect(page.locator('.ww-topbar')).toBeVisible();
      await expect(page.locator('.ww-tool-dock')).toBeVisible();

      const viewport = page.locator('.ww-viewport');
      const viewportBox = await viewport.boundingBox();
      expect(viewportBox).not.toBeNull();
      if (!viewportBox) throw new Error('Viewport not found');

      const pct = viewportPercent(viewportBox!, width, height);
      console.log(`${name}: restored viewport = ${pct.toFixed(1)}%`);
      expect(pct).toBeGreaterThanOrEqual(70);

      await page.screenshot({ path: `test-results/screenshots/restored-${name}.png`, fullPage: true });
    });
  });
}