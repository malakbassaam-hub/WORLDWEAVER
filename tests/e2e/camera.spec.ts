import { expect, test, type Page } from '@playwright/test';
/**
 * Camera controls on the integrated studio (cinematic renderer + persistence).
 * Movement is measured from canvas screenshots: each action must change the
 * image clearly more than the idle animation (motes, wisps, sky) does in the
 * same time. Images are decoded in the page, so no image library is needed.
 * SwiftShader proves behaviour, not smoothness or appearance.
 */
const ENTITIES = 27;

async function open(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  await expect(page.locator('.ww-hierarchy .ww-panel-head .ww-panel-meta')).toHaveText(`${ENTITIES} entities`);
  await page.waitForTimeout(4000); // intro camera flight
  return errors;
}

const shot = async (page: Page) => (await page.locator('canvas.ww-canvas').screenshot()).toString('base64');

/** Mean absolute RGB difference (0–255) between two PNGs, at 160×90. */
function diff(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(async ([pa, pb]) => {
    const load = (s: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/png;base64,${s}`;
      });
    const [ia, ib] = await Promise.all([load(pa), load(pb)]);
    const w = 160;
    const h = 90;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(ia, 0, 0, w, h);
    const da = x.getImageData(0, 0, w, h).data;
    x.clearRect(0, 0, w, h);
    x.drawImage(ib, 0, 0, w, h);
    const db = x.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) sum += Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!);
    return sum / (w * h * 3);
  }, [a, b] as const);
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

const SETTLE = 1500;

test.describe('Camera controls (integrated)', () => {
  test('orbit, pan, zoom, Home reset, double-click focus and F frame all move the camera', async ({ page }) => {
    const errors = await open(page);
    const home = await shot(page);
    await page.waitForTimeout(SETTLE);
    const idle = await diff(page, home, await shot(page));
    const threshold = Math.max(idle * 3, 1.5);
    const measured: Record<string, number> = { idle };

    await drag(page, 220, 0);
    await page.waitForTimeout(SETTLE);
    const orbited = await shot(page);
    measured.orbit = await diff(page, home, orbited);

    await drag(page, 0, 120, 'right');
    await page.waitForTimeout(SETTLE);
    const panned = await shot(page);
    measured.pan = await diff(page, orbited, panned);

    const c = await centre(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(SETTLE);
    const zoomed = await shot(page);
    measured.zoom = await diff(page, panned, zoomed);

    await page.locator('.ww-topbar').click({ position: { x: 5, y: 5 } }); // focus off any input
    await page.keyboard.press('Home');
    await page.waitForTimeout(3000);
    measured.homeVsStart = await diff(page, home, await shot(page));
    measured.homeVsZoomed = await diff(page, zoomed, await shot(page));

    // Double-click the centre (the citadel in the default view): select and focus.
    const before = await shot(page);
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForTimeout(3000);
    measured.dblclick = await diff(page, before, await shot(page));
    await expect(page.locator('.ww-name-input')).toHaveValue('Aurelion Citadel');

    // F frames the selected entity.
    await page.keyboard.press('Home');
    await page.waitForTimeout(3000);
    await page.locator('.ww-tree-row').filter({ has: page.locator('.ww-tree-name').getByText('Sentinel Spire I', { exact: true }) }).click();
    const beforeF = await shot(page);
    await page.locator('.ww-topbar').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('f');
    await page.waitForTimeout(3000);
    measured.frameF = await diff(page, beforeF, await shot(page));

    console.log(`[camera] ${JSON.stringify(measured)} threshold=${threshold.toFixed(2)}`);
    expect.soft(measured.orbit, 'orbit').toBeGreaterThan(threshold);
    expect.soft(measured.pan, 'pan').toBeGreaterThan(threshold);
    expect.soft(measured.zoom, 'zoom').toBeGreaterThan(threshold);
    expect.soft(measured.homeVsZoomed, 'Home moves away from the zoomed view').toBeGreaterThan(threshold);
    expect.soft(measured.homeVsStart, 'Home returns near the start view').toBeLessThan(measured.orbit / 2);
    expect.soft(measured.dblclick, 'double-click focus').toBeGreaterThan(threshold);
    expect.soft(measured.frameF, 'F frames the selection').toBeGreaterThan(threshold);
    expect(errors).toEqual([]);
  });

  test('drag does not select; camera still works after a Restore reboot', async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator('.ww-name-input')).toHaveCount(0); // nothing selected
    await drag(page, 180, 40);
    await page.waitForTimeout(SETTLE);
    await expect(page.locator('.ww-name-input')).toHaveCount(0); // a drag is not a click

    const panel = page.locator('.ww-persistence');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await panel.getByRole('button', { name: 'Restore', exact: true }).click(); // clean session: no confirmation
    await expect(page.locator('.ww-rail .ww-event.is-genesis .ww-event-text')).toContainText('Restored baseline');
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.waitForTimeout(4000);
    const a = await shot(page);
    await page.waitForTimeout(SETTLE);
    const idle = await diff(page, a, await shot(page));
    const b = await shot(page);
    await drag(page, -220, 0);
    await page.waitForTimeout(SETTLE);
    const orbit = await diff(page, b, await shot(page));
    console.log(`[camera after restore] idle=${idle.toFixed(2)} orbit=${orbit.toFixed(2)}`);
    expect(orbit).toBeGreaterThan(Math.max(idle * 3, 1.5));
    expect(errors).toEqual([]);
  });
});
