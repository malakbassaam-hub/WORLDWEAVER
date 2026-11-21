import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { Entity, EntityId, World } from '../../src/core/types';
import { serializeWorld } from '../../src/persistence/saveFile';
import { buildCrystalKingdom } from '../../src/worlds/crystalKingdom';
/**
 * Session-reboot contract between persistence and the renderer
 * (docs/persistence/STUDIO_INTEGRATION.md, "Renderer requirements"):
 * repeated Import reboots keep exactly one canvas and a clean console, a world
 * with entirely different entity IDs loads and keeps its pins, and Director
 * Morph, the Causal Ledger and undo work on a restored world.
 * Recorded mode; no network beyond the local proxy.
 */
const ENTITIES = 27;

/** Same world content under entirely different entity IDs. */
function withNewIds(world: World, prefix: string): World {
  const map = (id: string) => `${prefix}${id}` as EntityId;
  const entities: Record<string, Entity> = {};
  for (const id of world.order) {
    const e = world.entities[id]!;
    entities[map(id)] = { ...e, id: map(id), parentId: e.parentId ? map(e.parentId) : null };
  }
  return { ...world, id: `${prefix}${world.id}`, entities, order: world.order.map(map) };
}

async function fileFor(world: World, path: string): Promise<string> {
  const s = serializeWorld(world, { savedAt: '2026-11-21T12:00:00.000Z' });
  if (!s.ok) throw new Error(`serialize failed: ${s.message}`);
  await writeFile(path, s.text);
  return path;
}

function watch(page: Page) {
  const errors: string[] = [];
  const contextWarnings: string[] = [];
  page.on('console', (m) => {
    if (/too many active webgl contexts|context lost/i.test(m.text())) contextWarnings.push(m.text());
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, contextWarnings };
}

const panel = (page: Page) => page.locator('.ww-persistence');
const dialog = (page: Page) => panel(page).locator('[role="alertdialog"]');
const fileInput = (page: Page) => panel(page).locator('input[type="file"]');
const entityCount = (page: Page) => page.locator('.ww-hierarchy .ww-panel-head .ww-panel-meta');
const undoBtn = (page: Page) => page.locator('.ww-topbar [aria-label="Undo"]');
const row = (page: Page, name: string) => page.locator('.ww-tree-row').filter({ has: page.locator('.ww-tree-name').getByText(name, { exact: true }) });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  await expect(entityCount(page)).toHaveText(`${ENTITIES} entities`);
}

/** Imports a file; confirms when the studio asks. */
async function importFile(page: Page, path: string) {
  await fileInput(page).setInputFiles(path);
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.ww-rail .ww-event.is-genesis .ww-event-text')).toContainText('Restored baseline');
  await expect(entityCount(page)).toHaveText(`${ENTITIES} entities`);
}

test.describe('Persistence session lifecycle', () => {
  test('repeated imports: one canvas, different entity IDs, pins kept, clean console', async ({ page }, info) => {
    const log = watch(page);
    await open(page);
    const base = buildCrystalKingdom();
    const files = [
      await fileFor(withNewIds(base, 'alt-'), info.outputPath('alt.worldweaver.world')),
      await fileFor(base, info.outputPath('base.worldweaver.world')),
      await fileFor(withNewIds(base, 'b2-'), info.outputPath('b2.worldweaver.world')),
      await fileFor(base, info.outputPath('base2.worldweaver.world')),
    ];
    for (const path of files) {
      await importFile(page, path);
      // The old session's renderer is gone: exactly one canvas in the page.
      await expect(page.locator('canvas')).toHaveCount(1);
      await expect(page.locator('.ww-fallback')).toHaveCount(0);
      await expect(undoBtn(page)).toBeDisabled();
      // The pinned citadel is pinned under whichever IDs the file used.
      await expect(row(page, 'Aurelion Citadel').locator('.ww-pin-badge')).toHaveCount(1);
    }
    // Interact with the latest session: hover and click the viewport, select and rename.
    await page.mouse.move(800, 450);
    await page.mouse.click(800, 450);
    await row(page, 'Sentinel Spire I').first().click();
    await page.locator('.ww-name-input').fill('Lifecycle Spire');
    await page.locator('.ww-name-input').press('Enter');
    await expect(row(page, 'Lifecycle Spire')).toHaveCount(1);
    await expect(undoBtn(page)).toBeEnabled();
    await row(page, 'Aurelion Citadel').click();
    await expect(page.locator('.ww-inspector').getByRole('button', { name: /remove/i }).first()).toBeDisabled();
    expect(log.contextWarnings).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  test('after import, a Director morph, the Causal Ledger and undo work on the restored world', async ({ page }, info) => {
    const log = watch(page);
    await open(page);
    await importFile(page, await fileFor(buildCrystalKingdom(), info.outputPath('k.worldweaver.world')));
    const ledgerRows = page.locator('.ww-ledger-row');
    const before = await ledgerRows.count();

    await page.locator('.ww-morph-row .ww-seg-btn').click();
    await page.locator('#ww-director-prompt').fill('violet dusk');
    await page.locator('.ww-generate').click();
    const preview = page.locator('.ww-director-card.is-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Pinned entities');
    await page.locator('.ww-director [data-action="apply"]').click();
    await expect(page.locator('.ww-director-card.is-applied')).toBeVisible();
    await expect(row(page, 'Aurelion Citadel')).toHaveCount(1);
    await expect(row(page, 'Aurelion Citadel').locator('.ww-pin-badge')).toHaveCount(1);
    // The new session's ledger recorded the morph.
    await expect.poll(() => ledgerRows.count()).toBeGreaterThan(before);
    await expect(panel(page).locator('[role="status"]')).toHaveText('Unsaved changes');

    await undoBtn(page).click();
    await expect(undoBtn(page)).toBeDisabled(); // the morph was the only step since the restore
    await expect(panel(page).locator('[role="status"]')).toHaveText('All changes saved');
    expect(log.contextWarnings).toEqual([]);
    expect(log.errors).toEqual([]);
  });
});
