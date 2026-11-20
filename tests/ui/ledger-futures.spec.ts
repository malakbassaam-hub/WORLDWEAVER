import { expect, test, type Page } from '@playwright/test';

/**
 * Causal Ledger and Parallel Futures panels on the recorded demo page.
 * The page has no 3D renderer; these tests cover the panels, the store and
 * the futures API through the real adapter.
 */

const SHOTS = 'test-results/ui-shots';

async function open(page: Page, scenario: 'history' | 'futures' | 'stale' | 'empty' = 'futures') {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/ledger-futures-demo.html?scenario=${scenario}`);
  await expect(page.getByRole('heading', { name: 'Causal Ledger', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Parallel Futures', exact: true })).toBeVisible();
  return errors;
}

const ledger = (page: Page) => page.locator('.ww-ledger');
const futures = (page: Page) => page.locator('.ww-futures');
const rows = (page: Page) => ledger(page).locator('button.ww-ledger-head');
const card = (page: Page, label: string) => futures(page).locator('.ww-future-card', { has: page.getByRole('heading', { name: label, exact: true }) });
const worldState = (page: Page) => page.getByTestId('world-state');

test.describe('Causal Ledger panel', () => {
  test('renders the real history in order with badges, batch info and undo state; console clean', async ({ page }) => {
    const errors = await open(page, 'history');
    await expect(page.locator('.ww-chip', { hasText: 'RECORDED' })).toBeVisible();
    await expect(rows(page)).toHaveCount(9);
    const indices = await rows(page).locator('.ww-ledger-index').allTextContents();
    expect(indices).toEqual(['#0', '#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8']);
    const badges = await rows(page).locator('.ww-lf-badge').allTextContents();
    expect(badges).toEqual(['User', 'Rejected', 'Director', 'User', 'Morph', 'Undo', 'Redo', 'User', 'Undo']);
    await expect(rows(page).nth(2)).toContainText(/actions, 1 step/);
    await expect(rows(page).nth(2)).toContainText('recorded');
    await expect(rows(page).nth(7).locator('.ww-ledger-status')).toHaveText('Undone');
    await expect(ledger(page).locator('.ww-ledger-row.is-genesis')).toContainText('Initial world');
    await page.screenshot({ path: `${SHOTS}/ledger-history.png`, fullPage: false });
    expect(errors).toEqual([]);
  });

  test('details separate recorded, observed and derived; model text is labelled; keyboard works', async ({ page }) => {
    await open(page, 'history');
    await rows(page).nth(8).focus();
    await page.keyboard.press('Home');
    await expect(rows(page).nth(0)).toBeFocused();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(rows(page).nth(3)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(rows(page).nth(3)).toHaveAttribute('aria-expanded', 'true');
    const detail = ledger(page).locator('.ww-ledger-detail').nth(3);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Recorded');
    await expect(detail).toContainText('Direct edit by you.');
    await expect(detail).toContainText('Observed changes');
    await expect(detail.locator('table.ww-ledger-fields')).toContainText('Position');
    await expect(detail).toContainText(/Derived by rule · \d+/);
    await expect(detail.locator('.ww-ledger-derived')).toContainText('via “Veilstone Reach”');
    await page.keyboard.press('Escape');
    await expect(rows(page).nth(3)).toHaveAttribute('aria-expanded', 'false');
    await expect(rows(page).nth(3)).toBeFocused();

    await rows(page).nth(4).click();
    const morph = ledger(page).locator('.ww-ledger-detail').nth(4);
    await expect(morph.locator('.ww-ledger-model')).toContainText('AI-written label · not a verified fact');
    await expect(morph).toContainText('World Morph proposal, recorded mode.');
    await expect(morph).toContainText(/in one atomic step/);
    await expect(morph.locator('.ww-lf-swatch').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/ledger-detail.png` });
  });

  test('filters and live updates from undo, redo and edits', async ({ page }) => {
    await open(page, 'history');
    const ai = ledger(page).locator('button.ww-ledger-filter', { hasText: 'AI' });
    await ai.click();
    await expect(ai).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(2);
    await ledger(page).locator('button.ww-ledger-filter', { hasText: 'Problems' }).click();
    await expect(rows(page)).toHaveCount(1);
    await ledger(page).locator('button.ww-ledger-filter', { hasText: 'All' }).click();

    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(rows(page)).toHaveCount(10);
    await expect(rows(page).nth(9).locator('.ww-lf-badge')).toHaveText('Redo');
    await expect(rows(page).nth(7).locator('.ww-ledger-status')).toHaveText('In effect');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(rows(page)).toHaveCount(11);
    await expect(rows(page).nth(7).locator('.ww-ledger-status')).toHaveText('Undone');
  });

  test('empty state', async ({ page }) => {
    await open(page, 'empty');
    await expect(ledger(page).locator('.ww-lf-state')).toContainText('No changes yet');
    await expect(futures(page).locator('.ww-lf-state').first()).toContainText('No futures yet');
  });
});

