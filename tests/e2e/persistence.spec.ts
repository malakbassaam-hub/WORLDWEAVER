import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
/**
 * Browser acceptance tests for world persistence (WW-016): Save, Restore,
 * Export, Import, unsaved-change confirmation and safe rejection of bad files.
 * Recorded mode (playwright.config.ts); no network calls beyond the local proxy.
 * Each test gets a fresh browser context, so localStorage starts empty.
 */
const KINGDOM_ENTITIES = 27;
const SPIRE = 'Sentinel Spire I';

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

const panel = (page: Page) => page.locator('.ww-persistence');
const indicator = (page: Page) => panel(page).locator('[role="status"]');
const dialog = (page: Page) => panel(page).locator('[role="alertdialog"]');
const message = (page: Page) => panel(page).locator('p[aria-live="polite"]');
const button = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const fileInput = (page: Page) => panel(page).locator('input[type="file"]');
const entityCount = (page: Page) => page.locator('.ww-hierarchy .ww-panel-head .ww-panel-meta');
const undoBtn = (page: Page) => page.locator('.ww-topbar [aria-label="Undo"]');
/** Rows whose entity name is exactly 
ame (substring matching would confuse Spire I with Spire II and III). */
const row = (page: Page, name: string) => page.locator('.ww-tree-row').filter({ has: page.locator('.ww-tree-name').getByText(name, { exact: true }) });

async function openStudio(page: Page): Promise<string[]> {
  const errors = watchConsole(page);
  await page.goto('/');
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
  return errors;
}

/** Renames an entity through the real inspector (one undoable event). */
async function rename(page: Page, from: string, to: string) {
  await row(page, from).first().click();
  const name = page.locator('.ww-name-input');
  await expect(name).toHaveValue(from);
  await name.fill(to);
  await name.press('Enter');
  await expect(row(page, to).first()).toBeVisible();
}

async function exportWorld(page: Page, info: TestInfo): Promise<{ path: string; filename: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Export').click()]);
  const path = info.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { path, filename: download.suggestedFilename() };
}

const GOOD_ENTITY_ISSUE = /./;

