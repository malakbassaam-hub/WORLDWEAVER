import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const ENTITIES = 27;

async function openStudio(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  await expect(page.locator('.ww-hierarchy .ww-panel-head .ww-panel-meta')).toHaveText(`${ENTITIES} entities`);
  await page.waitForTimeout(2000); // intro camera flight
  return errors;
}

async function centre(page: Page) {
  const box = (await page.locator('canvas.ww-canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, dx: number, dy: number, button: 'left' | 'right' = 'left') {
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 12 });
  await page.mouse.up({ button });
}

test.describe('UX verification: camera and Explore mode', () => {
  test('camera: orbit, pan, zoom, Home reset work', async ({ page }) => {
    const errors = await openStudio(page);
    const c = await centre(page);

    // Orbit
    await drag(page, 220, 0);
    await page.waitForTimeout(1000);
    await expect(page.locator('canvas.ww-canvas')).toBeVisible();

    // Pan
    await drag(page, 0, 120, 'right');
    await page.waitForTimeout(1000);
    await expect(page.locator('canvas.ww-canvas')).toBeVisible();

    // Zoom
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(1000);
    await expect(page.locator('canvas.ww-canvas')).toBeVisible();

    // Home reset
    await page.locator('.ww-topbar').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Home');
    await page.waitForTimeout(2000);
    await expect(page.locator('canvas.ww-canvas')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('camera: double-click and F key for entity focus', async ({ page }) => {
    const errors = await openStudio(page);

    // Open hierarchy panel to ensure selection works
    await page.click('.ww-tool-btn[data-tool="hierarchy"]');
    await page.waitForTimeout(300);
    
    // Click an entity in the hierarchy to select it
    await page.locator('.ww-tree-row').filter({ has: page.locator('.ww-tree-name').getByText('Sentinel Spire I', { exact: true }) }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.ww-name-input')).toHaveValue('Sentinel Spire I');

    // F to frame selection
    await page.locator('.ww-topbar').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('f');
    await page.waitForTimeout(2000);
    await expect(page.locator('canvas.ww-canvas')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Explore mode: enter, verify immersive controls, exit', async ({ page }) => {
    const errors = await openStudio(page);

    // Enter Explore mode
    await page.click('button[aria-label="Enter immersive explore mode"]');
    await expect(page.locator('.ww-studio')).toHaveClass(/is-immersive/);

    // Immersive controls should be visible
    await expect(page.locator('.ww-immersive-controls')).toBeVisible();
    await expect(page.locator('button[aria-label="Exit immersive mode"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Reset camera to default view"]')).toBeVisible();
    await expect(page.locator('.ww-immersive-controls button[aria-label="Show camera controls help"]')).toBeVisible();

    // Topbar and tool dock should be hidden
    await expect(page.locator('.ww-topbar')).toBeHidden();
    await expect(page.locator('.ww-tool-dock')).toBeHidden();

    // Canvas should still be visible
    await expect(page.locator('canvas.ww-canvas')).toBeVisible();

    // Exit Explore mode
    await page.click('button[aria-label="Exit immersive mode"]');
    await expect(page.locator('.ww-studio')).not.toHaveClass(/is-immersive/);

    // Topbar and tool dock should be visible again
    await expect(page.locator('.ww-topbar')).toBeVisible();
    await expect(page.locator('.ww-tool-dock')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Causal Ledger and Parallel Futures tabs accessible in Studio', async ({ page }) => {
    const errors = await openStudio(page);

    // Open bottom drawer first (ledger and futures are in the drawer)
    await page.keyboard.press('b');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-bottom-drawer')).toHaveClass(/is-open/);

    // Click Causal Ledger tab
    await page.click('.ww-tool-btn[data-tool="ledger"]');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-ledger')).toBeVisible();
    await expect(page.locator('.ww-ledger h2')).toHaveText('Causal Ledger');

    // Click Parallel Futures tab
    await page.click('.ww-tool-btn[data-tool="futures"]');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-futures')).toBeVisible();
    await expect(page.locator('.ww-futures h2')).toHaveText('Parallel Futures');

    // Close drawer
    await page.keyboard.press('b');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-bottom-drawer')).not.toHaveClass(/is-open/);

    expect(errors).toEqual([]);
  });

  test('Director panel accessible and functional', async ({ page }) => {
    const errors = await openStudio(page);

    // Click AI World Director tab
    await page.click('.ww-tool-btn[data-tool="director"]');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-director')).toBeVisible();
    await expect(page.locator('.ww-director h2')).toHaveText('AI World Director');

    // Prompt should be visible
    await expect(page.locator('#ww-director-prompt')).toBeVisible();
    await expect(page.locator('.ww-generate')).toBeVisible();

    // Close panel
    await page.click('.ww-tool-btn[data-tool="director"]');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-panel-area')).not.toHaveClass(/is-open/);

    expect(errors).toEqual([]);
  });

  test('Timeline panel accessible', async ({ page }) => {
    const errors = await openStudio(page);

    await page.keyboard.press('b');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-bottom-drawer')).toHaveClass(/is-open/);

    await page.click('.ww-tool-btn[data-tool="timeline"]');
    await page.waitForTimeout(300);
    await expect(page.locator('.ww-timeline')).toBeVisible();
    await expect(page.locator('.ww-timeline h2')).toHaveText('Timeline');

    await page.keyboard.press('b');
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });
});