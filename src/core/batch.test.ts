import { describe, expect, it } from 'vitest';
import { applyEvent, applyEvents, createEmptyWorld } from './reducer';
import { replay, replayLog } from './replay';
import { MAX_BATCH_EVENTS, WorldStore, type BatchMeta } from './store';
import { asEntityId, type EntityDraft, type VisualComponent, type World, type WorldEvent } from './types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';

const meta = (label = 'Test batch'): BatchMeta => ({ label, source: 'director', details: { proposalKey: 'k' } });

function draft(id: string, name = id): EntityDraft {
  return {
    id: asEntityId(id),
    name,
    kind: 'crystal',
    parentId: null,
    tags: [],
    pinned: false,
    components: {
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visual: { archetype: 'crystalSpire', color: '#112233', emissive: '#445566', emissiveIntensity: 1, visible: true },
    },
  };
}

const add = (id: string, source: WorldEvent['source'] = 'director'): WorldEvent => ({ type: 'entity/added', entity: draft(id), source });
const spireOf = (w: World) => Object.values(w.entities).find((e) => e.kind === 'crystal' && !e.pinned)!;
const citadelOf = (w: World) => Object.values(w.entities).find((e) => e.pinned)!;

describe('applyEvents', () => {
  it('is all-or-nothing and returns the original world on failure', () => {
    const w = createEmptyWorld({ id: 'w', name: 'W', biome: 'b', seed: 1 });
    const bad = applyEvents(w, [add('a'), add('b'), add('a')]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.index).toBe(2);
      expect(bad.world).toBe(w);
      expect(bad.reason).toMatch(/already exists/);
    }
    const good = applyEvents(w, [add('a'), add('b')]);
    expect(good.ok && good.world.order).toEqual(['a', 'b']);
  });
});

describe('WorldStore.dispatchBatch', () => {
  it('applies a batch as one undo step, and redo restores the whole batch', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const before = store.getState();
    const spire = spireOf(before);
    const result = store.dispatchBatch(
      [add('ai:1'), add('ai:2'), { type: 'entity/renamed', id: spire.id, name: 'Batch Spire', source: 'director' }],
      meta(),
    );
    expect(result.ok).toBe(true);
    const after = store.getState();
    expect(after.order.length).toBe(before.order.length + 2);
    expect(after.entities[spire.id]?.name).toBe('Batch Spire');
    expect(store.getLog().filter((e) => e.kind === 'batch')).toHaveLength(1);

    expect(store.undo()).toBe(true);
    expect(store.getState().order).toEqual(before.order);
    expect(store.getState().entities[spire.id]).toBe(before.entities[spire.id]);
    expect(store.canUndo()).toBe(false);

    expect(store.redo()).toBe(true);
    // Stable identity: redo restores the exact post-batch entity objects.
    expect(store.getState().entities['ai:1']).toBe(after.entities['ai:1']);
    expect(store.getState().entities[spire.id]).toBe(after.entities[spire.id]);
    expect(store.getState().order).toEqual(after.order);
  });

  it('rolls back completely when any event fails, without touching history', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const spire = spireOf(store.getState());
    store.dispatch({ type: 'entity/renamed', id: spire.id, name: 'One', source: 'user' });
    store.undo(); // leaves one redo step
    const before = store.getState();
    const result = store.dispatchBatch([add('ai:x'), { type: 'entity/renamed', id: spire.id, name: '', source: 'director' }], meta());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(1);
      expect(result.reason).toMatch(/Event 2 of 2 rejected/);
    }
    expect(store.getState()).toBe(before);
    expect(store.getState().entities['ai:x']).toBeUndefined();
    expect(store.canRedo()).toBe(true); // a rejected batch must not clear redo history
    const last = store.getLog().at(-1)!;
    expect(last).toMatchObject({ kind: 'batch', ok: false });
  });

  it('rejects duplicated operations and all-no-op batches', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const spire = spireOf(store.getState());
    const v = spire.components.visual!;
    expect(store.dispatchBatch([add('ai:d'), add('ai:d')], meta()).ok).toBe(false);
    const rename = { type: 'entity/renamed', id: spire.id, name: 'Twice', source: 'director' } as const;
    expect(store.dispatchBatch([rename, rename], meta()).ok).toBe(false);
    expect(store.dispatchBatch([{ type: 'entity/visualChanged', id: spire.id, patch: { color: v.color }, source: 'director' }], meta()).ok).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it('protects pinned entities: a batch removing one is rejected entirely', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const citadel = citadelOf(store.getState());
    const r = store.dispatchBatch([add('ai:p'), { type: 'entity/removed', id: citadel.id, source: 'director' }], meta());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/pinned/);
    expect(store.getState().entities[citadel.id]).toBeDefined();
    expect(store.getState().entities['ai:p']).toBeUndefined();
  });

  it('rejects empty batches, oversized batches and events with a different source', () => {
    const store = new WorldStore(buildCrystalKingdom());
    expect(store.dispatchBatch([], meta()).ok).toBe(false);
    const many = Array.from({ length: MAX_BATCH_EVENTS + 1 }, (_, i) => add(`ai:${i}`));
    expect(store.dispatchBatch(many, meta()).ok).toBe(false);
    const mixed = store.dispatchBatch([add('ai:m'), add('u:m', 'user')], meta());
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.reason).toMatch(/source "user"/);
  });

  it('matches a dry-run replay exactly, including seq and provenance', () => {
    const world = buildCrystalKingdom();
    const events = [add('ai:r1'), add('ai:r2')];
    const store = new WorldStore(world);
    store.dispatchBatch(events, meta());
    expect(JSON.stringify(store.getState())).toBe(JSON.stringify(replay(world, events).world));
    expect(store.getState().entities['ai:r2']?.provenance).toMatchObject({ createdBy: 'director', createdAtSeq: world.seq + 2 });
  });

  it('respects the history limit with batches', () => {
    const store = new WorldStore(buildCrystalKingdom(), { historyLimit: 2 });
    for (let i = 0; i < 3; i++) store.dispatchBatch([add(`ai:h${i}`)], meta());
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);
  });
});