test.describe('World persistence', () => {
  test('the panel is mounted and states the history policy', async ({ page }) => {
    const errors = await openStudio(page);
    await expect(panel(page)).toBeVisible();
    await expect(indicator(page)).toHaveText('All changes saved');
    await expect(page.getByTestId('persistence-history-note')).toContainText('Undo history, the Causal Ledger and Parallel Futures do not survive');
    await expect(button(page, 'Restore')).toBeDisabled(); // no local save yet
    expect(errors).toEqual([]);
  });

  test('unsaved indicator follows edits and returns to saved after undo', async ({ page }) => {
    const errors = await openStudio(page);
    await rename(page, SPIRE, 'Edited Spire');
    await expect(indicator(page)).toHaveText('Unsaved changes');
    await undoBtn(page).click();
    await expect(row(page, SPIRE).first()).toBeVisible();
    await expect(indicator(page)).toHaveText('All changes saved');
    expect(errors).toEqual([]);
  });

  test('save, reload, restore: world and pinned state come back; history starts fresh', async ({ page }) => {
    const errors = await openStudio(page);
    await rename(page, SPIRE, 'Saved Spire');
    await button(page, 'Save').click();
    await expect(indicator(page)).toHaveText('All changes saved');
    await expect(button(page, 'Restore')).toBeEnabled();

    await page.reload();
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
    // A reload boots the default world; the save is offered, not applied silently.
    await expect(row(page, SPIRE).first()).toBeVisible();
    await expect(row(page, 'Saved Spire')).toHaveCount(0);

    await button(page, 'Restore').click(); // fresh session: no confirmation needed
    await expect(row(page, 'Saved Spire').first()).toBeVisible();
    await expect(row(page, SPIRE)).toHaveCount(0);
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
    await expect(indicator(page)).toHaveText('All changes saved');
    // Pinned citadel is still pinned and still cannot be removed.
    await expect(row(page, 'Aurelion Citadel').locator('.ww-pin-badge')).toHaveCount(1);
    await row(page, 'Aurelion Citadel').click();
    await expect(page.locator('.ww-inspector').getByRole('button', { name: /remove/i }).first()).toBeDisabled();
    // Fresh baseline: no undo history, baseline row says restored, ledger restarted.
    await expect(undoBtn(page)).toBeDisabled();
    await expect(page.locator('.ww-rail .ww-event.is-genesis .ww-event-text')).toContainText('Restored baseline');
    await expect(page.locator('.ww-toast-host')).toContainText('Undo history, the ledger and futures start fresh');
    expect(errors).toEqual([]);
  });

  test('export then import: file name, round trip, confirmation, no undo history', async ({ page }, info) => {
    const errors = await openStudio(page);
    await rename(page, SPIRE, 'Exported Spire');
    const exported = await exportWorld(page, info);
    expect(exported.filename).toMatch(/^worldweaver-crystal-kingdom-at-dusk-\d{14}\.worldweaver\.world$/);

    await rename(page, 'Exported Spire', 'Later Spire'); // unsaved change after the export
    await fileInput(page).setInputFiles(exported.path);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('Import “Crystal Kingdom at Dusk”');
    await expect(dialog(page)).toContainText('27 entities');
    await expect(dialog(page)).toContainText('unsaved changes');
    await expect(row(page, 'Later Spire').first()).toBeVisible(); // nothing applied before confirmation

    await dialog(page).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(row(page, 'Exported Spire').first()).toBeVisible();
    await expect(row(page, 'Later Spire')).toHaveCount(0);
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
    await expect(row(page, 'Aurelion Citadel').locator('.ww-pin-badge')).toHaveCount(1);
    await expect(undoBtn(page)).toBeDisabled();
    await expect(page.locator('.ww-rail .ww-event.is-genesis .ww-event-text')).toContainText('Restored baseline');
    expect(errors).toEqual([]);
  });

  test('Cancel keeps the current world; Restore asks before discarding unsaved changes', async ({ page }) => {
    const errors = await openStudio(page);
    await button(page, 'Save').click();
    await rename(page, SPIRE, 'Unsaved Spire');

    await button(page, 'Restore').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('unsaved changes');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, 'Unsaved Spire').first()).toBeVisible();
    await expect(indicator(page)).toHaveText('Unsaved changes');
    await expect(undoBtn(page)).toBeEnabled();

    await button(page, 'Restore').click();
    await dialog(page).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(row(page, SPIRE).first()).toBeVisible();
    await expect(row(page, 'Unsaved Spire')).toHaveCount(0);
    await expect(undoBtn(page)).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('bad files are refused with a reason and change nothing', async ({ page }, info) => {
    const errors = await openStudio(page);
    await rename(page, SPIRE, 'Survivor Spire');
    const good = await exportWorld(page, info);
    const goodText = await readFile(good.path, 'utf8');

    const refuse = async (name: string, content: string | Buffer, expected: RegExp) => {
      const path = info.outputPath(name);
      await writeFile(path, content);
      await fileInput(page).setInputFiles(path);
      await expect(message(page)).toHaveText(expected);
      await expect(dialog(page)).toBeHidden();
      await expect(row(page, 'Survivor Spire').first()).toBeVisible();
      await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
      await expect(indicator(page)).toHaveText('Unsaved changes'); // the edit is still live
      await expect(undoBtn(page)).toBeEnabled(); // history untouched
    };

    await refuse('garbage.worldweaver.world', 'this is not json {', /Import refused/);
    await refuse('empty.worldweaver.world', '', /empty/);
    await refuse('wrong-type.exe', goodText, /Choose a \.worldweaver\.world file/);
    await refuse('big.worldweaver.world', Buffer.alloc(3 * 1024 * 1024, 0x20), /larger than 2 MB/);
    await refuse('not-ours.worldweaver.world', JSON.stringify({ format: 'something.else', version: 1 }), /not a WORLDWEAVER world file/);
    await refuse('newer.worldweaver.world', JSON.stringify({ ...JSON.parse(goodText), version: 99 }), /newer WORLDWEAVER/);
    // Tampered content: the checksum no longer matches.
    await refuse('tampered.worldweaver.world', goodText.replace('Survivor Spire', 'Forged Spire'), /Import refused/);
    // A wrong field type without a matching checksum is also refused (the checksum is checked before the schema).
    const broken = JSON.parse(goodText) as { world: { name: unknown } };
    broken.world.name = 42;
    await refuse('bad-field.worldweaver.world', JSON.stringify(broken), GOOD_ENTITY_ISSUE);

    expect(errors).toEqual([]);
  });

  test('a full browser store reports the quota error and keeps the world', async ({ page }) => {
    const errors = await openStudio(page);
    await rename(page, SPIRE, 'Quota Spire');
    await page.evaluate(() => {
      const chunk = 'x'.repeat(256 * 1024);
      try {
        for (let i = 0; i < 400; i++) localStorage.setItem(`filler-${i}`, chunk);
      } catch {
        /* quota reached */
      }
    });
    await button(page, 'Save').click();
    await expect(message(page)).not.toHaveText('');
    await expect(indicator(page)).toHaveText('Unsaved changes');
    await expect(row(page, 'Quota Spire').first()).toBeVisible();
    expect(errors.filter((e) => !/QuotaExceeded|quota/i.test(e))).toEqual([]);
  });
});
