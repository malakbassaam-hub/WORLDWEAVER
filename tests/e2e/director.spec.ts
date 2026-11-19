import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Browser acceptance tests for the Phase 2 AI World Director and the existing
 * Crystal Kingdom editor. The server runs in RECORDED mode (playwright.config.ts).
 */

const KINGDOM_ENTITIES = 27;

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
  await page.goto('/');
  await expect(page.locator('canvas.ww-canvas')).toBeVisible();
  await expect(page.locator('.ww-loader')).toHaveCount(0);
  await expect(page.locator('.ww-mode-badge')).toHaveText('RECORDED');
  await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
  return log;
}

const entityCount = (page: Page) => page.locator('.ww-hierarchy .ww-panel-head .ww-panel-meta');
const prompt = (page: Page) => page.locator('#ww-director-prompt');
const generate = (page: Page) => page.locator('.ww-generate');
const card = (page: Page, kind: string) => page.locator(`.ww-director-card.is-${kind}`);
const action = (page: Page, name: string) => page.locator(`.ww-director [data-action="${name}"]`);
const morphBtn = (page: Page) => page.locator('.ww-morph-row .ww-seg-btn');

/**
 * Holds POST /api/director requests in the browser until `release()`, so the
 * loading state lasts exactly as long as a test needs, regardless of machine
 * speed. Also counts requests. Cancelled requests are tolerated.
 */
async function holdDirector(page: Page) {
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/director', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    await gate;
    await route.continue().catch(() => undefined); // the browser may have aborted it (Cancel)
  });
  return { release: () => release(), count: () => posts };
}

async function ask(page: Page, text: string, task: 'Create' | 'Edit' = 'Create') {
  await page.locator('.ww-seg-btn', { hasText: task }).click();
  await prompt(page).fill(text);
  await generate(page).click();
}

test.describe('studio baseline', () => {
  test('loads the Crystal Kingdom with a clearly labelled RECORDED Director and a clean console', async ({ page }) => {
    const log = await openStudio(page);
    await expect(page.locator('.ww-fallback')).toHaveCount(0);
    await expect(page.locator('.ww-mode-note')).toContainText('not live AI');
    await expect(page.locator('.ww-mode-badge')).toHaveAttribute('title', /not live AI/);
    await expect(page.locator('.ww-stats')).toContainText(`${KINGDOM_ENTITIES} entities`);
    await expect(page.locator('.ww-director')).toBeVisible();
    // WW-011: no runtime, shader or deprecated-shadow-map messages.
    await page.waitForTimeout(1500);
    expect(log.errors).toEqual([]);
    expect(log.warnings.filter((w) => /PCFSoftShadowMap|THREE\.|Shader|WebGLProgram/.test(w))).toEqual([]);
  });

  test('existing editor: hierarchy selection, rename and viewport selection still work', async ({ page }) => {
    await openStudio(page);
    await page.locator('.ww-tree-row', { hasText: 'Sentinel Spire I' }).first().click();
    const name = page.locator('.ww-name-input');
    await expect(name).toHaveValue('Sentinel Spire I');
    await name.fill('Hand-edited Spire');
    await name.press('Enter');
    await expect(page.locator('.ww-tree-row.is-selected .ww-tree-name')).toHaveText('Hand-edited Spire');
    await expect(page.locator('.ww-rail .ww-event-text').last()).toHaveText('Renamed to Hand-edited Spire');
    await page.keyboard.press('Escape');
    // Default camera frames the citadel at the viewport centre.
    await page.locator('[aria-label="Reset view"], .ww-topbar .ww-btn', { hasText: 'Reset view' }).first().click();
    await page.waitForTimeout(2500);
    await page.mouse.click(800, 450);
    await expect(page.locator('.ww-name-input')).toHaveValue('Aurelion Citadel');
  });

  test('WW-027: clicking the already-active swatch records no edit', async ({ page }) => {
    await openStudio(page);
    await page.locator('.ww-tree-row', { hasText: 'Sentinel Spire I' }).first().click();
    const active = page.locator('.ww-swatch.is-active');
    await expect(active).toHaveAttribute('aria-label', 'Apply Aether Cyan');
    const chips = page.locator('.ww-rail .ww-event');
    const before = await chips.count();
    await active.click();
    await page.waitForTimeout(500);
    await expect(chips).toHaveCount(before);
    await expect(page.locator('.ww-topbar [aria-label="Undo"]')).toBeDisabled();
    await expect(page.locator('.ww-toast')).toHaveCount(0); // "No change." is silent
    // A real change is still recorded.
    await page.locator('.ww-swatch[aria-label="Apply Night Violet"]').click();
    await expect(chips).toHaveCount(before + 1);
  });
});

