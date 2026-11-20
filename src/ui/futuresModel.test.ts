import { describe, expect, it } from 'vitest';
import { worldFingerprint } from '../core/fingerprint';
import { futureCardsOf } from '../core/historyView';
import { buildDemoWithFutures } from '../demo/fixtures';
import { cardSummary, comparisonMatrix, createAvailability, defaultFutureLabel, errorText, MAX_FUTURES } from './futuresModel';

describe('comparison matrix', () => {
  it('lists every object a future changes, with per-future cells and original values, without touching any world', () => {
    const { store, manager, futureIds } = buildDemoWithFutures('futures');
    const original = store.getState();
    const fp = worldFingerprint(original);
    const futures = futureIds.map((id) => ({ id, label: manager.get(id)!.label, world: manager.state(id)! }));
    const m = comparisonMatrix(original, futures);
    expect(m.columns.map((c) => c.label)).toEqual(['Ember ruin', 'Raised spires']);
    expect(m.rows.length).toBeGreaterThan(3);
    for (const row of m.rows) {
      expect(row.cells).toHaveLength(2);
      expect(row.cells.some((c) => c.change !== 'same')).toBe(true);
      for (const c of row.cells) for (const f of c.fields) expect(f.field).not.toBe('provenance');
    }
    expect(m.unchanged + m.rows.filter((r) => r.inOriginal).length).toBe(original.order.length);
    expect(worldFingerprint(store.getState())).toBe(fp);
    expect(store.getState()).toBe(original);
  });

  it('flags contested objects, additions, pinned rows and derived cells', () => {
    const { store, manager, futureIds } = buildDemoWithFutures('futures');
    const original = store.getState();
    const futures = futureIds.map((id) => ({ id, label: manager.get(id)!.label, world: manager.state(id)! }));
    const m = comparisonMatrix(original, futures);
    const contested = m.rows.filter((r) => r.contested);
    const cards = futureCardsOf(manager);
    expect(contested.map((r) => r.id).sort()).toEqual([...new Set(cards.flatMap((c) => c.contested))].sort());
    expect(m.rows.some((r) => !r.inOriginal && r.cells.some((c) => c.change === 'added'))).toBe(true);
    expect(m.rows.every((r) => !r.pinned || r.cells.every((c) => c.change === 'same' || c.change === 'derived'))).toBe(true);
  });

  it('is empty when no future differs, and deterministic', () => {
    const { store, manager } = buildDemoWithFutures('history');
    const f = manager.fork('Blank', { source: 'user' });
    if (!f.ok) throw new Error(f.reason);
    const one = comparisonMatrix(store.getState(), [{ id: f.value.id, label: 'Blank', world: manager.state(f.value.id)! }]);
    expect(one.rows).toEqual([]);
    const a = buildDemoWithFutures('futures');
    const b = buildDemoWithFutures('futures');
    const mk = (x: typeof a) => comparisonMatrix(x.store.getState(), x.futureIds.map((id) => ({ id, label: x.manager.get(id)!.label, world: x.manager.state(id)! })));
    expect(JSON.stringify(mk(a))).toBe(JSON.stringify(mk(b)));
  });
});

describe('wording and limits', () => {
  it('default labels fill A to D; creation is refused at four open futures', () => {
    expect(defaultFutureLabel([])).toBe('Future A');
    expect(defaultFutureLabel(['Future A', 'Future C'])).toBe('Future B');
    expect(createAvailability(MAX_FUTURES - 1)).toEqual({ ok: true, reason: null });
    expect(createAvailability(MAX_FUTURES).ok).toBe(false);
    expect(MAX_FUTURES).toBe(4);
  });

  it('the panel limit matches the manager limit', () => {
    const { manager } = buildDemoWithFutures('futures');
    expect(manager.fork('C', { source: 'user' }).ok).toBe(true);
    expect(manager.fork('D', { source: 'user' }).ok).toBe(true);
    const fifth = manager.fork('E', { source: 'user' });
    expect(fifth).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(createAvailability(manager.list().length).ok).toBe(false);
  });

  it('error text adds a plain headline and keeps the specific reason', () => {
    expect(errorText('STALE', 'Rebase or discard it.')).toBe('The real world changed after this future was created. Rebase or discard it.');
    expect(errorText('PINNED', 'Pinned “Aurelion Citadel” would move in the world.')).toBe('Pinned objects are protected. Pinned “Aurelion Citadel” would move in the world.');
    expect(errorText('WHATEVER', 'Exact reason.')).toBe('Exact reason.');
  });

  it('card summaries count steps and changes', () => {
    const { manager } = buildDemoWithFutures('futures');
    const [ember] = futureCardsOf(manager);
    expect(cardSummary(ember!)).toMatch(/^1 step · \d+ changed/);
  });
});
