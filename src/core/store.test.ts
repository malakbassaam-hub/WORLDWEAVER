import { describe, expect, it } from 'vitest';
import { replay } from './replay';
import { WorldStore } from './store';
import type { WorldEvent } from './types';
import { buildCrystalKingdom, crystalKingdomEvents, CRYSTAL_KINGDOM_SEED } from '../worlds/crystalKingdom';
import { createEmptyWorld } from './reducer';

describe('Crystal Kingdom generation', () => {
  it('is deterministic for the same seed', () => {
    const a = buildCrystalKingdom(CRYSTAL_KINGDOM_SEED);
    const b = buildCrystalKingdom(CRYSTAL_KINGDOM_SEED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('differs for a different seed but keeps stable entity ids', () => {
    const a = buildCrystalKingdom(1);
    const b = buildCrystalKingdom(2);
    expect(a.order).toEqual(b.order);
    expect(JSON.stringify(a.entities)).not.toBe(JSON.stringify(b.entities));
  });

  it('has a pinned focal point and parents before children', () => {
    const w = buildCrystalKingdom();
    const citadel = Object.values(w.entities).find((e) => e.tags.includes('focal-point'));
    expect(citadel?.pinned).toBe(true);
    w.order.forEach((id, index) => {
      const parent = w.entities[id]?.parentId;
      if (parent) expect(w.order.indexOf(parent)).toBeLessThan(index);
    });
    expect(w.order.length).toBeGreaterThanOrEqual(20);
  });
});

describe('WorldStore', () => {
  const firstEditable = (store: WorldStore) => {
    const w = store.getState();
    const e = Object.values(w.entities).find((x) => !x.pinned && x.kind === 'crystal');
    if (!e) throw new Error('no editable entity');
    return e.id;
  };

  it('applies, undoes and redoes with a monotonic seq', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const id = firstEditable(store);
    const original = store.getState().entities[id]?.name;
    const seq0 = store.getState().seq;

    expect(store.dispatch({ type: 'entity/renamed', id, name: 'Renamed', source: 'user' }).ok).toBe(true);
    expect(store.getState().entities[id]?.name).toBe('Renamed');

    expect(store.undo()).toBe(true);
    expect(store.getState().entities[id]?.name).toBe(original);
    expect(store.canRedo()).toBe(true);

    expect(store.redo()).toBe(true);
    expect(store.getState().entities[id]?.name).toBe('Renamed');
    expect(store.getState().seq).toBe(seq0 + 3);
  });

  it('clears redo after a new change and logs rejections without changing state', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const id = firstEditable(store);
    store.dispatch({ type: 'entity/renamed', id, name: 'One', source: 'user' });
    store.undo();
    store.dispatch({ type: 'entity/renamed', id, name: 'Two', source: 'user' });
    expect(store.canRedo()).toBe(false);

    const before = store.getState();
    const rejected = store.dispatch({ type: 'entity/renamed', id, name: '', source: 'user' });
    expect(rejected.ok).toBe(false);
    expect(store.getState()).toBe(before);

    const log = store.getLog();
    expect(log.map((e) => e.kind)).toEqual(['event', 'undo', 'event', 'event']);
    expect(log.at(-1)?.ok).toBe(false);
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const id = firstEditable(store);
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    store.dispatch({ type: 'entity/pinnedChanged', id, pinned: true, source: 'user' });
    off();
    store.dispatch({ type: 'entity/pinnedChanged', id, pinned: false, source: 'user' });
    expect(calls).toBe(1);
  });

  it('respects the history limit', () => {
    const store = new WorldStore(buildCrystalKingdom(), { historyLimit: 2 });
    const id = firstEditable(store);
    ['a', 'b', 'c'].forEach((name) => store.dispatch({ type: 'entity/renamed', id, name, source: 'user' }));
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);
  });
});

describe('replay', () => {
  it('reproduces a live session exactly from genesis + user events', () => {
    const genesis = crystalKingdomEvents();
    const base = createEmptyWorld({ id: 'r', name: 'Replay', biome: 'x', seed: CRYSTAL_KINGDOM_SEED });
    const built = replay(base, genesis);
    expect(built.rejected).toEqual([]);

    const store = new WorldStore(built.world);
    const id = Object.values(built.world.entities).find((e) => e.kind === 'crystal')!.id;
    const userEvents: WorldEvent[] = [
      { type: 'entity/visualChanged', id, patch: { color: '#ff66cc' }, source: 'user' },
      { type: 'entity/transformed', id, transform: { position: [1, 2, 3] }, source: 'user' },
      { type: 'entity/renamed', id, name: '', source: 'user' }, // rejected
    ];
    userEvents.forEach((e) => store.dispatch(e));

    const replayed = replay(base, [...genesis, ...userEvents]);
    expect(replayed.rejected).toHaveLength(1);
    expect(JSON.stringify(replayed.world)).toBe(JSON.stringify(store.getState()));
  });
});