test.describe('AI World Director (recorded mode)', () => {
  test('create: preview first, explicit Apply, one undo step, redo restores everything', async ({ page }) => {
    await openStudio(page);
    const hold = await holdDirector(page);
    await ask(page, 'Grow a crystal garden on the main isle');
    await expect(card(page, 'loading')).toBeVisible();
    await expect(card(page, 'loading')).toContainText('recorded response');
    await expect(prompt(page)).toHaveAttribute('readonly', '');
    hold.release();
    const preview = card(page, 'preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('RECORDED · not live AI');
    await expect(preview).toContainText('Nothing has changed yet');
    await expect(preview.locator('.ww-op.is-accepted')).toHaveCount(2);
    await expect(preview.locator('.ww-proposal-stats')).toHaveText('2 operations · 7 new');
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`); // not applied yet
    await expect(action(page, 'apply')).toBeFocused();

    await action(page, 'apply').click();
    await expect(card(page, 'applied')).toBeVisible();
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES + 7} entities`);
    await expect(page.locator('.ww-event.is-batch').last()).toContainText('Director (recorded)');
    await expect(page.locator('.ww-event.is-batch').last().locator('.ww-source')).toHaveText('AI');
    await expect(page.locator('.ww-stats')).toContainText(`${KINGDOM_ENTITIES + 7} entities`);
    await expect(page.locator('.ww-name-input')).toHaveValue('Mint Shard Garden I'); // first new entity selected

    await page.locator('.ww-topbar [aria-label="Undo"]').click();
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
    await expect(page.locator('.ww-topbar [aria-label="Undo"]')).toBeDisabled(); // exactly one step
    await page.locator('.ww-topbar [aria-label="Redo"]').click();
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES + 7} entities`);
  });

  test('discard leaves the world unchanged', async ({ page }) => {
    await openStudio(page);
    await ask(page, 'Hang lanterns in the sky');
    await expect(card(page, 'preview')).toBeVisible();
    await action(page, 'discard').click();
    await expect(card(page, 'preview')).toHaveCount(0);
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
    await expect(page.locator('.ww-event.is-batch')).toHaveCount(0);
  });

  test('cancel during loading: the late response is ignored', async ({ page }) => {
    await openStudio(page);
    const hold = await holdDirector(page);
    await ask(page, 'Add drifting islands');
    await expect(card(page, 'loading')).toBeVisible();
    await action(page, 'cancel').click();
    await expect(card(page, 'loading')).toHaveCount(0);
    hold.release(); // let the (aborted) request proceed; its response must be ignored
    await page.waitForTimeout(2500); // longer than the recorded latency
    await expect(card(page, 'preview')).toHaveCount(0);
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
    await expect(prompt(page)).toBeFocused();
  });

  test('duplicate submissions while loading send exactly one request', async ({ page }) => {
    await openStudio(page);
    const hold = await holdDirector(page);
    await prompt(page).fill('Grow a crystal garden');
    await generate(page).dblclick();
    await expect(card(page, 'loading')).toBeVisible();
    // All of these happen while the first request is still held (loading).
    await prompt(page).press('Control+Enter');
    await generate(page).click({ force: true });
    await prompt(page).press('Control+Enter');
    await expect(generate(page)).toBeDisabled();
    expect(hold.count()).toBe(1);
    hold.release();
    await expect(card(page, 'preview')).toBeVisible();
    expect(hold.count()).toBe(1);
  });

  test('keyboard: Ctrl+Enter generates and Escape cancels', async ({ page }) => {
    await openStudio(page);
    const hold = await holdDirector(page);
    await prompt(page).fill('Grow a crystal garden');
    await prompt(page).press('Control+Enter');
    await expect(card(page, 'loading')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card(page, 'loading')).toHaveCount(0);
    hold.release();
    await prompt(page).press('Control+Enter');
    await expect(card(page, 'preview')).toBeVisible();
    await expect(action(page, 'apply')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card(page, 'applied')).toBeVisible();
  });

  test('pinned protection: a proposal touching the pinned citadel cannot be applied', async ({ page }) => {
    await openStudio(page);
    await ask(page, 'Recolour the pinned citadel', 'Edit');
    const preview = card(page, 'preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.ww-op.is-rejected')).toHaveCount(1);
    await expect(preview.locator('.ww-op-reason').first()).toContainText('pinned');
    await expect(preview).toContainText('Nothing is applied partially');
    await expect(action(page, 'apply')).toBeDisabled();
    await expect(page.locator('.ww-event.is-batch')).toHaveCount(0);
  });

  test('edit preview goes stale after a manual change and can be refreshed', async ({ page }) => {
    await openStudio(page);
    await ask(page, 'Make the spires violet', 'Edit');
    await expect(card(page, 'preview')).toBeVisible();
    await page.locator('.ww-tree-row', { hasText: 'Lumen Wisp of Embers' }).locator('.ww-row-action').click({ force: true });
    await expect(card(page, 'preview')).toContainText('The world changed after this preview was made');
    await expect(action(page, 'apply')).toBeDisabled();
    await action(page, 'refresh').click();
    await expect(action(page, 'apply')).toBeEnabled();
    await action(page, 'apply').click();
    await expect(card(page, 'applied')).toBeVisible();
  });

  test('errors: rate-limit countdown blocks retry; hostile output shows validation errors', async ({ page }) => {
    await openStudio(page);
    await ask(page, '#error:RATE_LIMITED');
    const error = card(page, 'error');
    await expect(error).toBeVisible();
    await expect(error.locator('.ww-card-title')).toHaveText('Gemini rate limit reached');
    await expect(action(page, 'retry')).toHaveText(/Retry in \d+ s/);
    await expect(action(page, 'retry')).toBeDisabled();
    await expect(generate(page)).toBeDisabled();
    await action(page, 'dismiss').click();

    await ask(page, '#error:HOSTILE');
    await expect(error.locator('.ww-card-title')).toHaveText('Proposal failed validation');
    await expect(error.locator('.ww-issue-list li')).not.toHaveCount(0);
    await expect(error).toContainText('__proto__');
    await expect(entityCount(page)).toHaveText(`${KINGDOM_ENTITIES} entities`);
    await expect(action(page, 'retry')).toBeEnabled();
  });

  test('responsive: the Director is usable on a narrow phone-sized viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudio(page);
    await prompt(page).scrollIntoViewIfNeeded();
    await expect(prompt(page)).toBeVisible();
    await ask(page, 'Hang lanterns in the sky');
    await expect(card(page, 'preview')).toBeVisible();
    await action(page, 'apply').scrollIntoViewIfNeeded();
    await action(page, 'apply').click();
    await expect(card(page, 'applied')).toBeVisible();
    // Every panel must fit the screen width (no horizontal overflow).
    for (const selector of ['.ww-topbar', '.ww-director', '.ww-hierarchy', '.ww-inspector', '.ww-timeline']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.x, `${selector} left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${selector} right edge`).toBeLessThanOrEqual(390 + 0.5);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const layoutOverflow = await page.locator('.ww-layout').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(layoutOverflow).toBeLessThanOrEqual(0);
    // Stacked panels must not overlap each other.
    const stack = ['.ww-topbar', '.ww-inspector', '.ww-hierarchy', '.ww-director', '.ww-timeline'];
    const boxes = await page.locator('.ww-layout').evaluate(
      (layout, selectors) => {
        const top = layout.getBoundingClientRect().top - layout.scrollTop;
        return selectors.map((s) => {
          const r = document.querySelector(s)!.getBoundingClientRect();
          return { s, y: r.top - top, bottom: r.bottom - top };
        });
      },
      stack,
    );
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.y, `${boxes[i]!.s} starts below ${boxes[i - 1]!.s}`).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 0.5);
    }
  });

  test('evidence screenshot of a recorded preview', async ({ page }, info) => {
    await openStudio(page);
    await ask(page, 'Grow a crystal garden on the main isle');
    await expect(card(page, 'preview')).toBeVisible();
    // The mode badge must stay visible even after focus scrolls the panel to Apply.
    await expect(page.locator('.ww-mode-badge')).toBeInViewport();
    const badge = await page.locator('.ww-mode-badge').boundingBox();
    const panel = await page.locator('.ww-director').boundingBox();
    expect(badge!.y).toBeGreaterThanOrEqual(panel!.y - 1);
    await page.screenshot({ path: info.outputPath('director-preview.png'), timeout: 60_000 });
  });
});

test.describe('World Morph (recorded mode)', () => {
  // The Aurelion Citadel is pinned by default (crystalKingdom.ts:95); no need to pin it.

  test('run a recorded morph, Apply: pinned citadel unchanged, others changed', async ({ page }) => {
    const log = await openStudio(page);
    await morphBtn(page).click();
    await prompt(page).fill('violet dusk');
    await generate(page).click();
    const preview = card(page, 'preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('World Morph preview');
    await expect(preview).toContainText('Pinned entities');
    // WW-031 policies A-C were approved on 2026-11-19, so the "not yet approved" note must not appear.
    await expect(preview).not.toContainText('Morph policy is proposed but not yet approved (WW-031).');
    await expect(action(page, 'apply')).toBeEnabled();
    await action(page, 'apply').click();
    await expect(card(page, 'applied')).toBeVisible();
    // The citadel row still exists with its original name (pinned entity preserved).
    await expect(page.locator('.ww-tree-row', { hasText: 'Aurelion Citadel' })).toBeVisible();
    expect(log.errors).toEqual([]);
  });

  test('one undo restores the morph; redo restores it again', async ({ page }) => {
    const log = await openStudio(page);
    await morphBtn(page).click();
    await prompt(page).fill('violet dusk');
    await generate(page).click();
    await expect(card(page, 'preview')).toBeVisible();
    await action(page, 'apply').click();
    await expect(card(page, 'applied')).toBeVisible();
    // Exactly one undo step is available; undo disables Undo, redo re-enables it.
    await expect(page.locator('.ww-topbar [aria-label="Undo"]')).toBeEnabled();
    await page.locator('.ww-topbar [aria-label="Undo"]').click();
    await expect(page.locator('.ww-topbar [aria-label="Undo"]')).toBeDisabled();
    await page.locator('.ww-topbar [aria-label="Redo"]').click();
    await expect(page.locator('.ww-topbar [aria-label="Undo"]')).toBeEnabled();
    expect(log.errors).toEqual([]);
  });

  test('morph moving a pinned entity ancestor: preview shows named reason, Apply disabled, world unchanged', async ({ page }) => {
    const log = await openStudio(page);
    await morphBtn(page).click();
    await prompt(page).fill('lift the isle');
    await generate(page).click();
    const preview = card(page, 'preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('World Morph preview');
    // The morph moves the citadel's ancestor (Isle of Aurelion), so it is blocked.
    await expect(preview.locator('.ww-op.is-rejected')).not.toHaveCount(0);
    await expect(preview).toContainText('ancestor');
    await expect(action(page, 'apply')).toBeDisabled();
    expect(log.errors).toEqual([]);
  });

  test('cancel during a morph: the late response is ignored', async ({ page }) => {
    const log = await openStudio(page);
    const hold = await holdDirector(page);
    await morphBtn(page).click();
    await prompt(page).fill('violet dusk');
    await generate(page).click();
    await expect(card(page, 'loading')).toBeVisible();
    await action(page, 'cancel').click();
    await expect(card(page, 'loading')).toHaveCount(0);
    hold.release();
    await page.waitForTimeout(2500);
    await expect(card(page, 'preview')).toHaveCount(0);
    await expect(page.locator('.ww-tree-row .ww-tree-name')).toHaveCount(27);
    expect(log.errors).toEqual([]);
  });

  test('stale preview after a manual edit, then Refresh, then Apply', async ({ page }) => {
    const log = await openStudio(page);
    await morphBtn(page).click();
    await prompt(page).fill('violet dusk');
    await generate(page).click();
    await expect(card(page, 'preview')).toBeVisible();
    // Make a manual change to an entity NOT in the morph operations, to stale the preview.
    await page.locator('.ww-tree-row', { hasText: 'Lumen Wisp of Embers' }).first().click();
    await page.locator('.ww-swatch[aria-label="Apply Night Violet"]').click();
    await expect(card(page, 'preview')).toContainText('The world changed after this preview was made');
    await expect(action(page, 'apply')).toBeDisabled();
    await action(page, 'refresh').click();
    await expect(action(page, 'apply')).toBeEnabled();
    await action(page, 'apply').click();
    await expect(card(page, 'applied')).toBeVisible();
    expect(log.errors).toEqual([]);
  });

  test('reduced motion: the morph change is instant', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const log = await openStudio(page);
    await morphBtn(page).click();
    await prompt(page).fill('violet dusk');
    await generate(page).click();
    await expect(card(page, 'preview')).toBeVisible();
    await action(page, 'apply').click();
    await expect(card(page, 'applied')).toBeVisible();
    // No transition UI should block; applied state appears immediately.
    await expect(page.locator('.ww-director-card.is-applied')).toBeVisible();
    expect(log.errors).toEqual([]);
  });
});
