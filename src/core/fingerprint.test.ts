import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { canonical, entityFingerprint, fingerprint, stateRef, worldFingerprint } from './fingerprint';
import { applyEvent } from './reducer';
import { WorldStore } from './store';
import { checkEventShape, checkLogEntryShape } from './wellformed';

describe('fingerprints', () => {
  it('canonical JSON ignores key order and undefined fields, and encodes non-finite numbers distinctly', () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonical({ a: [1, { c: 3, d: 2 }], b: 1 }));
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
    expect(canonical(NaN)).not.toBe(canonical(null));
    expect(canonical(Infinity)).not.toBe(canonical(-Infinity));
  });

  it('fingerprint is 16 hex characters, deterministic and sensitive to one character', () => {
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
    expect(fingerprint('')).not.toBe(fingerprint(' '));
  });

  it('world fingerprint excludes seq but covers every entity field, order and metadata', () => {
    const w = buildCrystalKingdom();
    const fp = worldFingerprint(w);
    expect(worldFingerprint({ ...w, seq: w.seq + 5 })).toBe(fp);
    expect(worldFingerprint({ ...w, name: 'Other' })).not.toBe(fp);
    expect(worldFingerprint({ ...w, order: [...w.order].reverse() })).not.toBe(fp);
    const id = w.order[3]!;
    const r = applyEvent(w, { type: 'entity/visualChanged', id, patch: { emissiveIntensity: 7.25 }, source: 'user' });
    if (!r.ok) throw new Error(r.reason);
    expect(worldFingerprint(r.world)).not.toBe(fp);
    expect(stateRef(r.world)).toEqual({ seq: w.seq + 1, fingerprint: worldFingerprint(r.world) });
  });

  it('entity fingerprints are cached by object identity; equal content gives equal fingerprints', () => {
    const w = buildCrystalKingdom();
    const e = w.entities[w.order[0]!]!;
    expect(entityFingerprint(e)).toBe(entityFingerprint(e));
    expect(entityFingerprint(JSON.parse(JSON.stringify(e)))).toBe(entityFingerprint(e));
  });
});

describe('structural checks', () => {
  it('accept every real log entry of a session (events, batch, undo, redo)', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const id = initial.order[4]!;
    store.dispatch({ type: 'entity/renamed', id, name: 'X', source: 'user' });
    store.dispatchBatch([{ type: 'entity/visualChanged', id, patch: { visible: false }, source: 'user' }, { type: 'entity/pinnedChanged', id, pinned: true, source: 'user' }], { label: 'b', source: 'user', details: { k: 'v' } });
    store.undo();
    store.redo();
    // Rebuild the kingdom from its drafts to cover `entity/added` with visual and light components.
    const genesis = new WorldStore({ ...initial, seq: 0, entities: {}, order: [] });
    for (const id2 of initial.order) {
      const e = initial.entities[id2]!;
      const { provenance: _p, ...draft } = e;
      genesis.dispatch({ type: 'entity/added', entity: draft, source: 'system' });
    }
    for (const entry of [...store.getLog(), ...genesis.getLog()]) expect(checkLogEntryShape(entry)).toBeNull();
  });

  it('reject wrongly shaped events with a reason', () => {
    const bad: unknown[] = [
      null,
      [],
      { type: 'entity/renamed', id: 'a', name: 'x', source: 'model' },
      { type: 'entity/renamed', id: 1, name: 'x', source: 'user' },
      { type: 'entity/transformed', id: 'a', transform: { position: [1, 2] }, source: 'user' },
      { type: 'entity/transformed', id: 'a', transform: { skew: [1, 2, 3] }, source: 'user' },
      { type: 'entity/visualChanged', id: 'a', patch: { visible: 'yes' }, source: 'user' },
      { type: 'entity/visualChanged', id: 'a', patch: { archetype: 'x' }, source: 'user' },
      { type: 'entity/pinnedChanged', id: 'a', pinned: 1, source: 'user' },
      { type: 'entity/added', entity: { id: 'a', name: 'n', kind: 'k', parentId: null, tags: [1], pinned: false, components: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } }, source: 'user' },
      { type: 'entity/added', entity: { id: 'a', name: 'n', kind: 'k', parentId: null, tags: [], pinned: false, components: {} }, source: 'user' },
      { type: 'world/exploded', source: 'user' },
      { type: 'entity/renamed', id: 'a', name: 'x', source: 'user', note: 5 },
    ];
    for (const e of bad) expect(checkEventShape(e), JSON.stringify(e)).toEqual(expect.any(String));
    expect(checkLogEntryShape({ kind: 'batch', ok: true, events: [], meta: { label: 'l', source: 'user', details: { a: 1 } } })).toMatch(/details/);
    expect(checkLogEntryShape({ kind: 'undo', ok: 'yes' })).toMatch(/ok/);
  });
});
