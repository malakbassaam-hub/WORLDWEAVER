import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildWorldContext } from '../director/context';
import { applyMorph, translateMorph } from '../director/morph';
import { validateProposal } from '../director/validate';
import { stateRef } from './fingerprint';
import {
  buildLedger,
  createLedgerRecorder,
  deriveLedgerEntries,
  diffWorlds,
  explainEntity,
  traceEntity,
  verifyLedgerAgainstLog,
  verifyLedgerChain,
  type CausalLedgerView,
  type LedgerEntry,
} from './ledger';
import { createRng } from './random';
import { createEmptyWorld } from './reducer';
import { WorldStore, type LogEntry } from './store';
import type { EntityId, World } from './types';

function morph(store: WorldStore, ops: unknown[], recordingId = 'rec') {
  const r = validateProposal({ summary: 'Morph.', operations: ops });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const t = translateMorph(store.getState(), r.proposal);
  const out = applyMorph(store, t, { mode: 'recorded', recordingId });
  if (!out.ok) throw new Error(out.reason);
  return t;
}

const idOf = (w: World, ref: string) => buildWorldContext(w).refs.get(ref)!;

/** A session touching every log kind: events, a rejected event, a morph batch, undo, redo, a new branch. */
function session() {
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
  return { initial, store, spire, t };
}

