import { expect, test, type Page, type TestInfo } from '@playwright/test';
/**
 * Persistence risk closure (2026-11-21): repeated session reboots, rollback
 * when a valid world fails to start, Parallel Futures after a restore, and the
 * persistence panel at narrow widths. Recorded mode, SwiftShader.
 *
 * An init script instruments the page so leaks are measured, not guessed:
 * WebGL contexts created (and whether they are lost), window listeners for
 * keydown/beforeunload, and active ResizeObservers.
 */
const ENTITIES = 27;

declare global {
  interface Window {
    __ww: {
      contexts: Array<WeakRef<WebGLRenderingContext | WebGL2RenderingContext>>;
      listeners: Record<string, number>;
      observers: number;
    };
  }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const ww = { contexts: [] as Array<WeakRef<WebGLRenderingContext | WebGL2RenderingContext>>, listeners: {} as Record<string, number>, observers: 0 };
    (window as unknown as { __ww: typeof ww }).__ww = ww;
    const seen = new WeakSet<object>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest) as RenderingContext | null;
      if (ctx && (type === 'webgl2' || type === 'webgl') && !seen.has(ctx)) {
        seen.add(ctx);
        ww.contexts.push(new WeakRef(ctx as WebGLRenderingContext));
      }
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
    const tracked = new Set(['keydown', 'beforeunload']);
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    window.addEventListener = function (this: Window, type: string, ...rest: unknown[]) {
      if (tracked.has(type)) ww.listeners[type] = (ww.listeners[type] ?? 0) + 1;
      return (add as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof window.addEventListener;
    window.removeEventListener = function (this: Window, type: string, ...rest: unknown[]) {
      if (tracked.has(type)) ww.listeners[type] = (ww.listeners[type] ?? 0) - 1;
      return (remove as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof window.removeEventListener;
    const RO = window.ResizeObserver;
    window.ResizeObserver = class extends RO {
      constructor(cb: ResizeObserverCallback) {
        super(cb);
        ww.observers += 1;
      }
      override disconnect() {
        ww.observers -= 1;
        super.disconnect();
      }
    };
  });
}

interface Probe {
  readonly canvases: number;
  readonly contextsCreated: number;
  readonly contextsAlive: number;
  readonly contextsNotLost: number;
  /** Live contexts on studio viewport canvases (`canvas.ww-canvas`), current or disposed. */
  readonly studioNotLost: number;
  /** Live contexts on other canvases, e.g. the renderer's WebGL capability probe. */
  readonly otherNotLost: number;
  readonly keydown: number;
  readonly beforeunload: number;
  readonly observers: number;
  readonly heapMB: number | null;
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const ww = window.__ww;
    const alive = ww.contexts.map((r) => r.deref()).filter((c): c is WebGLRenderingContext => Boolean(c));
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      canvases: document.querySelectorAll('canvas').length,
      contextsCreated: ww.contexts.length,
      contextsAlive: alive.length,
      contextsNotLost: alive.filter((c) => !c.isContextLost()).length,
      studioNotLost: alive.filter((c) => !c.isContextLost() && (c.canvas as HTMLCanvasElement).classList?.contains('ww-canvas')).length,
      otherNotLost: alive.filter((c) => !c.isContextLost() && !(c.canvas as HTMLCanvasElement).classList?.contains('ww-canvas')).length,
      keydown: ww.listeners.keydown ?? 0,
      beforeunload: ww.listeners.beforeunload ?? 0,
      observers: ww.observers,
      heapMB: mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : null,
    };
  });

function watch(page: Page) {
  const errors: string[] = [];
  const contextWarnings: string[] = [];
  page.on('console', (m) => {
    if (/too many active webgl contexts|oldest context will be lost/i.test(m.text())) contextWarnings.push(m.text());
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, contextWarnings };
}

const panel = (page: Page) => page.locator('.ww-persistence');
const dialog = (page: Page) => panel(page).locator('[role="alertdialog"]');
const button = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const indicator = (page: Page) => panel(page).locator('[role="status"]');
const fileInput = (page: Page) => panel(page).locator('input[type="file"]');
const entityCount = (page: Page) => page.locator('.ww-hierarchy .ww-panel-head .ww-panel-meta');
const undoBtn = (page: Page) => page.locator('.ww-topbar [aria-label="Undo"]');
const baselineRow = (page: Page) => page.locator('.ww-rail .ww-event.is-genesis .ww-event-text');
const row = (page: Page, name: string) => page.locator('.ww-tree-row').filter({ has: page.locator('.ww-tree-name').getByText(name, { exact: true }) });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  await expect(entityCount(page)).toHaveText(`${ENTITIES} entities`);
}

