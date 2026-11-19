/**
 * Cross-feature scenarios (mission stage 4): AI Director, World Morph, Causal
 * Ledger, Parallel Futures, store undo/redo, pinning and hierarchy together.
 * Uses the recorded Director responses served by the proxy in recorded mode,
 * so these are the same proposals the browser suite sees. No network.
 */
import { describe, expect, it } from 'vitest';
import { RECORDINGS } from '../../server/director/recordings';
import { stateRef, worldFingerprint } from '../core/fingerprint';
import { createFuturesManager } from '../core/futures';
import { buildLedger, createLedgerRecorder, traceEntity, verifyLedgerChain, type LedgerEntry } from '../core/ledger';
import { checkPinnedInvariant } from '../core/pins';
import { replayLog } from '../core/replay';
import { WorldStore } from '../core/store';
import type { World } from '../core/types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { applyTranslation } from './apply';
import { buildWorldContext } from './context';
import { proposeInFuture } from './futures';
import { applyMorph, translateMorph } from './morph';
import { translateProposal } from './translate';
import { validateProposal } from './validate';

function recorded(id: string) {
  const rec = RECORDINGS.find((r) => r.id === id);
  if (!rec) throw new Error(`missing recording ${id}`);
  const v = validateProposal(rec.response);
  if (!v.ok) throw new Error(`recording ${id} invalid`);
  return v.proposal;
}

const idOf = (w: World, ref: string) => buildWorldContext(w).refs.get(ref)!;

describe('Scenario A: a morph is one atomic, undoable, recorded operation', () => {
  it('changes several entities in one batch, one ledger entry, and undoes and redoes exactly', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const t = translateMorph(initial, recorded('morph-violet-dusk'));
    expect(t.applicable).toBe(true);
    expect(applyMorph(store, t, { mode: 'recorded', recordingId: 'morph-violet-dusk' }).ok).toBe(true);
    const morphed = store.getState();
    const ledger = buildLedger(initial, store.getLog());
    expect(ledger.entries).toHaveLength(1);
    const [entry] = ledger.entries as [LedgerEntry];
    expect(entry.cause).toMatchObject({ type: 'proposal', kind: 'morph', recordingId: 'morph-violet-dusk', details: { policyApproved: 'true' } });
    expect(entry.changes.length).toBeGreaterThanOrEqual(4);
    expect(entry.actions).toHaveLength(t.events.length);
    expect(checkPinnedInvariant(initial, morphed)).toEqual([]);

    store.undo();
    expect(worldFingerprint(store.getState())).toBe(worldFingerprint(initial));
    store.redo();
    expect(worldFingerprint(store.getState())).toBe(worldFingerprint(morphed));
    const after = buildLedger(initial, store.getLog());
    expect(after.entries.map((e) => e.cause.type)).toEqual(['proposal', 'undo', 'redo']);
    expect(after.inEffect).toEqual([0]);
  });
});

describe('Scenario B: protected objects', () => {
  it('a morph that would move a pinned entity\'s ancestor is rejected whole, with no partial mutation, in the world and in a future', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const proposal = recorded('morph-shift-isle');
    const t = translateMorph(initial, proposal);
    expect(t.applicable).toBe(false);
    expect(t.outcomes.some((o) => o.rule === 'pinned-ancestor')).toBe(true);
    expect(applyMorph(store, t, { mode: 'recorded' })).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
    expect(store.getState()).toBe(initial);
    expect(store.getLog()).toHaveLength(0);

    const manager = createFuturesManager(store, initial);
    const f = manager.fork('Shift attempt');
    if (!f.ok) throw new Error(f.reason);
    expect(proposeInFuture(manager, f.value.id, RECORDINGS.find((r) => r.id === 'morph-shift-isle')!.response, { kind: 'morph', mode: 'recorded' })).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
    expect(manager.get(f.value.id)!.eventCount).toBe(0);
    expect(store.getState()).toBe(initial);
  });
});

describe('Scenario C: alternative futures', () => {
  it('two futures from one snapshot produce different valid outcomes; the original is unchanged; one is selected', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const manager = createFuturesManager(store, initial);
    const fork = (label: string) => {
      const r = manager.fork(label);
      if (!r.ok) throw new Error(r.reason);
      return r.value.id;
    };
    const violet = fork('Violet dusk');
    const ember = fork('Ember ruin');
    for (const [id, rec] of [[violet, 'morph-violet-dusk'], [ember, 'morph-ember-ruin']] as const) {
      const r = proposeInFuture(manager, id, RECORDINGS.find((x) => x.id === rec)!.response, { kind: 'morph', mode: 'recorded', recordingId: rec });
      expect(r.ok, rec).toBe(true);
    }
    expect(store.getState()).toBe(initial);
    const all = manager.compareAll();
    expect(all.original).toEqual(stateRef(initial));
    expect(all.futures.map((f) => f.future.label)).toEqual(['Violet dusk', 'Ember ruin']);
    expect(all.futures.every((f) => f.violations.length === 0 && !f.comparison.identical)).toBe(true);
    expect(worldFingerprint(manager.state(violet)!)).not.toBe(worldFingerprint(manager.state(ember)!));

    const emberPreview = manager.state(ember)!;
    expect(manager.commit(ember).ok).toBe(true);
    expect(JSON.stringify(store.getState())).toBe(JSON.stringify(emberPreview));
    expect(manager.get(violet)!.stale).toBe(true);
  });
});