test.describe('Parallel Futures panel', () => {
  test('two futures, baseline and side-by-side comparison', async ({ page }) => {
    const errors = await open(page, 'futures');
    await expect(futures(page).locator('.ww-panel-meta')).toHaveText('2 of 4 open');
    await expect(futures(page).locator('.ww-futures-baseline')).toContainText('unchanged by previews and futures');
    await expect(card(page, 'Ember ruin')).toContainText('1 step');
    await expect(card(page, 'Raised spires')).toContainText('1 step');
    await expect(card(page, 'Ember ruin').locator('.ww-lf-badge', { hasText: 'pinned protected' })).toBeVisible();
    const table = futures(page).locator('table.ww-futures-table');
    await expect(table.locator('thead th')).toHaveText(['Object', 'Original', 'Ember ruin', 'Raised spires']);
    expect(await table.locator('tbody tr').count()).toBeGreaterThan(3);
    await expect(table.locator('tbody tr.is-contested').first()).toBeVisible();
    await futures(page).getByRole('button', { name: 'Only contested' }).click();
    const contested = await table.locator('tbody tr').count();
    expect(contested).toBe(await table.locator('tbody tr.is-contested').count());
    await futures(page).getByRole('button', { name: 'Only contested' }).click();
    await page.screenshot({ path: `${SHOTS}/futures-compare.png` });
    expect(errors).toEqual([]);
  });

  test('Preview never changes the real world; Apply is one undoable step; others go stale', async ({ page }) => {
    await open(page, 'futures');
    const before = await worldState(page).textContent();
    await card(page, 'Ember ruin').getByRole('button', { name: 'Preview' }).click();
    const bar = futures(page).locator('.ww-futures-previewbar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Previewing “Ember ruin”. The real world is unchanged.');
    await expect(bar).toContainText('3D viewport preview is not connected in this build');
    await expect(card(page, 'Ember ruin').getByRole('button', { name: 'Stop preview' })).toHaveAttribute('aria-pressed', 'true');
    await expect(worldState(page)).toHaveText(before!);
    await page.screenshot({ path: `${SHOTS}/futures-preview.png` });
    await bar.getByRole('button', { name: 'Back to the real world' }).click();
    await expect(bar).toBeHidden();
    await expect(worldState(page)).toHaveText(before!);

    const ledgerRowsBefore = await rows(page).count();
    await card(page, 'Ember ruin').getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(worldState(page)).not.toHaveText(before!);
    await expect(futures(page).locator('.ww-panel-meta')).toHaveText('1 of 4 open');
    await expect(rows(page)).toHaveCount(ledgerRowsBefore + 1);
    await expect(rows(page).last().locator('.ww-lf-badge')).toHaveText('Future');
    await expect(card(page, 'Raised spires').locator('.ww-lf-badge', { hasText: 'Stale' })).toBeVisible();
    await expect(card(page, 'Raised spires').getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await expect(card(page, 'Raised spires').getByRole('button', { name: 'Rebase' })).toBeVisible();

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(worldState(page)).toContainText(before!.split('state ')[1]!);
  });

  test('stale futures: Apply blocked with guidance; Rebase then Apply', async ({ page }) => {
    await open(page, 'stale');
    const ember = card(page, 'Ember ruin');
    await expect(ember.locator('.ww-lf-badge', { hasText: 'Stale' })).toBeVisible();
    await expect(ember.locator('.ww-future-blocked')).toContainText('Rebase or discard it.');
    await expect(ember.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/futures-stale.png` });
    await ember.getByRole('button', { name: 'Rebase' }).click();
    await expect(ember.locator('.ww-lf-badge', { hasText: 'Stale' })).toHaveCount(0);
    await expect(ember.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
    await ember.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(rows(page).last().locator('.ww-lf-badge')).toHaveText('Future');
  });

  test('four-future limit, keyboard creation, undo/redo of a step, discard', async ({ page }) => {
    await open(page, 'futures');
    const input = futures(page).getByRole('textbox', { name: 'Name for the new future' });
    await input.fill('Moonlit calm');
    await input.press('Enter');
    await expect(card(page, 'Moonlit calm')).toBeVisible();
    await futures(page).getByRole('button', { name: 'New future' }).click();
    await expect(futures(page).locator('.ww-panel-meta')).toHaveText('4 of 4 open');
    await expect(futures(page).getByRole('button', { name: 'New future' })).toBeDisabled();
    await expect(futures(page)).toContainText('Four futures are open, the maximum.');

    const ember = card(page, 'Ember ruin');
    await ember.getByRole('button', { name: 'Undo step' }).click();
    await expect(ember).toContainText('0 steps');
    await expect(ember.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await ember.getByRole('button', { name: 'Redo step' }).click();
    await expect(ember).toContainText('1 step');
    await card(page, 'Moonlit calm').getByRole('button', { name: 'Discard' }).click();
    await expect(futures(page).locator('.ww-panel-meta')).toHaveText('3 of 4 open');
    await expect(futures(page).getByRole('button', { name: 'New future' })).toBeEnabled();
  });

  test('Director inside a future (recorded proxy): a morph step, and pin protection feedback', async ({ page }) => {
    const errors = await open(page, 'futures');
    const before = await worldState(page).textContent();
    const spires = card(page, 'Raised spires');
    await spires.getByRole('combobox', { name: 'Director task' }).selectOption('morph');
    // Violet dusk is already applied to the real world in this demo, so it would be a no-op; Ember ruin is not.
    await spires.getByRole('textbox', { name: /Describe a change/ }).fill('ember ruin');
    await spires.getByRole('button', { name: 'Ask the Director' }).click();
    await expect(spires).toContainText('2 steps');
    await expect(spires.locator('.ww-future-steps li.is-model')).toHaveCount(2);
    await expect(worldState(page)).toHaveText(before!);

    const ember = card(page, 'Ember ruin');
    await ember.getByRole('textbox', { name: /Describe a change/ }).fill('recolour the pinned citadel');
    await ember.getByRole('button', { name: 'Ask the Director' }).click();
    await expect(ember.locator('.ww-future-error')).toContainText(/pinned/i);
    await expect(ember).toContainText('1 step');
    await expect(worldState(page)).toHaveText(before!);
    await page.screenshot({ path: `${SHOTS}/futures-director.png` });
    expect(errors).toEqual([]);
  });

  test('reduced motion turns off transitions; narrow layout has no horizontal page overflow', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'history');
    const duration = await rows(page).first().evaluate((el) => getComputedStyle(el).transitionDuration);
    // The studio stylesheet forces 0.01 ms under reduced motion (styles.css); treat anything at or below that as off.
    expect(duration.split(',').every((d) => parseFloat(d) <= 0.00001)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ledger-futures-demo.html?scenario=futures');
    await expect(page.getByRole('heading', { name: 'Parallel Futures', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/narrow.png`, fullPage: false });
  });
});
