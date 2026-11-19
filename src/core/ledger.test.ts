import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildWorldContext } from '../director/context';
import { applyMorph, translateMorph } from '../director/morph';
import { validateProposal } from '../director/validate';
import { deriveLedgerEntries, diffWorlds, explainEntity } from './ledger';
import { WorldStore } from './store';
import type { World } from './types';

function morph(store: WorldStore, ops: unknown[], recordingId = 'rec') {
  const r = validateProposal({ summary: 'Morph.', operations: ops });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const t = translateMorph(store.getState(), r.proposal);
  const out = applyMorph(store, t, { mode: 'recorded', recordingId });
  if (!out.ok) throw new Error(out.reason);
  return t;
}

const idOf = (w: World, ref: string) => buildWorldContext(w).refs.get(ref)!;

describe('Causal Ledger reference projection', () => {
  it('derives one entry per log entry with recorded causes and exact effects', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const spire = idOf(initial, 'e4');
    store.dispatch({ type: 'entity/renamed', id: spire, name: 'Hand Edit', source: 'user' }); // 0
    store.dispatch({ type: 'entity/renamed', id: spire, name: '', source: 'user' }); // 1 rejected
    const t = morph(store, [{ op: 'recolor', target: 'e6', palette: 'Night Violet' }, { op: 'add', archetype: 'obelisk', name: 'Ledger Stone', placement: 'outer-ring' }]); // 2
    store.undo(); // 3 reverses 2
    store.redo(); // 4 reapplies 2
    store.undo(); // 5 reverses 2
    store.undo(); // 6 reverses 0

    const entries = deriveLedgerEntries(initial, store.getLog());
    expect(entries).toHaveLength(7);
    expect(entries[0]).toMatchObject({ accepted: true, cause: { type: 'event', source: 'user' }, effects: { added: [], removed: [], changed: [spire] } });
    expect(entries[1]).toMatchObject({ accepted: false, effects: { added: [], removed: [], changed: [] } });
    const added = t.events.flatMap((e) => (e.type === 'entity/added' ? [e.entity.id] : []));
    expect(entries[2]).toMatchObject({
      accepted: true,
      cause: { type: 'proposal', source: 'director', kind: 'morph', mode: 'recorded', recordingId: 'rec', proposalKey: t.proposalKey },
      effects: { added, removed: [], changed: [idOf(initial, 'e6')] },
    });
    expect(entries[3]).toMatchObject({ cause: { type: 'undo', reverses: 2 }, effects: { added: [], removed: added, changed: [idOf(initial, 'e6')] } });
    expect(entries[4]).toMatchObject({ cause: { type: 'redo', reapplies: 2 }, effects: { added } });
    expect(entries[5]).toMatchObject({ cause: { type: 'undo', reverses: 2 } });
    expect(entries[6]).toMatchObject({ cause: { type: 'undo', reverses: 0 }, effects: { changed: [spire] } });
    // seq bookkeeping matches the live store
    expect(entries.at(-1)!.seqAfter).toBe(store.getState().seq);
  });

  it('explainEntity returns only accepted entries that actually touched the entity', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    morph(store, [{ op: 'recolor', target: 'e6', palette: 'Night Violet' }]);
    morph(store, [{ op: 'recolor', target: 'e8', palette: 'Night Violet' }]);
    morph(store, [{ op: 'glow', target: 'e6', glow: 5 }]);
    const entries = deriveLedgerEntries(initial, store.getLog());
    expect(explainEntity(entries, idOf(initial, 'e6')).map((e) => e.index)).toEqual([0, 2]);
    expect(explainEntity(entries, idOf(initial, 'e2'))).toEqual([]); // pinned citadel never touched
  });

  it('respects the history limit when tracking undo targets', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial, { historyLimit: 1 });
    const id = idOf(initial, 'e4');
    store.dispatch({ type: 'entity/renamed', id, name: 'A', source: 'user' }); // 0
    store.dispatch({ type: 'entity/renamed', id, name: 'B', source: 'user' }); // 1
    store.undo(); // 2 reverses 1
    expect(store.undo()).toBe(false); // history limit reached: the store does not log a failed undo
    const entries = deriveLedgerEntries(initial, store.getLog(), { historyLimit: 1 });
    expect(entries).toHaveLength(3);
    expect(entries[2]!.cause).toEqual({ type: 'undo', reverses: 1 });
    expect(entries[2]!.effects.changed).toEqual([id]);
  });

  it('diffWorlds is empty for identical worlds', () => {
    const w = buildCrystalKingdom();
    expect(diffWorlds(w, w)).toEqual({ added: [], removed: [], changed: [] });
  });
});