describe('Scenario D: stale future', () => {
  it('a future created before the world changed cannot be applied; the world stays as it is', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const manager = createFuturesManager(store, initial);
    const f = manager.fork('Early idea');
    if (!f.ok) throw new Error(f.reason);
    expect(proposeInFuture(manager, f.value.id, RECORDINGS.find((r) => r.id === 'morph-violet-dusk')!.response, { kind: 'morph', mode: 'recorded' }).ok).toBe(true);
    // The user keeps editing the real world.
    store.dispatch({ type: 'entity/renamed', id: idOf(initial, 'e5'), name: 'Meanwhile', source: 'user' });
    const now = store.getState();
    const log = store.getLog().length;
    expect(manager.commit(f.value.id)).toMatchObject({ ok: false, code: 'STALE' });
    expect(store.getState()).toBe(now);
    expect(store.getLog()).toHaveLength(log);
  });
});

describe('Scenario E: one coherent, inspectable history', () => {
  it('edits, Director create, morph, undo, redo and a selected future give a consistent ledger with no invented causes', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const recorder = createLedgerRecorder(initial, store);
    const spire = idOf(initial, 'e4');

    store.dispatch({ type: 'entity/renamed', id: spire, name: 'Watchtower', source: 'user' }); // 0
    const create = translateProposal(store.getState(), recorded('create-crystal-garden'));
    expect(applyTranslation(store, create, { mode: 'recorded', kind: 'create', recordingId: 'create-crystal-garden' }).ok).toBe(true); // 1
    const m = translateMorph(store.getState(), recorded('morph-violet-dusk'));
    expect(applyMorph(store, m, { mode: 'recorded', recordingId: 'morph-violet-dusk' }).ok).toBe(true); // 2
    store.undo(); // 3 reverses 2
    store.redo(); // 4 reapplies 2
    const manager = createFuturesManager(store, initial);
    const f = manager.fork('Ember alternative');
    if (!f.ok) throw new Error(f.reason);
    expect(proposeInFuture(manager, f.value.id, RECORDINGS.find((r) => r.id === 'morph-ember-ruin')!.response, { kind: 'morph', mode: 'recorded' }).ok).toBe(true);
    expect(manager.commit(f.value.id).ok).toBe(true); // 5
    store.undo(); // 6 reverses 5

    const view = buildLedger(initial, store.getLog());
    expect(view.entries.map((e) => e.cause.type)).toEqual(['event', 'proposal', 'proposal', 'undo', 'redo', 'future', 'undo']);
    expect(view.consistent, JSON.stringify(view.issues)).toBe(true);
    expect(verifyLedgerChain(view)).toEqual({ ok: true });
    expect(JSON.stringify(recorder.view())).toBe(JSON.stringify(view));
    expect(view.final).toEqual(stateRef(store.getState()));
    expect(replayLog(initial, store.getLog()).mismatches).toEqual([]);
    expect(view.inEffect).toEqual([0, 1, 2]);

    // No invented causes: every observed change in an event/batch entry is linked to an action that targeted it;
    // undo/redo point at a real earlier change entry; derived statements are labelled as derived.
    for (const e of view.entries) {
      if (e.kind === 'event' || e.kind === 'batch') {
        for (const c of e.changes) {
          expect(c.recordedBy.length).toBeGreaterThan(0);
          for (const a of c.recordedBy) expect(e.actions.find((x) => x.id === a)!.target).toBe(c.id);
        }
      } else if (e.cause.type === 'undo' || e.cause.type === 'redo') {
        const target = e.cause.type === 'undo' ? e.cause.reverses : e.cause.reapplies;
        expect(view.entries[target]!.accepted).toBe(true);
        expect(['event', 'batch']).toContain(view.entries[target]!.kind);
        for (const c of e.changes) expect(c.recordedBy).toEqual([]);
      }
      for (const d of e.consequences) expect(d.basis).toBe('derived');
    }
    expect(view.entries.filter((e) => e.summaryOrigin === 'model').map((e) => e.index)).toEqual([1, 2, 5]);

    // The renamed spire's trace: the user rename, then the Director morph recolour; nothing else is claimed.
    const trace = traceEntity(view, spire).filter((s) => s.relation === 'direct');
    expect(trace[0]).toMatchObject({ index: 0, fields: ['name', 'provenance'], inEffect: true });
    // The pinned citadel was never changed directly by anything.
    expect(traceEntity(view, idOf(initial, 'e2')).filter((s) => s.relation === 'direct')).toEqual([]);
    recorder.dispose();
  });
});
