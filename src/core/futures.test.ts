import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { applyMorph, checkPinnedInvariant, translateMorph } from '../director/morph';
import { validateProposal } from '../director/validate';
import { compareWorlds, forkFuture, restoreSnapshot, snapshotRef } from './futures';
import { WorldStore } from './store';

function morph(store: WorldStore, ops: unknown[]) {
  const r = validateProposal({ summary: 'Branch morph.', operations: ops });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const out = applyMorph(store, translateMorph(store.getState(), r.proposal), { mode: 'recorded' });
  if (!out.ok) throw new Error(out.reason);
}

describe('Parallel Futures contract', () => {
  it('forks two independent futures from one snapshot without touching the original', () => {
    const initial = buildCrystalKingdom();
    const original = new WorldStore(initial);
    morph(original, [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }]);
    const ref = snapshotRef(initial, original.getLog());
    const originalState = original.getState();

    const violet = forkFuture('f-violet', 'Violet', ref);
    const ember = forkFuture('f-ember', 'Ember', ref);
    morph(violet.store, [{ op: 'recolor', target: 'e1', palette: 'Night Violet' }]);
    morph(ember.store, [{ op: 'recolor', target: 'e5', palette: 'Ember Gold' }, { op: 'hide', target: 'e23' }]);

    expect(original.getState()).toBe(originalState);
    const diff = compareWorlds(violet.store.getState(), ember.store.getState());
    expect(diff.identical).toBe(false);
    expect(diff.changed.length).toBeGreaterThanOrEqual(3);
    for (const branch of [violet, ember]) expect(checkPinnedInvariant(initial, branch.store.getState())).toEqual([]);
    expect(violet.store.canUndo()).toBe(true);
    violet.store.undo();
    expect(compareWorlds(violet.store.getState(), originalState).identical).toBe(true);
  });

  it('restores any earlier snapshot deterministically', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    morph(store, [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }]);
    const afterFirst = store.getState();
    morph(store, [{ op: 'recolor', target: 'e6', palette: 'Night Violet' }]);
    const at1 = restoreSnapshot(snapshotRef(initial, store.getLog(), 1));
    expect(JSON.stringify(at1)).toBe(JSON.stringify(afterFirst));
    expect(JSON.stringify(restoreSnapshot(snapshotRef(initial, store.getLog(), 1)))).toBe(JSON.stringify(at1));
    expect(compareWorlds(restoreSnapshot(snapshotRef(initial, store.getLog(), 0)), initial).identical).toBe(true);
  });

  it('rejects invalid snapshot points and logs that no longer replay', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    morph(store, [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }]);
    expect(() => snapshotRef(initial, store.getLog(), 5)).toThrow(RangeError);
    expect(() => snapshotRef(initial, store.getLog(), -1)).toThrow(RangeError);
    const tampered = store.getLog().map((e) => ({ ...e, ok: !e.ok }));
    expect(() => restoreSnapshot(snapshotRef(initial, tampered))).toThrow(/does not replay/);
  });
});
