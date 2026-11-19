/**
 * WW-031 approved World Morph defaults (2026-11-19):
 *   A. reject the whole morph if it would modify an existing pinned entity;
 *   B. protect ancestors of pinned entities (inherited position and visibility);
 *   C. allow new children under pinned entities while the pinned entity's data,
 *      world pose and visibility stay unchanged.
 * Every violation is rejected atomically: the store is not touched.
 */
import { describe, expect, it } from 'vitest';
import { applyEvent } from '../core/reducer';
import { effectiveVisible, posesEqual, worldPose } from '../core/pose';
import { WorldStore } from '../core/store';
import { asEntityId, type EntityId, type World } from '../core/types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildWorldContext } from './context';
import { APPROVED_MORPH_POLICY, applyMorph, checkPinnedInvariant, translateMorph } from './morph';
import type { WorldProposal } from './schema';
import { validateProposal } from './validate';

function proposal(operations: unknown[]): WorldProposal {
  const r = validateProposal({ summary: 'Policy check.', operations });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
  return r.proposal;
}

const idOf = (w: World, ref: string) => buildWorldContext(w).refs.get(ref)!;
const citadelOf = (w: World) => Object.values(w.entities).find((e) => e.name === 'Aurelion Citadel')!.id;

/** Applies a morph expected to be blocked and checks the store did not change at all. */
function expectBlocked(store: WorldStore, ops: unknown[]) {
  const before = store.getState();
  const logLength = store.getLog().length;
  const t = translateMorph(before, proposal(ops));
  expect(t.applicable).toBe(false);
  const out = applyMorph(store, t, { mode: 'recorded' });
  expect(out).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
  expect(store.getState()).toBe(before);
  expect(store.getLog()).toHaveLength(logLength);
  return t;
}

describe('WW-031 policy A: pinned entities are never modified', () => {
  const VALID = { op: 'recolor', target: 'e4', palette: 'Night Violet' };
  const ON_PINNED = [
    { op: 'rename', target: 'e2', name: 'Changed Citadel' },
    { op: 'recolor', target: 'e2', palette: 'Orchid Flare' },
    { op: 'glow', target: 'e2', glow: 9 },
    { op: 'hide', target: 'e2' },
    { op: 'move', target: 'e2', direction: 'up' },
    { op: 'remove', target: 'e2' },
  ];

  it('rejects every mutating operation on a pinned entity with rule "pinned"', () => {
    for (const op of ON_PINNED) {
      const t = translateMorph(buildCrystalKingdom(), proposal([op]));
      expect(t.outcomes[0], op.op).toMatchObject({ status: 'rejected', rule: 'pinned' });
      expect(t.applicable, op.op).toBe(false);
    }
  });

  it('rejects the whole morph, including its valid operations, and leaves the store unchanged', () => {
    for (const op of ON_PINNED) {
      const store = new WorldStore(buildCrystalKingdom());
      const t = expectBlocked(store, [VALID, op, { op: 'glow', target: 'e6', glow: 3 }]);
      expect(t.accepted).toBe(2);
      expect(t.pinRejections).toBe(1);
      expect(t.blockedReason).toMatch(/rejects the whole morph/);
    }
  });

  it('protects entities pinned by the user during the session in the same way', () => {
    const store = new WorldStore(buildCrystalKingdom());
    store.dispatch({ type: 'entity/pinnedChanged', id: idOf(store.getState(), 'e4'), pinned: true, source: 'user' });
    expectBlocked(store, [{ op: 'recolor', target: 'e5', palette: 'Night Violet' }, { op: 'recolor', target: 'e4', palette: 'Night Violet' }]);
  });
});

