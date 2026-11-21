import { describe, expect, it } from 'vitest';
import { createFuturesManager } from '../core/futures';
import { WorldStore } from '../core/store';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { createPersistence } from './controller';
import { LocalSaveSlots, type StorageLike } from './localSave';

const memory = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

function setup(openFutures?: () => number) {
  const genesis = buildCrystalKingdom();
  const store = new WorldStore(genesis);
  const p = createPersistence({ store, slots: new LocalSaveSlots(memory()), replaceWorld: () => undefined, ...(openFutures ? { openFutures } : {}) });
  return { genesis, store, p };
}

describe('load confirmation and open futures', () => {
  it('needs no confirmation for a clean session without futures', () => {
    expect(setup(() => 0).p.confirmation()).toEqual({ required: false, reason: null });
    expect(setup().p.confirmation()).toEqual({ required: false, reason: null });
  });

  it('asks before discarding open futures even when the world has no edits', () => {
    const { genesis, store } = setup();
    const manager = createFuturesManager(store, genesis);
    const p = createPersistence({ store, slots: new LocalSaveSlots(memory()), replaceWorld: () => undefined, openFutures: () => manager.list().length });
    expect(p.confirmation().required).toBe(false);
    expect(manager.fork('A').ok).toBe(true);
    expect(p.confirmation()).toEqual({ required: true, reason: 'Loading another world discards the open future, along with undo history and the history panel.' });
    expect(manager.fork('B').ok).toBe(true);
    expect(p.confirmation().reason).toMatch(/^Loading another world discards 2 open futures/);
    expect(store.canUndo()).toBe(false); // forking never touches the store
    manager.dispose();
    expect(p.confirmation().required).toBe(false);
  });

  it('asks when the futures count cannot be read', () => {
    const { p } = setup(() => {
      throw new Error('boom');
    });
    expect(p.confirmation().required).toBe(true);
  });

  it('unsaved changes still take precedence in the message', () => {
    const { store, p } = setup(() => 3);
    const id = store.getState().order.find((i) => !store.getState().entities[i]!.pinned)!;
    expect(store.dispatch({ type: 'entity/renamed', id, name: 'Changed', source: 'user' }).ok).toBe(true);
    expect(p.confirmation().reason).toMatch(/^You have unsaved changes/);
  });
});
