import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildWorldContext } from '../director/context';
import { applyMorph, translateMorph } from '../director/morph';
import { validateProposal } from '../director/validate';
import { stateRef, worldFingerprint } from './fingerprint';
import { compareWorlds, createFuturesManager, FUTURE_LIMITS, restoreSnapshot, snapshotRef, type FuturesManager } from './futures';
import { buildLedger } from './ledger';
import { checkPinnedInvariant } from './pins';
import { createRng } from './random';
import { applyEvents, createEmptyWorld } from './reducer';
import { WorldStore } from './store';
import { asEntityId, type EntityId, type World, type WorldEvent } from './types';

const idOf = (w: World, ref: string) => buildWorldContext(w).refs.get(ref)!;
const rename = (id: EntityId, name: string, source: WorldEvent['source'] = 'user'): WorldEvent => ({ type: 'entity/renamed', id, name, source });
const recolor = (id: EntityId, color: `#${string}`, source: WorldEvent['source'] = 'user'): WorldEvent => ({ type: 'entity/visualChanged', id, patch: { color }, source });

function setup() {
  const initial = buildCrystalKingdom();
  const store = new WorldStore(initial);
  const manager = createFuturesManager(store, initial);
  return { initial, store, manager, spire: idOf(initial, 'e4'), spire2: idOf(initial, 'e5'), isle: idOf(initial, 'e1'), citadel: idOf(initial, 'e2') };
}

function forkOk(m: FuturesManager, label: string, source: WorldEvent['source'] = 'user') {
  const r = m.fork(label, { source });
  if (!r.ok) throw new Error(r.reason);
  return r.value.id;
}

function step(m: FuturesManager, id: string, events: WorldEvent[], label = 'Step') {
  const r = m.apply(id, events, { label });
  if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
  return r.value;
}

function morph(store: WorldStore, ops: unknown[]) {
  const r = validateProposal({ summary: 'Morph.', operations: ops });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const out = applyMorph(store, translateMorph(store.getState(), r.proposal), { mode: 'recorded' });
  if (!out.ok) throw new Error(out.reason);
}