describe('Causal Ledger: recorded causes and observed effects', () => {
  it('derives one entry per log entry with recorded causes and exact effects', () => {
    const { initial, store, spire, t } = session();
    const entries = deriveLedgerEntries(initial, store.getLog());
    expect(entries).toHaveLength(7);
    expect(entries[0]).toMatchObject({ accepted: true, status: 'applied', cause: { type: 'event', source: 'user' }, effects: { added: [], removed: [], changed: [spire] } });
    expect(entries[0]!.changes).toEqual([{ id: spire, change: 'changed', fields: ['name', 'provenance'], recordedBy: ['0/0'] }]);
    expect(entries[1]).toMatchObject({ accepted: false, status: 'rejected', reason: 'Name must not be empty.', effects: { added: [], removed: [], changed: [] }, changes: [] });
    const added = t.events.flatMap((e) => (e.type === 'entity/added' ? [e.entity.id] : []));
    expect(entries[2]).toMatchObject({
      accepted: true,
      summaryOrigin: 'model',
      cause: { type: 'proposal', source: 'director', kind: 'morph', mode: 'recorded', recordingId: 'rec', proposalKey: t.proposalKey },
      effects: { added, removed: [], changed: [idOf(initial, 'e6')] },
    });
    expect(entries[2]!.cause).toMatchObject({ details: { pinnedHash: expect.any(String), policyApproved: 'true' } });
    expect(entries[3]).toMatchObject({ cause: { type: 'undo', reverses: 2, reversesId: entries[2]!.id }, effects: { added: [], removed: added, changed: [idOf(initial, 'e6')] } });
    expect(entries[4]).toMatchObject({ cause: { type: 'redo', reapplies: 2, reappliesId: entries[2]!.id }, effects: { added } });
    expect(entries[5]).toMatchObject({ cause: { type: 'undo', reverses: 2 } });
    expect(entries[6]).toMatchObject({ cause: { type: 'undo', reverses: 0, reversesId: entries[0]!.id }, effects: { changed: [spire] } });
    expect(entries.at(-1)!.seqAfter).toBe(store.getState().seq);
    expect(entries.every((e) => e.issues.length === 0)).toBe(true);
  });

  it('groups a batch: one entry, one action per event with its own seq, changes linked to the actions that targeted them', () => {
    const { initial, store, t } = session();
    const e = deriveLedgerEntries(initial, store.getLog())[2]!;
    expect(e.kind).toBe('batch');
    expect(e.actions).toHaveLength(t.events.length);
    e.actions.forEach((a, k) => {
      expect(a.id).toBe(`2/${k}`);
      expect(a.seq).toBe(e.seqBefore + k + 1);
      expect(a.source).toBe('director');
      expect(a.payload).toMatch(/^[0-9a-f]{16}$/);
    });
    expect(e.seqAfter).toBe(e.seqBefore + t.events.length);
    for (const c of e.changes) {
      expect(c.recordedBy.length).toBeGreaterThan(0);
      for (const actionId of c.recordedBy) expect(e.actions.find((a) => a.id === actionId)!.target).toBe(c.id);
    }
  });

  it('links before/after state references: each entry starts where the previous ended; undo returns to an earlier state', () => {
    const { initial, store } = session();
    const view = buildLedger(initial, store.getLog());
    expect(view.entries[0]!.before).toEqual(stateRef(initial));
    for (let i = 1; i < view.entries.length; i++) expect(view.entries[i]!.before).toEqual(view.entries[i - 1]!.after);
    const [e0, e1, e2, e3] = view.entries as [LedgerEntry, LedgerEntry, LedgerEntry, LedgerEntry];
    expect(e1.after).toEqual(e1.before); // rejected
    expect(e3.after.fingerprint).toBe(e2.before.fingerprint); // undo restores the content before the morph
    expect(e3.after.seq).toBeGreaterThan(e2.after.seq); // with a new seq
    expect(view.entries.at(-1)!.after.fingerprint).toBe(e0.before.fingerprint);
    expect(view.final).toEqual(stateRef(store.getState()));
  });

  it('labels Director summaries as model text and engine summaries as engine text', () => {
    const { initial, store } = session();
    const entries = deriveLedgerEntries(initial, store.getLog());
    expect(entries.map((e) => e.summaryOrigin)).toEqual(['engine', 'engine', 'model', 'engine', 'engine', 'engine', 'engine']);
  });

  it('records a committed future and a plain user batch with their own cause types', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const id = idOf(initial, 'e5');
    store.dispatchBatch([{ type: 'entity/renamed', id, name: 'Batch Name', source: 'user' }], { label: 'Bulk rename', source: 'user' });
    store.dispatchBatch([{ type: 'entity/renamed', id, name: 'Future Name', source: 'user' }], { label: 'Future: calm', source: 'user', details: { kind: 'future', futureId: 'f-1', baseSeq: '28', steps: '2' } });
    const [a, b] = deriveLedgerEntries(initial, store.getLog());
    expect(a!.cause).toEqual({ type: 'batch', source: 'user', details: {} });
    expect(a!.summaryOrigin).toBe('user');
    expect(b!.cause).toMatchObject({ type: 'future', futureId: 'f-1', baseSeq: 28, steps: 2 });
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
    const view = buildLedger(initial, store.getLog(), { historyLimit: 1 });
    expect(view.entries).toHaveLength(3);
    expect(view.entries[2]!.cause).toEqual({ type: 'undo', reverses: 1, reversesId: view.entries[1]!.id });
    expect(view.entries[2]!.effects.changed).toEqual([id]);
    expect(view.inEffect).toEqual([0]); // entry 0 can no longer be undone but is still in effect
  });

  it('tracks which changes are in effect through undo, redo and a new branch', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const id = idOf(initial, 'e4');
    store.dispatch({ type: 'entity/renamed', id, name: 'A', source: 'user' }); // 0
    store.dispatch({ type: 'entity/renamed', id, name: 'B', source: 'user' }); // 1
    store.undo(); // 2
    expect(buildLedger(initial, store.getLog()).inEffect).toEqual([0]);
    store.redo(); // 3
    expect(buildLedger(initial, store.getLog()).inEffect).toEqual([0, 1]);
    store.undo(); // 4
    store.dispatch({ type: 'entity/renamed', id, name: 'C', source: 'user' }); // 5 discards the redo of 1
    expect(buildLedger(initial, store.getLog()).inEffect).toEqual([0, 5]);
  });

  it('diffWorlds is empty for identical worlds', () => {
    const w = buildCrystalKingdom();
    expect(diffWorlds(w, w)).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe('Causal Ledger: derived consequences are separate from recorded facts', () => {
  it('fixture: moving an island derives new world poses for its descendants, attributed to the island', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const isle = idOf(initial, 'e1');
    store.dispatch({ type: 'entity/transformed', id: isle, transform: { position: [0, 4, 0] }, source: 'user' });
    const [e] = deriveLedgerEntries(initial, store.getLog());
    expect(e!.changes).toEqual([{ id: isle, change: 'changed', fields: ['transform.position', 'provenance'], recordedBy: ['0/0'] }]);
    const descendants = initial.order.filter((id) => id !== isle && buildAncestry(initial, id).includes(isle));
    expect(descendants.length).toBeGreaterThan(5);
    expect(e!.consequences.map((c) => c.id).sort()).toEqual([...descendants].sort());
    for (const c of e!.consequences) expect(c).toMatchObject({ rule: 'inherited-world-pose', via: isle, basis: 'derived' });
    // Recorded/observed sections never mention the descendants.
    expect(e!.effects.changed).toEqual([isle]);
  });

  it('fixture: one change affects later observable state, and the trace keeps the two kinds apart', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const isle = idOf(initial, 'e1');
    const spire = idOf(initial, 'e4');
    store.dispatch({ type: 'entity/visualChanged', id: isle, patch: { visible: false }, source: 'user' }); // 0 hides the spire too
    morph(store, [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }]); // 1 recolours the hidden spire
    store.undo(); // 2 reverses 1
    const view = buildLedger(initial, store.getLog());
    const trace = traceEntity(view, spire);
    expect(trace).toEqual([
      expect.objectContaining({ index: 0, relation: 'derived', rule: 'inherited-visibility', via: isle, inEffect: true }),
      expect.objectContaining({ index: 1, relation: 'direct', change: 'changed', fields: ['visual.color', 'visual.emissive', 'provenance'], inEffect: false }),
      expect.objectContaining({ index: 2, relation: 'direct', kind: 'undo', inEffect: null }),
    ]);
    expect(trace[0]).not.toHaveProperty('fields');
  });

  it('attributes a descendant that changed itself to its own change, and its subtree to it', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const isle = idOf(initial, 'e1');
    const citadel = idOf(initial, 'e2');
    const halo = idOf(initial, 'e3'); // child of the citadel
    store.dispatchBatch([
      { type: 'entity/transformed', id: isle, transform: { position: [0, 3, 0] }, source: 'user' },
      { type: 'entity/transformed', id: citadel, transform: { rotation: [0, 1, 0] }, source: 'user' },
    ], { label: 'Two moves', source: 'user' });
    const [e] = deriveLedgerEntries(initial, store.getLog());
    expect(e!.consequences.find((c) => c.id === citadel)).toBeUndefined();
    expect(e!.consequences.find((c) => c.id === halo)).toMatchObject({ via: citadel });
  });

  it('derives nothing for scale-only changes (scale is not inherited) and for unrelated fields', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const isle = idOf(initial, 'e1');
    store.dispatch({ type: 'entity/transformed', id: isle, transform: { scale: [2, 2, 2] }, source: 'user' });
    store.dispatch({ type: 'entity/renamed', id: isle, name: 'Renamed Isle', source: 'user' });
    for (const e of deriveLedgerEntries(initial, store.getLog())) expect(e.consequences).toEqual([]);
  });
});