async function rename(page: Page, from: string, to: string) {
  await row(page, from).first().click();
  const name = page.locator('.ww-name-input');
  await expect(name).toHaveValue(from);
  await name.fill(to);
  await name.press('Enter');
  await expect(row(page, to)).toHaveCount(1);
}

async function exportFile(page: Page, info: TestInfo, name: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Export').click()]);
  expect(download.suggestedFilename()).toMatch(/\.worldweaver\.world$/);
  const path = info.outputPath(name);
  await download.saveAs(path);
  return path;
}

async function confirm(page: Page, action: 'Restore' | 'Import') {
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: action, exact: true }).click();
}

test.describe('Persistence risk closure', () => {
  test('20 save/restore/import reboots: one canvas, no listener or observer growth, clean console', async ({ page }, info) => {
    test.setTimeout(40 * 60_000);
    await instrument(page);
    const log = watch(page);
    await open(page);
    const start = await probe(page);
    await button(page, 'Save').click();
    const file = await exportFile(page, info, 'cycle.worldweaver.world');

    const samples: Array<Probe & { cycle: number }> = [];
    let current = 'Sentinel Spire I';
    for (let cycle = 1; cycle <= 20; cycle++) {
      const next = `Cycle Spire ${cycle}`;
      await rename(page, current, next); // an edit, so a load must ask first
      if (cycle % 2 === 1) {
        await button(page, 'Save').click();
        await expect(indicator(page)).toHaveText('All changes saved');
        await button(page, 'Restore').click();
        await confirm(page, 'Restore');
        current = next; // the save holds this name
      } else {
        await fileInput(page).setInputFiles(file);
        await confirm(page, 'Import');
        current = 'Sentinel Spire I'; // the exported file holds the original name
      }
      await expect(baselineRow(page)).toContainText('Restored baseline');
      await expect(row(page, current)).toHaveCount(1);
      await expect(entityCount(page)).toHaveText(`${ENTITIES} entities`);
      await expect(undoBtn(page)).toBeDisabled();
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(page.locator('.ww-fallback')).toHaveCount(0);
      samples.push({ cycle, ...(await probe(page)) });
    }
    // Exercise the last session: viewport hover/click, keyboard undo after an edit.
    await page.mouse.move(800, 450);
    await page.mouse.click(800, 450);
    await rename(page, current, 'After Cycles');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect(row(page, current)).toHaveCount(1);
    const end = await probe(page);

    const report = { start, end, samples };
    await info.attach('reboot-probes.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log(`[probe] start ${JSON.stringify(start)}`);
    for (const s of samples.filter((x) => x.cycle % 5 === 0 || x.cycle === 1)) console.log(`[probe] cycle ${s.cycle} ${JSON.stringify(s)}`);
    console.log(`[probe] end ${JSON.stringify(end)}`);
    console.log(`[probe] contextWarnings ${JSON.stringify(log.contextWarnings)}`);

    expect.soft(end.keydown, 'keydown listeners').toBe(start.keydown);
    expect.soft(end.beforeunload, 'beforeunload listeners').toBe(start.beforeunload);
    expect.soft(end.observers, 'active ResizeObservers').toBe(start.observers);
    expect.soft(log.contextWarnings, 'WebGL context warnings').toEqual([]);
    // Studio viewport contexts are released at teardown (src/main.ts, WW-033): only the current one is live.
    expect.soft(end.studioNotLost, 'live studio viewport contexts after 20 reboots').toBe(1);
    // Probe contexts belong to the renderer (Kilo). Reported, not asserted: see WW-033.
    info.annotations.push({ type: 'WW-033 probe contexts live after 20 reboots', description: String(end.otherNotLost) });
    expect(log.errors).toEqual([]);
  });

  test('rollback: a valid world that fails to start keeps the previous world', async ({ page }, info) => {
    await instrument(page);
    const log = watch(page);
    await open(page);
    const file = await exportFile(page, info, 'valid.worldweaver.world');
    await rename(page, 'Sentinel Spire I', 'Unsaved Rollback Spire');
    const before = await probe(page);
    // Make the next session's boot throw once: its persistence block registers a beforeunload listener.
    await page.evaluate(() => {
      const add = window.addEventListener;
      let armed = true;
      window.addEventListener = function (this: Window, type: string, ...rest: unknown[]) {
        if (armed && type === 'beforeunload') {
          armed = false;
          throw new Error('injected boot failure');
        }
        return (add as (...a: unknown[]) => void).call(this, type, ...rest);
      } as typeof window.addEventListener;
    });
    await fileInput(page).setInputFiles(file);
    await confirm(page, 'Import');

    await expect(page.locator('.ww-toast-host')).toContainText('The loaded world could not be started. Your previous world was kept.');
    await expect(row(page, 'Unsaved Rollback Spire')).toHaveCount(1); // the unsaved edit survived
    await expect(row(page, 'Sentinel Spire I')).toHaveCount(0); // the import did not apply
    await expect(entityCount(page)).toHaveText(`${ENTITIES} entities`);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
    await expect(undoBtn(page)).toBeDisabled(); // documented: content kept, history not
    await expect(row(page, 'Aurelion Citadel').locator('.ww-pin-badge')).toHaveCount(1);
    await expect(indicator(page)).toHaveText('All changes saved'); // baseline is the kept world
    const after = await probe(page);
    expect(after.keydown).toBe(before.keydown);
    expect(after.beforeunload).toBe(before.beforeunload);
    // The studio still works: a later import succeeds.
    await fileInput(page).setInputFiles(file);
    await confirm(page, 'Import');
    await expect(baselineRow(page)).toContainText('Restored baseline');
    await expect(row(page, 'Sentinel Spire I')).toHaveCount(1);
    expect(log.errors.filter((e) => !e.includes('injected boot failure'))).toEqual([]);
    expect(log.errors.some((e) => e.includes('injected boot failure'))).toBe(true);
  });

  test('Parallel Futures after a restore: confirmation names open futures; futures and preview reset; new futures work', async ({ page }) => {
    const log = watch(page);
    await open(page);
    await button(page, 'Save').click();
    const futures = page.locator('.ww-panel.ww-futures');
    const newFuture = futures.locator('.ww-btn.is-primary.is-small', { hasText: 'New future' });
    await newFuture.click();
    await expect(page.locator('.ww-future-card')).toHaveCount(1);
    await newFuture.click();
    await expect(page.locator('.ww-future-card')).toHaveCount(2);
    await futures.locator('.ww-btn.is-small', { hasText: 'Preview' }).first().click();
    await expect(futures.locator('.ww-btn.is-small', { hasText: 'Stop preview' })).toBeVisible();
    await expect(undoBtn(page)).toBeDisabled(); // futures never touch the store
    await expect(indicator(page)).toHaveText('All changes saved');

    // The world has no edits, but 2 futures are open: Restore must ask.
    await button(page, 'Restore').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('2 open futures');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.ww-future-card')).toHaveCount(2); // Cancel kept them

    await button(page, 'Restore').click();
    await confirm(page, 'Restore');
    await expect(baselineRow(page)).toContainText('Restored baseline');
    await expect(futures).toContainText('No futures yet');
    await expect(page.locator('.ww-future-card')).toHaveCount(0);
    await expect(page.locator('.ww-futures-previewbar')).toBeHidden();
    await expect(page.locator('canvas')).toHaveCount(1);

    // Futures work in the restored session.
    await futures.locator('.ww-btn.is-primary.is-small', { hasText: 'New future' }).click();
    await expect(page.locator('.ww-future-card')).toHaveCount(1);
    await futures.locator('.ww-btn.is-small', { hasText: 'Preview' }).first().click();
    await expect(futures.locator('.ww-btn.is-small', { hasText: 'Stop preview' })).toBeVisible();
    await futures.locator('.ww-btn.is-small', { hasText: 'Stop preview' }).click();
    await expect(page.locator('.ww-futures-previewbar')).toBeHidden();
    expect(log.errors).toEqual([]);
  });

  for (const size of [
    { width: 390, height: 844 },
    { width: 860, height: 800 },
    { width: 1180, height: 800 },
  ]) {
    test(`narrow layout ${size.width}x${size.height}: save, export, import confirm/cancel, restore`, async ({ page }, info) => {
      const log = watch(page);
      await page.setViewportSize(size);
      await open(page);
      await expect(panel(page)).toBeVisible();
      await rename(page, 'Sentinel Spire I', 'Narrow Spire');
      await button(page, 'Save').click();
      await expect(indicator(page)).toHaveText('All changes saved');
      const file = await exportFile(page, info, `narrow-${size.width}.worldweaver.world`);
      await rename(page, 'Narrow Spire', 'Narrow Unsaved');

      await fileInput(page).setInputFiles(file);
      await expect(dialog(page)).toBeVisible();
      await dialog(page).scrollIntoViewIfNeeded();
      const box = await dialog(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5);
      await dialog(page).getByRole('button', { name: 'Cancel' }).click(); // a click fails if anything covers it
      await expect(dialog(page)).toBeHidden();
      await expect(row(page, 'Narrow Unsaved')).toHaveCount(1);

      await button(page, 'Restore').click();
      await confirm(page, 'Restore');
      await expect(row(page, 'Narrow Spire')).toHaveCount(1);
      await expect(undoBtn(page)).toBeDisabled();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(log.errors).toEqual([]);
    });
  }
});