describe('snapshots', () => {
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

describe('compareWorlds', () => {
  it('lists field-level differences and derived consequences deterministically', () => {
    const w = buildCrystalKingdom();
    const isle = idOf(w, 'e1');
    const r = applyEvents(w, [rename(idOf(w, 'e4'), 'Changed'), { type: 'entity/transformed', id: isle, transform: { position: [0, 2, 0] }, source: 'user' }]);
    if (!r.ok) throw new Error(r.reason);
    const c = compareWorlds(w, r.world);
    expect(c.identical).toBe(false);
    expect(c.differences.map((d) => [d.change, d.fields])).toEqual([
      ['changed', ['transform.position', 'provenance']],
      ['changed', ['name', 'provenance']],
    ]);
    expect(c.derived.every((d) => d.basis === 'derived' && d.via === isle)).toBe(true);
    expect(c.from).toEqual(stateRef(w));
    expect(JSON.stringify(compareWorlds(w, r.world))).toBe(JSON.stringify(c));
    expect(compareWorlds(w, w).identical).toBe(true);
  });
});

describe('Parallel Futures: isolation', () => {
  it('creating, changing, undoing, comparing and discarding a future never touches the original', () => {
    const { store, manager, spire } = setup();
    const before = store.getState();
    const logLength = store.getLog().length;
    const id = forkOk(manager, 'Isolated');
    step(manager, id, [rename(spire, 'Only In Future')]);
    manager.undo(id);
    manager.redo(id);
    manager.compare(id);
    manager.compareAll();
    expect(manager.state(id)!.entities[spire]!.name).toBe('Only In Future');
    manager.discard(id);
    expect(store.getState()).toBe(before);
    expect(store.getLog()).toHaveLength(logLength);
  });

  it('two futures from the same snapshot produce different valid outcomes; the original is unchanged', () => {
    const { store, manager, spire, spire2 } = setup();
    const original = store.getState();
    const a = forkOk(manager, 'Violet');
    const b = forkOk(manager, 'Ember');
    step(manager, a, [recolor(spire, '#7a5cff')]);
    step(manager, b, [recolor(spire, '#ff8a3d'), rename(spire2, 'Ember Spire')]);
    expect(manager.get(a)!.base).toEqual(manager.get(b)!.base);
    const all = manager.compareAll();
    expect(all.futures.map((f) => f.comparison.changed.length)).toEqual([1, 2]);
    expect(all.contested).toEqual([spire]);
    expect(compareWorlds(manager.state(a)!, manager.state(b)!).identical).toBe(false);
    expect(store.getState()).toBe(original);
  });

  it("a future's state is exactly the base plus its step events, and shares unchanged entities with the base", () => {
    const { manager, spire, spire2 } = setup();
    const id = forkOk(manager, 'Exact');
    const s1 = [rename(spire, 'One')];
    const s2 = [recolor(spire2, '#112233'), rename(spire2, 'Two')];
    step(manager, id, s1);
    step(manager, id, s2);
    const base = manager.base(id)!;
    const expected = applyEvents(base, [...s1, ...s2]);
    if (!expected.ok) throw new Error('setup');
    expect(JSON.stringify(manager.state(id))).toBe(JSON.stringify(expected.world));
    const state = manager.state(id)!;
    const shared = base.order.filter((e) => state.entities[e] === base.entities[e]).length;
    expect(shared).toBe(base.order.length - 2);
  });
});

describe('Parallel Futures: validation of steps', () => {
  it('rejects malformed, foreign-source, reducer-invalid and empty steps, leaving the future unchanged', () => {
    const { manager, spire } = setup();
    const id = forkOk(manager, 'Strict');
    step(manager, id, [rename(spire, 'Kept')]);
    const before = manager.get(id)!;
    const cases: Array<[unknown[], string]> = [
      [[{ type: 'entity/renamed', id: spire, source: 'user' }], 'MALFORMED'],
      [[{ type: 'entity/added', source: 'user' }], 'MALFORMED'],
      [[rename(spire, 'AI', 'director')], 'SOURCE'],
      [[rename(spire, '')], 'REJECTED'],
      [[rename(spire, 'Fine'), rename(asEntityId('missing'), 'x')], 'REJECTED'],
      [[], 'EMPTY'],
    ];
    for (const [events, code] of cases) {
      const r = manager.apply(id, events as WorldEvent[], { label: 'Bad' });
      expect(r, code).toMatchObject({ ok: false, code });
      expect(manager.get(id)).toEqual(before);
    }
    expect(manager.apply(id, [rename(spire, 'x')], { label: '' })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(manager.apply(id, [rename(spire, 'x')], { label: 'ok', details: { n: 1 as unknown as string } })).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('protects pinned entities and their ancestors in every future, whatever the source (WW-031)', () => {
    const { manager, isle, citadel } = setup();
    const id = forkOk(manager, 'Pins');
    const refused: Array<[WorldEvent, string]> = [
      [rename(citadel, 'Changed Citadel'), 'data'],
      [{ type: 'entity/pinnedChanged', id: citadel, pinned: false, source: 'user' }, 'data'],
      [{ type: 'entity/transformed', id: isle, transform: { position: [5, 0, 0] }, source: 'user' }, 'pose'],
      [{ type: 'entity/transformed', id: isle, transform: { rotation: [0, 1, 0] }, source: 'user' }, 'pose'],
      [{ type: 'entity/visualChanged', id: isle, patch: { visible: false }, source: 'user' }, 'visibility'],
    ];
    for (const [event, kind] of refused) {
      const r = manager.apply(id, [event], { label: 'Pin attempt' });
      expect(r, kind).toMatchObject({ ok: false, code: 'PINNED' });
      if (!r.ok) expect(r.violations!.map((v) => v.kind)).toContain(kind);
    }
    expect(manager.get(id)!.eventCount).toBe(0);
    // Policy C: a new child under the pinned citadel is allowed.
    const child: WorldEvent = {
      type: 'entity/added', source: 'user',
      entity: { id: asEntityId('user:lantern'), name: 'Lantern', kind: 'light', parentId: citadel, tags: [], pinned: false, components: { transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } },
    };
    expect(manager.apply(id, [child], { label: 'Add lantern' }).ok).toBe(true);
    // Scale of an ancestor is not inherited, so it is allowed.
    expect(manager.apply(id, [{ type: 'entity/transformed', id: isle, transform: { scale: [1.5, 1.5, 1.5] }, source: 'user' }], { label: 'Scale isle' }).ok).toBe(true);
  });

  it('enforces the future, step and label limits', () => {
    const { manager, spire } = setup();
    const ids = Array.from({ length: FUTURE_LIMITS.maxFutures }, (_, i) => forkOk(manager, `F${i}`));
    expect(manager.fork('One too many')).toMatchObject({ ok: false, code: 'LIMIT' });
    manager.discard(ids[0]!);
    expect(manager.fork('Room again').ok).toBe(true);
    const id = ids[1]!;
    for (let i = 0; i < FUTURE_LIMITS.maxStepsPerFuture; i++) step(manager, id, [rename(spire, `Name ${i}`)]);
    expect(manager.apply(id, [rename(spire, 'Overflow')], { label: 'Too many' })).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(manager.fork('')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(manager.fork('x'.repeat(FUTURE_LIMITS.maxLabelLength + 1))).toMatchObject({ ok: false, code: 'INVALID' });
    expect(manager.fork('bidi\u202eattack')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(manager.fork('Dup', { id: ids[2]! })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(manager.fork('Bad id', { id: 'has space' })).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('caps events per future at the store batch limit', () => {
    const { manager, spire } = setup();
    const id = forkOk(manager, 'Big');
    const many = Array.from({ length: FUTURE_LIMITS.maxEventsPerFuture + 1 }, (_, i) => rename(spire, `N${i}`));
    expect(manager.apply(id, many, { label: 'Huge' })).toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('supports undo and redo inside a future; a new step clears redo', () => {
    const { manager, spire } = setup();
    const id = forkOk(manager, 'History');
    step(manager, id, [rename(spire, 'A')]);
    step(manager, id, [rename(spire, 'B')]);
    expect(manager.undo(id)).toBe(true);
    expect(manager.state(id)!.entities[spire]!.name).toBe('A');
    expect(manager.redo(id)).toBe(true);
    expect(manager.state(id)!.entities[spire]!.name).toBe('B');
    manager.undo(id);
    step(manager, id, [rename(spire, 'C')]);
    expect(manager.get(id)!.canRedo).toBe(false);
    expect(manager.redo(id)).toBe(false);
    manager.undo(id);
    manager.undo(id);
    expect(manager.undo(id)).toBe(false);
    expect(compareWorlds(manager.base(id)!, manager.state(id)!).identical).toBe(true);
  });
});

describe('Parallel Futures: commit (selection)', () => {
  it('commits one future atomically as one undo step that reproduces the preview exactly', () => {
    const { initial, store, manager, spire, spire2 } = setup();
    const id = forkOk(manager, 'Chosen');
    step(manager, id, [rename(spire, 'Chosen Spire')], 'Rename');
    step(manager, id, [recolor(spire2, '#abcdef')], 'Recolour');
    const preview = manager.state(id)!;
    const base = store.getState();
    const r = manager.commit(id);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(store.getState())).toBe(JSON.stringify(preview));
    expect(store.getLog()).toHaveLength(1);
    expect(store.getLog()[0]).toMatchObject({ kind: 'batch', ok: true, meta: { label: 'Future: Chosen', source: 'user', details: { kind: 'future', futureId: id, steps: '2', baseSeq: String(base.seq) } } });
    expect(manager.get(id)!.status).toBe('committed');
    expect(manager.list()).toEqual([]);
    store.undo();
    expect(worldFingerprint(store.getState())).toBe(worldFingerprint(base));
    store.redo();
    expect(worldFingerprint(store.getState())).toBe(worldFingerprint(preview));
    const ledger = buildLedger(initial, store.getLog());
    expect(ledger.entries[0]!.cause).toMatchObject({ type: 'future', futureId: id, baseSeq: base.seq, steps: 2 });
    expect(ledger.consistent).toBe(true);
  });

  it('selecting one future never applies another; the others become stale', () => {
    const { store, manager, spire, spire2 } = setup();
    const a = forkOk(manager, 'A');
    const b = forkOk(manager, 'B');
    step(manager, a, [rename(spire, 'From A')]);
    step(manager, b, [rename(spire2, 'From B')]);
    expect(manager.commit(a).ok).toBe(true);
    const after = store.getState();
    expect(after.entities[spire]!.name).toBe('From A');
    expect(after.entities[spire2]!.name).not.toBe('From B');
    expect(manager.get(b)!.stale).toBe(true);
    expect(manager.commit(b)).toMatchObject({ ok: false, code: 'STALE' });
    expect(store.getState()).toBe(after);
  });

  it('refuses stale, empty, closed, unknown and pin-violating commits without touching the store', () => {
    const { store, manager, spire, spire2 } = setup();
    const id = forkOk(manager, 'Will go stale');
    step(manager, id, [rename(spire, 'Future')]);
    expect(manager.commit(forkOk(manager, 'Empty'))).toMatchObject({ ok: false, code: 'EMPTY' });
    store.dispatch(rename(spire2, 'Meanwhile'));
    const before = store.getState();
    const logLength = store.getLog().length;
    expect(manager.get(id)!.stale).toBe(true);
    expect(manager.commit(id)).toMatchObject({ ok: false, code: 'STALE' });
    expect(manager.commit('nope')).toMatchObject({ ok: false, code: 'UNKNOWN_FUTURE' });
    expect(store.getState()).toBe(before);
    expect(store.getLog()).toHaveLength(logLength);
    // Undo in the original also makes a future stale (every undo consumes a seq).
    const fresh = forkOk(manager, 'Fresh');
    step(manager, fresh, [rename(spire, 'Fresh')]);
    store.undo();
    expect(manager.commit(fresh)).toMatchObject({ ok: false, code: 'STALE' });
    // Commit twice / after discard.
    const twice = forkOk(manager, 'Twice');
    step(manager, twice, [rename(spire, 'Twice')]);
    expect(manager.commit(twice).ok).toBe(true);
    expect(manager.commit(twice)).toMatchObject({ ok: false, code: 'CLOSED' });
    expect(manager.discard(twice)).toBe(false);
  });

  it('rebases a stale future onto the current world, then commits it', () => {
    const { store, manager, spire, spire2 } = setup();
    const id = forkOk(manager, 'Rebase me');
    step(manager, id, [rename(spire, 'Rebased')]);
    store.dispatch(rename(spire2, 'Meanwhile'));
    const r = manager.rebase(id);
    expect(r.ok).toBe(true);
    expect(manager.get(id)!.stale).toBe(false);
    expect(manager.state(id)!.entities[spire2]!.name).toBe('Meanwhile');
    expect(manager.commit(id).ok).toBe(true);
    expect(store.getState().entities[spire]!.name).toBe('Rebased');
    expect(store.getState().entities[spire2]!.name).toBe('Meanwhile');
  });

  it('a rebase that no longer applies leaves the future exactly as it was', () => {
    const { store, manager, spire } = setup();
    const id = forkOk(manager, 'Doomed');
    step(manager, id, [rename(spire, 'Renamed in future')]);
    const before = manager.get(id)!;
    store.dispatch({ type: 'entity/removed', id: spire, source: 'user' });
    expect(manager.rebase(id)).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(manager.get(id)).toEqual({ ...before, stale: true });
  });

  it('a rebase that would now change a newly pinned entity is refused (pins of the new base apply)', () => {
    const { store, manager, spire } = setup();
    const id = forkOk(manager, 'Pinned later');
    step(manager, id, [rename(spire, 'Renamed')]);
    store.dispatch({ type: 'entity/pinnedChanged', id: spire, pinned: true, source: 'user' });
    expect(manager.rebase(id)).toMatchObject({ ok: false, code: 'PINNED' });
  });
});

describe('Parallel Futures: verified snapshots', () => {
  it('refuses to fork when the store does not replay from the given initial world', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    store.dispatch(rename(idOf(initial, 'e4'), 'Edited'));
    const wrong = createFuturesManager(store, createEmptyWorld({ id: 'x', name: 'X', biome: 'b', seed: 1 }));
    expect(wrong.fork('Unverified')).toMatchObject({ ok: false, code: 'UNVERIFIED' });
  });

  it('forks from an earlier snapshot for exploration; committing needs a rebase', () => {
    const { initial, store, manager, spire, spire2 } = setup();
    store.dispatch(rename(spire2, 'First'));
    store.dispatch(rename(spire2, 'Second'));
    const r = manager.forkFromSnapshot(snapshotRef(initial, store.getLog(), 1), 'From the past', { source: 'user' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.fromSnapshot).toBe(true);
    expect(manager.base(r.value.id)!.entities[spire2]!.name).toBe('First');
    expect(r.value.stale).toBe(true);
    step(manager, r.value.id, [rename(spire, 'Past branch')]);
    expect(manager.commit(r.value.id)).toMatchObject({ ok: false, code: 'STALE' });
    expect(manager.rebase(r.value.id).ok).toBe(true);
    expect(manager.commit(r.value.id).ok).toBe(true);
    expect(store.getState().entities[spire2]!.name).toBe('Second');
    const tampered = store.getLog().map((e) => ({ ...e, ok: !e.ok }));
    expect(manager.forkFromSnapshot(snapshotRef(initial, tampered), 'Bad')).toMatchObject({ ok: false, code: 'UNVERIFIED' });
  });

  it('works on an empty world', () => {
    const initial = createEmptyWorld({ id: 'void', name: 'Void', biome: 'void', seed: 3 });
    const store = new WorldStore(initial);
    const manager = createFuturesManager(store, initial);
    const id = forkOk(manager, 'Genesis');
    step(manager, id, [{ type: 'entity/added', source: 'user', entity: { id: asEntityId('first'), name: 'First Isle', kind: 'island', parentId: null, tags: [], pinned: false, components: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } } }]);
    expect(manager.compare(id)).toMatchObject({ ok: true, value: { comparison: { added: ['first'] }, violations: [], pinned: [] } });
    expect(manager.commit(id).ok).toBe(true);
    expect(store.getState().order).toEqual(['first']);
  });

  it('dispose discards every future and releases its states', () => {
    const { manager, spire } = setup();
    const id = forkOk(manager, 'Temp');
    step(manager, id, [rename(spire, 'Temp')]);
    manager.dispose();
    expect(manager.list()).toEqual([]);
    expect(manager.state(id)).toBeNull();
    expect(manager.get(id)).toBeNull();
  });
});

describe('property: random futures', () => {
  it('80 seeded runs: original untouched until commit; preview = base + events; commit reproduces preview; pins hold', () => {
    const rng = createRng(0xf07e5);
    let commits = 0;
    let refusals = 0;
    for (let run = 0; run < 80; run++) {
      const { store, manager } = setup();
      const original = store.getState();
      const ids = Array.from({ length: rng.int(1, 3) }, (_, i) => forkOk(manager, `R${run}-${i}`));
      for (let k = 0; k < 12; k++) {
        const id = rng.pick(ids);
        const w = manager.state(id)!;
        const target = rng.pick(w.order);
        const choice = rng.int(0, 5);
        if (choice === 0) manager.undo(id);
        else if (choice === 1) manager.redo(id);
        else {
          const event: WorldEvent =
            choice === 2 ? rename(target, `N${k}`)
            : choice === 3 ? { type: 'entity/transformed', id: target, transform: { position: [rng.int(-4, 4), rng.int(0, 3), rng.int(-4, 4)] }, source: 'user' }
            : choice === 4 ? { type: 'entity/visualChanged', id: target, patch: { visible: rng.next() < 0.5 }, source: 'user' }
            : { type: 'entity/removed', id: target, source: 'user' };
          const r = manager.apply(id, [event], { label: 'Random' });
          if (!r.ok) refusals += 1;
        }
        expect(store.getState()).toBe(original);
      }
      for (const id of ids) {
        const base = manager.base(id)!;
        const state = manager.state(id)!;
        expect(checkPinnedInvariant(base, state)).toEqual([]);
      }
      const chosen = rng.pick(ids);
      const preview = manager.state(chosen)!;
      const result = manager.commit(chosen);
      if (result.ok) {
        commits += 1;
        expect(JSON.stringify(store.getState())).toBe(JSON.stringify(preview));
        for (const other of ids) if (other !== chosen) expect(manager.get(other)!.stale).toBe(true);
      } else {
        expect(result.code).toBe('EMPTY');
        expect(store.getState()).toBe(original);
      }
    }
    expect(commits).toBeGreaterThan(50);
    expect(refusals).toBeGreaterThan(20);
  });
});
