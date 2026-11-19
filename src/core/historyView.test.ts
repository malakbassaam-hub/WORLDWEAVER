import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildWorldContext } from '../director/context';
import { applyMorph, translateMorph } from '../director/morph';
import { validateProposal } from '../director/validate';
import { createFuturesManager, snapshotRef } from './futures';
import { futureCards, futureCardsOf, inspectEntry, timelineItems } from './historyView';
import { buildLedger } from './ledger';
import { buildFuturePreview } from './presentation';
import { WorldStore } from './store';
import type { World } from './types';

const idOf = (w: World, ref: string) => buildWorldContext(w).refs.get(ref)!;

function morph(store: WorldStore, ops: unknown[]) {
  const r = validateProposal({ summary: 'Violet spires.', operations: ops });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const out = applyMorph(store, translateMorph(store.getState(), r.proposal), { mode: 'recorded' });
  if (!out.ok) throw new Error(out.reason);
}

describe('timeline view model', () => {
  it('gives one item per entry with badges, origins, in-effect state, undo targets and counts', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const isle = idOf(initial, 'e1');
    store.dispatch({ type: 'entity/transformed', id: isle, transform: { position: [0, 3, 0] }, source: 'user' }); // 0
    store.dispatch({ type: 'entity/renamed', id: isle, name: '', source: 'user' }); // 1 rejected
    morph(store, [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }]); // 2
    store.undo(); // 3
    const view = buildLedger(initial, [...store.getLog(), { kind: 'nonsense' }]);
    const items = timelineItems(view);
    expect(items.map((i) => i.badge)).toEqual(['User', 'Rejected', 'Morph', 'Undo', 'Malformed']);
    expect(items.map((i) => i.inEffect)).toEqual([true, null, false, null, null]);
    expect(items[2]).toMatchObject({ labelOrigin: 'model', mode: 'recorded', label: 'Morph (recorded): Violet spires.', counts: { changed: 1 } });
    expect(items[3]!.target).toBe(view.entries[2]!.id);
    expect(items[0]!.counts.derived).toBeGreaterThan(0);
    expect(items[1]!.reason).toBe('Name must not be empty.');
    expect(items[4]!.reason).toMatch(/^Malformed log entry/);
    expect(JSON.parse(JSON.stringify(items))).toEqual(items); // serialisable
  });

  it('is empty for an empty ledger', () => {
    expect(timelineItems(buildLedger(buildCrystalKingdom(), []))).toEqual([]);
  });
});

describe('entry inspection', () => {
  it('materialises before/after worlds and field values, with derived consequences listed separately', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const isle = idOf(initial, 'e1');
    store.dispatch({ type: 'entity/renamed', id: isle, name: 'First', source: 'user' });
    store.dispatch({ type: 'entity/transformed', id: isle, transform: { position: [0, 3, 0] }, source: 'user' });
    const log = store.getLog();
    const view = buildLedger(initial, log);
    const insp = inspectEntry(initial, log, view, 1)!;
    expect(insp.before.entities[isle]!.name).toBe('First');
    expect(insp.after).toEqual(store.getState());
    expect(insp.entities).toEqual([
      { id: isle, name: 'First', change: 'changed', fields: [
        { field: 'transform.position', before: initial.entities[isle]!.components.transform.position, after: [0, 3, 0] },
        { field: 'provenance', before: insp.before.entities[isle]!.provenance, after: store.getState().entities[isle]!.provenance },
      ] },
    ]);
    expect(insp.derived.length).toBeGreaterThan(0);
    expect(insp.derived.every((d) => d.basis === 'derived' && d.viaName === 'First')).toBe(true);
    expect(inspectEntry(initial, log, view, 9)).toBeNull();
  });
});

describe('futures panel and renderer preview contracts', () => {
  it('cards explain why a future cannot be committed, and flag contested entities', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const m = createFuturesManager(store, initial);
    const spire = idOf(initial, 'e4');
    const a = m.fork('A', { source: 'user' });
    const b = m.fork('B', { source: 'user' });
    const empty = m.fork('Empty', { source: 'user' });
    if (!a.ok || !b.ok || !empty.ok) throw new Error('setup');
    m.apply(a.value.id, [{ type: 'entity/renamed', id: spire, name: 'A name', source: 'user' }], { label: 'A' });
    m.apply(b.value.id, [{ type: 'entity/renamed', id: spire, name: 'B name', source: 'user' }], { label: 'B' });
    let cards = futureCardsOf(m);
    expect(cards.map((c) => [c.label, c.canCommit, c.blockedReason])).toEqual([
      ['A', true, null],
      ['B', true, null],
      ['Empty', false, 'No changes yet.'],
    ]);
    expect(cards[0]!.contested).toEqual([spire]);
    store.dispatch({ type: 'entity/renamed', id: idOf(initial, 'e5'), name: 'Meanwhile', source: 'user' });
    cards = futureCards(m.compareAll());
    expect(cards[0]).toMatchObject({ stale: true, canCommit: false, blockedReason: expect.stringMatching(/Rebase or discard/) });
    const past = m.forkFromSnapshot(snapshotRef(initial, store.getLog(), 0), 'Past', { source: 'user' });
    if (!past.ok) throw new Error(past.reason);
    m.apply(past.value.id, [{ type: 'entity/renamed', id: spire, name: 'Past', source: 'user' }], { label: 'P' });
    expect(futureCardsOf(m).at(-1)!.blockedReason).toMatch(/earlier snapshot/);
  });

  it('builds a renderer preview from the manager without touching the world', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const m = createFuturesManager(store, initial);
    const f = m.fork('Preview', { source: 'user' });
    if (!f.ok) throw new Error(f.reason);
    const isle = idOf(initial, 'e1');
    m.apply(f.value.id, [{ type: 'entity/transformed', id: isle, transform: { scale: [2, 2, 2] }, source: 'user' }, { type: 'entity/renamed', id: idOf(initial, 'e4'), name: 'Shown', source: 'user' }], { label: 'Step' });
    const p = buildFuturePreview(m, f.value.id)!;
    expect(p).toMatchObject({ kind: 'future-preview', label: 'Preview', changed: [isle, idOf(initial, 'e4')], added: [], removed: [], stale: false });
    expect(p.base).toBe(initial);
    expect(p.preview).toBe(m.state(f.value.id));
    expect(p.pinned).toEqual([idOf(initial, 'e2')]);
    expect(p.derived).toEqual([]); // scale is not inherited
    expect(store.getState()).toBe(initial);
    expect(buildFuturePreview(m, 'missing')).toBeNull();
    m.commit(f.value.id);
    expect(buildFuturePreview(m, f.value.id)).toBeNull();
  });
});