function buildAncestry(world: World, id: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (let p = world.entities[id]?.parentId ?? null; p; p = world.entities[p]?.parentId ?? null) out.push(p);
  return out;
}

describe('Causal Ledger: identity, ordering and the hash chain', () => {
  it('is deterministic: the same log gives identical IDs, hashes and content', () => {
    const a = session();
    const b = session();
    expect(JSON.stringify(buildLedger(a.initial, a.store.getLog()))).toBe(JSON.stringify(buildLedger(b.initial, b.store.getLog())));
  });

  it('IDs are unique, ordered by index, and stable when the log grows', () => {
    const { initial, store } = session();
    const short = buildLedger(initial, store.getLog().slice(0, 4));
    store.dispatch({ type: 'entity/renamed', id: idOf(initial, 'e9'), name: 'Later', source: 'user' });
    const long = buildLedger(initial, store.getLog());
    expect(new Set(long.entries.map((e) => e.id)).size).toBe(long.entries.length);
    long.entries.forEach((e, i) => expect(e.index).toBe(i));
    for (let i = 0; i < short.entries.length; i++) expect(long.entries[i]!.id).toBe(short.entries[i]!.id);
    for (let i = 1; i < long.entries.length; i++) expect(long.entries[i]!.seqBefore).toBeGreaterThanOrEqual(long.entries[i - 1]!.seqBefore);
  });

  it('the chain verifies, and detects any edit, reordering or a wrong head', () => {
    const { initial, store } = session();
    const view = buildLedger(initial, store.getLog());
    expect(verifyLedgerChain(view)).toEqual({ ok: true });
    const tamper = (i: number, patch: Partial<LedgerEntry>): CausalLedgerView => ({ ...view, entries: view.entries.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
    expect(verifyLedgerChain(tamper(2, { summary: 'Something else' }))).toMatchObject({ ok: false, brokenAt: 2 });
    expect(verifyLedgerChain(tamper(0, { changes: [] }))).toMatchObject({ ok: false, brokenAt: 0 });
    expect(verifyLedgerChain(tamper(3, { cause: { type: 'undo', reverses: 0, reversesId: null } }))).toMatchObject({ ok: false, brokenAt: 3 });
    expect(verifyLedgerChain(tamper(4, { summaryOrigin: 'user' }))).toMatchObject({ ok: false, brokenAt: 4 });
    const swapped = [...view.entries];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(verifyLedgerChain({ ...view, entries: swapped })).toMatchObject({ ok: false, brokenAt: 1 });
    expect(verifyLedgerChain({ ...view, head: view.genesis })).toMatchObject({ ok: false, reason: 'Head does not match the last entry.' });
    // A forged hash on the last entry, with the head updated to match, is caught by the content hash check.
    const last = view.entries.length - 1;
    const forged = 'f'.repeat(16);
    expect(verifyLedgerChain({ ...tamper(last, { hash: forged }), head: forged })).toMatchObject({ ok: false, brokenAt: last, reason: 'Entry content does not match its hash.' });
    // A changed ID alone is caught too.
    expect(verifyLedgerChain(tamper(1, { id: view.entries[0]!.id }))).toMatchObject({ ok: false, brokenAt: 1, reason: 'Entry ID does not match its hash.' });
  });

  it('verifies a stored ledger against the log, and rejects a different initial world or a shorter log', () => {
    const { initial, store } = session();
    const view = buildLedger(initial, store.getLog());
    expect(verifyLedgerAgainstLog(initial, store.getLog(), view)).toEqual({ ok: true });
    const other = { ...initial, name: 'Other' };
    expect(verifyLedgerAgainstLog(other, store.getLog(), view)).toMatchObject({ ok: false, firstDifference: -1 });
    expect(verifyLedgerAgainstLog(initial, store.getLog().slice(0, 5), view)).toMatchObject({ ok: false, firstDifference: 5 });
  });

  it('an empty log gives an empty, consistent ledger whose head is the genesis hash', () => {
    const w = createEmptyWorld({ id: 'e', name: 'Empty', biome: 'void', seed: 1 });
    const view = buildLedger(w, []);
    expect(view).toMatchObject({ entries: [], head: view.genesis, consistent: true, inEffect: [], initial: stateRef(w), final: stateRef(w) });
    expect(verifyLedgerChain(view)).toEqual({ ok: true });
  });
});

describe('Causal Ledger: malformed and inconsistent input', () => {
  it('records malformed entries without throwing or changing state, and keeps applying later valid entries', () => {
    const initial = buildCrystalKingdom();
    const id = idOf(initial, 'e5');
    const valid = new WorldStore(initial);
    valid.dispatch({ type: 'entity/renamed', id, name: 'After Garbage', source: 'user' });
    const good = { ...valid.getLog()[0]!, index: 6 };
    const log: unknown[] = [
      null,
      { kind: 'bogus', ok: true },
      { kind: 'event', ok: true, event: { type: 'entity/added', source: 'user' } },
      { kind: 'event', ok: true, event: { type: 'entity/renamed', id, name: 42, source: 'user' } },
      { kind: 'batch', ok: true, events: 'nope', meta: { label: 'x', source: 'user' } },
      { kind: 'batch', ok: true, events: [{ type: 'entity/removed', id, source: 'hacker' }], meta: { label: 'x', source: 'user' } },
      good,
    ];
    let view!: CausalLedgerView;
    expect(() => (view = buildLedger(initial, log))).not.toThrow();
    expect(view.entries.map((e) => e.status)).toEqual(['malformed', 'malformed', 'malformed', 'malformed', 'malformed', 'malformed', 'applied']);
    for (const e of view.entries.slice(0, 6)) {
      expect(e.before).toEqual(stateRef(initial));
      expect(e.after).toEqual(stateRef(initial));
      expect(e.issues[0]).toMatch(/^Malformed log entry/);
    }
    expect(view.consistent).toBe(false);
    expect(view.entries[6]!.changes[0]).toMatchObject({ id, fields: ['name', 'provenance'] });
    expect(verifyLedgerChain(view)).toEqual({ ok: true }); // the chain covers malformed entries too
  });

  it('reports logs whose recorded outcomes or seqs do not replay', () => {
    const { initial, store } = session();
    const log: LogEntry[] = store.getLog().map((e) => ({ ...e }));
    log[1] = { ...log[1]!, ok: true };
    log[2] = { ...log[2]!, worldSeq: 999 };
    const view = buildLedger(initial, log);
    expect(view.consistent).toBe(false);
    expect(view.issues.map((i) => i.index)).toEqual([1, 2]);
    expect(view.issues[0]!.message).toMatch(/Replay rejected an entry recorded as applied/);
    expect(view.issues[1]!.message).toMatch(/Recorded world seq 999/);
    // The world is still exactly what the reducer allows.
    expect(view.final).toEqual(buildLedger(initial, store.getLog()).final);
  });
});

describe('Causal Ledger: live recorder', () => {
  it('records the same entries as a rebuild, without replaying, and stops after dispose', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const recorder = createLedgerRecorder(initial, store);
    const spire = idOf(initial, 'e4');
    store.dispatch({ type: 'entity/renamed', id: spire, name: 'Live', source: 'user' });
    store.dispatch({ type: 'entity/renamed', id: spire, name: '', source: 'user' });
    morph(store, [{ op: 'move', target: 'e10', direction: 'up' }, { op: 'hide', target: 'e23' }]);
    store.undo();
    store.redo();
    store.undo();
    store.dispatch({ type: 'entity/visualChanged', id: idOf(initial, 'e1'), patch: { visible: false }, source: 'user' });
    expect(JSON.stringify(recorder.view())).toBe(JSON.stringify(buildLedger(initial, store.getLog())));
    recorder.dispose();
    store.dispatch({ type: 'entity/renamed', id: spire, name: 'Unrecorded', source: 'user' });
    expect(recorder.entries()).toHaveLength(store.getLog().length - 1);
  });

  it('ingests an existing log first, then continues live', () => {
    const { initial, store } = session();
    const recorder = createLedgerRecorder(initial, store);
    store.redo();
    store.dispatch({ type: 'entity/renamed', id: idOf(initial, 'e7'), name: 'Continued', source: 'user' });
    const rebuilt = buildLedger(initial, store.getLog());
    expect(recorder.head()).toBe(rebuilt.head);
    expect(recorder.view().inEffect).toEqual(rebuilt.inEffect);
  });

  it('flags a store whose existing log does not come from the given initial world', () => {
    const { store } = session();
    const recorder = createLedgerRecorder(createEmptyWorld({ id: 'x', name: 'X', biome: 'b', seed: 1 }), store);
    expect(recorder.view().consistent).toBe(false);
  });

  it('property: 40 random sessions; recorder equals rebuild, chain verifies, no unexplained change, final state matches', () => {
    const rng = createRng(0x1ed9e7);
    for (let run = 0; run < 40; run++) {
      const initial = buildCrystalKingdom();
      const store = new WorldStore(initial, { historyLimit: rng.int(1, 6) });
      const recorder = createLedgerRecorder(initial, store);
      for (let step = 0; step < 14; step++) {
        const w = store.getState();
        const id = rng.pick(w.order);
        switch (rng.int(0, 6)) {
          case 0: store.undo(); break;
          case 1: store.redo(); break;
          case 2: store.dispatch({ type: 'entity/renamed', id, name: rng.next() < 0.2 ? '' : `N${run}-${step}`, source: 'user' }); break;
          case 3: store.dispatch({ type: 'entity/transformed', id, transform: { position: [rng.int(-5, 5), rng.int(0, 4), rng.int(-5, 5)] }, source: 'user' }); break;
          case 4: store.dispatch({ type: 'entity/visualChanged', id, patch: { visible: rng.next() < 0.5 }, source: 'user' }); break;
          case 5: store.dispatch({ type: 'entity/removed', id, source: 'user' }); break;
          default: {
            const r = validateProposal({ summary: 'Random.', operations: [{ op: 'recolor', target: `e${rng.int(1, w.order.length)}`, palette: 'Night Violet' }, { op: 'glow', target: `e${rng.int(1, w.order.length)}`, glow: rng.int(0, 8) }] });
            if (r.ok) applyMorph(store, translateMorph(w, r.proposal), { mode: 'recorded' });
          }
        }
      }
      const view = buildLedger(initial, store.getLog(), { historyLimit: store.getHistoryLimit() });
      expect(JSON.stringify(recorder.view())).toBe(JSON.stringify(view));
      expect(view.consistent, JSON.stringify(view.issues)).toBe(true);
      expect(verifyLedgerChain(view)).toEqual({ ok: true });
      expect(view.final).toEqual(stateRef(store.getState()));
      recorder.dispose();
    }
  });
});

describe('Causal Ledger: memory bounds', () => {
  it('entries hold no World objects and stay small', () => {
    const { initial, store } = session();
    const view = buildLedger(initial, store.getLog());
    const holdsWorld = (v: unknown): boolean => {
      if (!v || typeof v !== 'object') return false;
      if ('entities' in (v as object) && 'order' in (v as object)) return true;
      return Object.values(v as object).some(holdsWorld);
    };
    expect(holdsWorld(view)).toBe(false);
    const worldBytes = JSON.stringify(initial).length;
    for (const e of view.entries) expect(JSON.stringify(e).length).toBeLessThan(worldBytes / 4);
  });
});