describe('replayLog (WW-007: undo/redo replay semantics)', () => {
  it('reproduces the live state exactly through events, batches, rejections, undo and redo', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const spire = spireOf(initial);
    store.dispatch({ type: 'entity/renamed', id: spire.id, name: 'A', source: 'user' });
    store.dispatchBatch([add('ai:1'), add('ai:2')], meta('first'));
    store.dispatchBatch([add('ai:1')], meta('duplicate, rejected'));
    store.undo();
    store.dispatch({ type: 'entity/renamed', id: spire.id, name: '', source: 'user' }); // rejected
    store.redo();
    store.undo();
    store.undo();
    store.redo();
    store.dispatchBatch([add('ai:3')], meta('after redo'));
    store.dispatch({ type: 'entity/pinnedChanged', id: spire.id, pinned: true, source: 'user' });

    const replayed = replayLog(initial, store.getLog(), { historyLimit: store.getHistoryLimit() });
    expect(replayed.mismatches).toEqual([]);
    expect(JSON.stringify(replayed.world)).toBe(JSON.stringify(store.getState()));
    expect(replayed.world.seq).toBe(store.getState().seq);
  });

  it('keeps provenance consistent with the state in effect after undo', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const spire = spireOf(initial);
    store.dispatchBatch([{ type: 'entity/renamed', id: spire.id, name: 'By AI', source: 'director' }], meta());
    expect(store.getState().entities[spire.id]?.provenance.lastModifiedBy).toBe('director');
    store.undo();
    expect(store.getState().entities[spire.id]?.provenance).toEqual(initial.entities[spire.id]?.provenance);
    expect(store.getState().seq).toBeGreaterThan(initial.seq); // seq stays monotonic
  });

  it('flags a log that no longer replays the same way', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    store.dispatchBatch([add('ai:z')], meta());
    const tampered = store.getLog().map((e) => ({ ...e, ok: !e.ok }));
    expect(replayLog(initial, tampered).mismatches).toHaveLength(1);
  });
});

describe('reducer no-op rule (WW-027)', () => {
  const base = () => {
    const w = createEmptyWorld({ id: 'w', name: 'W', biome: 'b', seed: 1 });
    const r = applyEvent(w, { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    if (!r.ok) throw new Error(r.reason);
    return r.world;
  };
  const id = asEntityId('t:a');

  it('rejects visual patches that change nothing, ignoring colour case', () => {
    const w = base();
    const patches: Array<Partial<Omit<VisualComponent, 'archetype'>>> = [
      { color: '#112233' },
      { color: '#112233'.toUpperCase() as `#${string}` },
      { visible: true },
      { emissiveIntensity: 1 },
      { emissive: '#445566', emissiveIntensity: 1 },
    ];
    for (const patch of patches) {
      const r = applyEvent(w, { type: 'entity/visualChanged', id, patch, source: 'user' });
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) expect(r.reason).toBe('No change.');
    }
    expect(applyEvent(w, { type: 'entity/visualChanged', id, patch: { color: '#112234' }, source: 'user' }).ok).toBe(true);
  });

  it('rejects transform patches that change nothing', () => {
    const w = base();
    for (const transform of [{ position: [0, 0, 0] as const }, { rotation: [0, 0, 0] as const }, { scale: [1, 1, 1] as const }, {}]) {
      const r = applyEvent(w, { type: 'entity/transformed', id, transform, source: 'user' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('No change.');
    }
    expect(applyEvent(w, { type: 'entity/transformed', id, transform: { position: [0, 1, 0] }, source: 'user' }).ok).toBe(true);
  });
});