describe('WW-031 policy B: ancestors of pinned entities are protected', () => {
  /**
   * Builds a three-level chain without the default pin:
   *   e1 Isle of Aurelion → e4 spire → Spire Lantern (pinned)
   */
  function chain() {
    const store = new WorldStore(buildCrystalKingdom());
    const w = store.getState();
    store.dispatch({ type: 'entity/pinnedChanged', id: citadelOf(w), pinned: false, source: 'user' });
    const spire = idOf(w, 'e4');
    const lantern = asEntityId('user:spire-lantern');
    const added = store.dispatch({
      type: 'entity/added',
      source: 'user',
      entity: {
        id: lantern, name: 'Spire Lantern', kind: 'light', parentId: spire, tags: [], pinned: true,
        components: { transform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visual: { archetype: 'lightOrb', color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1, visible: true } },
      },
    });
    if (!added.ok) throw new Error(added.reason);
    return { store, spire, lantern, isle: idOf(w, 'e1') };
  }

  it('rejects moving, hiding or removing the parent and the grandparent of a pinned entity', () => {
    const { store } = chain();
    for (const op of [
      { op: 'move', target: 'e1', direction: 'left' },
      { op: 'hide', target: 'e1' },
      { op: 'move', target: 'e4', direction: 'down', steps: 2 },
      { op: 'hide', target: 'e4' },
      { op: 'remove', target: 'e4' },
    ]) {
      const t = expectBlocked(store, [op]);
      expect(t.outcomes[0], `${op.op} ${op.target}`).toMatchObject({ status: 'rejected', rule: 'pinned-ancestor' });
      expect(t.outcomes[0]!.reason).toContain('“Spire Lantern”');
    }
  });

  it('allows changes to an ancestor that cannot affect the pinned descendant', () => {
    const { store, lantern } = chain();
    const before = store.getState();
    const t = translateMorph(before, proposal([
      { op: 'recolor', target: 'e4', palette: 'Night Violet' },
      { op: 'glow', target: 'e1', glow: 2 },
      { op: 'rename', target: 'e4', name: 'Lantern Spire' },
    ]));
    expect(t.applicable).toBe(true);
    expect(applyMorph(store, t, { mode: 'recorded' }).ok).toBe(true);
    expect(store.getState().entities[lantern]).toBe(before.entities[lantern]);
  });

  it('the invariant independently catches inherited rotation and visibility changes; scale is not inherited', () => {
    const { store, spire, lantern } = chain();
    const w = store.getState();
    const step = (world: World, event: Parameters<typeof applyEvent>[1]) => {
      const r = applyEvent(world, event);
      if (!r.ok) throw new Error(r.reason);
      return r.world;
    };
    const rotated = step(w, { type: 'entity/transformed', id: spire, transform: { rotation: [0, 0, 0.5] }, source: 'director' });
    expect(checkPinnedInvariant(w, rotated).map((v) => v.kind)).toEqual(['pose']);
    const hidden = step(w, { type: 'entity/visualChanged', id: spire, patch: { visible: false }, source: 'director' });
    expect(checkPinnedInvariant(w, hidden).map((v) => v.kind)).toEqual(['visibility']);
    const scaled = step(w, { type: 'entity/transformed', id: spire, transform: { scale: [2, 2, 2] }, source: 'director' });
    expect(checkPinnedInvariant(w, scaled)).toEqual([]);
    expect(posesEqual(worldPose(w, lantern)!, worldPose(scaled, lantern)!)).toBe(true);
  });
});

describe('WW-031 policy C: safe child additions under pinned entities', () => {
  const ADD = { op: 'add', archetype: 'lightOrb', name: 'Citadel Lantern', placement: 'on-target', target: 'e2' };

  it('adds the child and leaves the pinned entity byte-identical, in place and visible', () => {
    const w = buildCrystalKingdom();
    const store = new WorldStore(w);
    const citadel = citadelOf(w);
    const t = translateMorph(w, proposal([ADD]));
    expect(t.applicable).toBe(true);
    expect(applyMorph(store, t, { mode: 'recorded' }).ok).toBe(true);
    const after = store.getState();
    const child = Object.values(after.entities).find((e) => e.name === 'Citadel Lantern')!;
    expect(child.parentId).toBe(citadel);
    expect(child.pinned).toBe(false);
    expect(after.entities[citadel]).toBe(w.entities[citadel]);
    expect(posesEqual(worldPose(w, citadel)!, worldPose(after, citadel)!)).toBe(true);
    expect(effectiveVisible(after, citadel)).toBe(effectiveVisible(w, citadel));
    expect(checkPinnedInvariant(w, after)).toEqual([]);
  });

  it('rejects the whole morph if the addition comes with a change that would move the pinned entity', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const t = expectBlocked(store, [ADD, { op: 'move', target: 'e1', direction: 'up' }]);
    expect(t.outcomes.map((o) => o.status)).toEqual(['accepted', 'rejected']);
  });

  it('the new, unpinned child can be changed by a later morph without affecting its pinned parent', () => {
    const w = buildCrystalKingdom();
    const store = new WorldStore(w);
    expect(applyMorph(store, translateMorph(w, proposal([ADD])), { mode: 'recorded' }).ok).toBe(true);
    const mid = store.getState();
    const lantern = Object.values(mid.entities).find((e) => e.name === 'Citadel Lantern')!.id as EntityId;
    const ref = [...buildWorldContext(mid).refs].find(([, id]) => id === lantern)![0];
    const t = translateMorph(mid, proposal([{ op: 'move', target: ref, direction: 'up' }, { op: 'glow', target: ref, glow: 6 }]));
    expect(t.applicable).toBe(true);
    expect(applyMorph(store, t, { mode: 'recorded' }).ok).toBe(true);
    expect(checkPinnedInvariant(w, store.getState())).toEqual([]);
  });

  it('is the default; the approved policy object is frozen', () => {
    expect(APPROVED_MORPH_POLICY.allowAddToPinned).toBe(true);
    expect(Object.isFrozen(APPROVED_MORPH_POLICY)).toBe(true);
  });
});
