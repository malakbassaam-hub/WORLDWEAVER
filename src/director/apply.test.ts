import { describe, expect, it } from 'vitest';
import { replayLog } from '../core/replay';
import { WorldStore } from '../core/store';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { applyTranslation, batchMetaFor } from './apply';
import { buildWorldContext } from './context';
import { translateProposal } from './translate';
import { validateProposal } from './validate';
import type { WorldProposal } from './schema';

function proposal(input: unknown): WorldProposal {
  const r = validateProposal(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.proposal;
}

const refOf = (store: WorldStore, name: string) => buildWorldContext(store.getState()).entities.find((e) => e.name === name)!.ref;

describe('applyTranslation', () => {
  it('applies an all-accepted proposal as exactly one undo step', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const before = store.getState();
    const t = translateProposal(before, proposal({
      summary: 'Two spires and a recolour.',
      operations: [
        { op: 'add', archetype: 'crystalSpire', name: 'Spire', count: 2, placement: 'inner-ring' },
        { op: 'recolor', target: refOf(store, 'Sentinel Spire I'), palette: 'Ember Gold' },
      ],
    }));
    expect(t.applicable).toBe(true);
    const r = applyTranslation(store, t, { mode: 'recorded', recordingId: 'create-spires' });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(store.getState())).toBe(JSON.stringify(t.preview));
    const entry = store.getLog().at(-1)!;
    expect(entry.kind).toBe('batch');
    expect(entry.meta?.label).toBe('Director (recorded): Two spires and a recolour.');
    expect(entry.meta?.details).toMatchObject({ mode: 'recorded', recordingId: 'create-spires', proposalKey: t.proposalKey });

    store.undo();
    expect(store.getState().order).toEqual(before.order);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(store.getState().order.length).toBe(before.order.length + 2);
  });

  it('refuses a proposal with any rejected operation (all-or-nothing)', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const t = translateProposal(store.getState(), proposal({
      summary: 'One good, one targeting the pinned citadel.',
      operations: [
        { op: 'add', archetype: 'obelisk', name: 'Marker', placement: 'outer-ring' },
        { op: 'recolor', target: refOf(store, 'Aurelion Citadel'), palette: 'Orchid Flare' },
      ],
    }));
    expect(t.accepted).toBe(1);
    expect(t.applicable).toBe(false);
    const before = store.getState();
    const r = applyTranslation(store, t, { mode: 'live' });
    expect(r).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
    expect(store.getState()).toBe(before);
    expect(store.getLog()).toHaveLength(0);
  });

  it('refuses a stale preview after the world changed', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const spire = refOf(store, 'Sentinel Spire II');
    const t = translateProposal(store.getState(), proposal({ summary: 'Hide a spire.', operations: [{ op: 'hide', target: spire }] }));
    const id = buildWorldContext(store.getState()).refs.get(spire)!;
    store.dispatch({ type: 'entity/renamed', id, name: 'Edited meanwhile', source: 'user' });
    const r = applyTranslation(store, t, { mode: 'live' });
    expect(r).toMatchObject({ ok: false, code: 'STALE' });
    // Re-translating against the current world (no model call) makes it applicable again.
    const fresh = translateProposal(store.getState(), proposal({ summary: 'Hide a spire.', operations: [{ op: 'hide', target: spire }] }));
    expect(applyTranslation(store, fresh, { mode: 'live' }).ok).toBe(true);
  });

  it('replays a session with director batches without any model call', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const t = translateProposal(store.getState(), proposal({ summary: 'Wisps.', operations: [{ op: 'add', archetype: 'lightOrb', name: 'Wisp', count: 2, placement: 'sky' }] }));
    applyTranslation(store, t, { mode: 'live', model: 'gemini-3.5-flash-lite', requestId: 'r1' });
    store.undo();
    store.redo();
    const replayed = replayLog(initial, store.getLog());
    expect(replayed.mismatches).toEqual([]);
    expect(JSON.stringify(replayed.world)).toBe(JSON.stringify(store.getState()));
  });

  it('truncates long batch labels and never includes prompt text in details', () => {
    const t = translateProposal(buildCrystalKingdom(), proposal({ summary: 'S'.repeat(280), operations: [{ op: 'add', archetype: 'obelisk', name: 'X', placement: 'sky' }] }));
    const m = batchMetaFor(t, { mode: 'live' });
    expect(m.label.length).toBeLessThanOrEqual(120);
    expect(Object.keys(m.details ?? {}).sort()).toEqual(['events', 'mode', 'operations', 'proposalKey']);
  });
});
