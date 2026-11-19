import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { applyEvent, createEmptyWorld } from '../core/reducer';
import { replayLog } from '../core/replay';
import { WorldStore } from '../core/store';
import { asEntityId, type EntityDraft, type EntityId, type World, type WorldEvent } from '../core/types';
import { effectiveVisible, posesEqual, worldPose } from '../core/pose';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildWorldContext } from './context';
import {
  applyMorph,
  checkPinnedInvariant,
  describePolicy,
  MORPH_POLICY_STATUS,
  pinClosure,
  pinnedHash,
  APPROVED_MORPH_POLICY,
  translateMorph,
  type MorphPolicy,
} from './morph';
import { ARCHETYPES, DIRECTIONS, PALETTE_NAMES, PLACEMENTS, type WorldProposal } from './schema';
import { translateProposal } from './translate';
import { parseProposalText, validateProposal } from './validate';

// Default Crystal Kingdom refs: e1 Isle of Aurelion (parent of pinned e2 Aurelion Citadel),
// e3 Celestial Halo (child of e2), e4–e9 spires (children of e1), e10 Veilstone Reach, e11 its cluster.
const kingdom = () => buildCrystalKingdom();
const policy = (p: Partial<MorphPolicy> = {}): MorphPolicy => ({ ...APPROVED_MORPH_POLICY, ...p });

function proposal(operations: unknown[], summary = 'Morph the kingdom.'): WorldProposal {
  const r = validateProposal({ summary, operations });
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
  return r.proposal;
}

const idOf = (w: World, ref: string) => buildWorldContext(w).refs.get(ref)!;
const byName = (w: World, name: string) => Object.values(w.entities).find((e) => e.name === name)!;

function pin(store: WorldStore, id: EntityId) {
  const r = store.dispatch({ type: 'entity/pinnedChanged', id, pinned: true, source: 'user' });
  if (!r.ok) throw new Error(r.reason);
}

/** Structural invariants every world must satisfy. */
function assertConsistent(w: World) {
  expect(new Set(w.order).size).toBe(w.order.length);
  expect([...w.order].sort()).toEqual(Object.keys(w.entities).sort());
  w.order.forEach((id, i) => {
    const parent = w.entities[id]!.parentId;
    if (parent) {
      expect(w.entities[parent], `parent of ${id}`).toBeDefined();
      expect(w.order.indexOf(parent)).toBeLessThan(i);
    }
  });
}

const VIOLET_DUSK = [
  { op: 'recolor', target: 'e4', palette: 'Night Violet' },
  { op: 'recolor', target: 'e6', palette: 'Night Violet' },
  { op: 'recolor', target: 'e8', palette: 'Night Violet' },
  { op: 'recolor', target: 'e1', palette: 'Night Violet' },
  { op: 'glow', target: 'e20', glow: 2.5 },
  { op: 'hide', target: 'e3' },
];

describe('policy status', () => {
  it('ships the WW-031 approved defaults (policies A, B, C)', () => {
    expect(MORPH_POLICY_STATUS.approved).toBe(true);
    expect(MORPH_POLICY_STATUS.issue).toBe('WW-031');
    expect(MORPH_POLICY_STATUS.approvedOn).toBe('2026-11-19');
    expect(Object.isFrozen(MORPH_POLICY_STATUS)).toBe(true);
    expect(APPROVED_MORPH_POLICY).toEqual({ onPinViolation: 'reject-proposal', protectAncestors: true, allowAddToPinned: true });
    expect(Object.isFrozen(APPROVED_MORPH_POLICY)).toBe(true);
    expect(describePolicy(APPROVED_MORPH_POLICY)).toBe('reject-proposal;ancestors=protected;addToPinned=allowed');
  });
});

describe('pinClosure', () => {
  it('finds the pinned citadel and its protected ancestor in the Crystal Kingdom', () => {
    const w = kingdom();
    const c = pinClosure(w);
    expect(c.pinned).toEqual([byName(w, 'Aurelion Citadel').id]);
    expect(c.protectedAncestors).toEqual([byName(w, 'Isle of Aurelion').id]);
    expect(c.protects.get(byName(w, 'Isle of Aurelion').id)).toBe(byName(w, 'Aurelion Citadel').id);
  });

  it('handles deep chains, shared ancestors, pinned ancestors and no pins', () => {
    const draft = (id: string, parent: string | null): EntityDraft => ({
      id: asEntityId(id), name: id, kind: 'crystal', parentId: parent ? asEntityId(parent) : null, tags: [], pinned: false,
      components: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });
    let w = createEmptyWorld({ id: 'w', name: 'W', biome: 'b', seed: 1 });
    for (const [id, p] of [['a', null], ['b', 'a'], ['c', 'b'], ['d', 'c'], ['x', 'a'], ['y', null]] as const) {
      const r = applyEvent(w, { type: 'entity/added', entity: draft(id, p), source: 'system' });
      if (!r.ok) throw new Error(r.reason);
      w = r.world;
    }
    expect(pinClosure(w)).toMatchObject({ pinned: [], protectedAncestors: [] });
    const pinIt = (world: World, id: string) => {
      const r = applyEvent(world, { type: 'entity/pinnedChanged', id: asEntityId(id), pinned: true, source: 'user' });
      if (!r.ok) throw new Error(r.reason);
      return r.world;
    };
    w = pinIt(w, 'd');
    expect(pinClosure(w).protectedAncestors).toEqual(['a', 'b', 'c']);
    w = pinIt(w, 'x'); // shares ancestor a
    expect(pinClosure(w).protectedAncestors).toEqual(['a', 'b', 'c']);
    w = pinIt(w, 'b'); // a pinned entity is not listed as an ancestor
    expect(pinClosure(w).pinned).toEqual(['b', 'd', 'x']);
    expect(pinClosure(w).protectedAncestors).toEqual(['a', 'c']);
  });

  it('pinnedHash is order-independent and changes with the pinned set', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(asEntityId) as [EntityId, EntityId, EntityId];
    expect(pinnedHash([a, b])).toBe(pinnedHash([b, a]));
    expect(pinnedHash([a, b])).not.toBe(pinnedHash([a, c]));
  });
});

describe('translateMorph: pin rules', () => {
  it('rejects moving, hiding and removing a pinned entity\'s ancestor, naming both entities', () => {
    const w = kingdom();
    for (const op of [
      { op: 'move', target: 'e1', direction: 'up' },
      { op: 'hide', target: 'e1' },
      { op: 'remove', target: 'e1' },
    ]) {
      const t = translateMorph(w, proposal([op]));
      const o = t.outcomes[0]!;
      expect(o.status, op.op).toBe('rejected');
      expect(o.rule).toBe('pinned-ancestor');
      expect(o.reason).toContain('“Isle of Aurelion”');
      expect(o.reason).toContain('“Aurelion Citadel”');
      expect(t.applicable).toBe(false);
    }
  });

  it('rejects showing a hidden ancestor too (visibility would change)', () => {
    const store = new WorldStore(kingdom());
    store.dispatch({ type: 'entity/visualChanged', id: idOf(store.getState(), 'e1'), patch: { visible: false }, source: 'user' });
    const t = translateMorph(store.getState(), proposal([{ op: 'show', target: 'e1' }]));
    expect(t.outcomes[0]).toMatchObject({ status: 'rejected', rule: 'pinned-ancestor' });
    expect(t.outcomes[0]!.reason).toMatch(/^Showing/);
  });

  it('allows recolouring, glowing and renaming an ancestor', () => {
    const t = translateMorph(kingdom(), proposal([
      { op: 'recolor', target: 'e1', palette: 'Night Violet' },
      { op: 'glow', target: 'e1', glow: 1 },
      { op: 'rename', target: 'e1', name: 'Isle of Dusk' },
    ]));
    expect(t.rejected).toBe(0);
    expect(t.applicable).toBe(true);
    expect(t.violations).toEqual([]);
  });

  it('keeps direct pinned protection (rule "pinned")', () => {
    const t = translateMorph(kingdom(), proposal([{ op: 'recolor', target: 'e2', palette: 'Orchid Flare' }]));
    expect(t.outcomes[0]).toMatchObject({ status: 'rejected', rule: 'pinned' });
  });

  it('leaves descendants of a pinned entity free to change', () => {
    const w = kingdom();
    const t = translateMorph(w, proposal([{ op: 'move', target: 'e3', direction: 'up' }, { op: 'hide', target: 'e3' }]));
    expect(t.rejected).toBe(0);
    expect(t.applicable).toBe(true);
    const citadel = byName(w, 'Aurelion Citadel').id;
    expect(t.preview.entities[citadel]).toBe(w.entities[citadel]);
  });

  it('allows adding children to a pinned entity by default, and blocks it when the policy says so', () => {
    const add = [{ op: 'add', archetype: 'lightOrb', name: 'Citadel Lantern', placement: 'on-target', target: 'e2' }];
    const allowed = translateMorph(kingdom(), proposal(add));
    expect(allowed.applicable).toBe(true);
    const blocked = translateMorph(kingdom(), proposal(add), policy({ allowAddToPinned: false }));
    expect(blocked.outcomes[0]).toMatchObject({ status: 'rejected', rule: 'pinned-parent' });
    expect(blocked.applicable).toBe(false);
  });

  it('protects ancestors of entities pinned by the user during the session', () => {
    const store = new WorldStore(kingdom());
    pin(store, idOf(store.getState(), 'e11')); // Veilstone Cluster I, child of e10
    const t = translateMorph(store.getState(), proposal([{ op: 'move', target: 'e10', direction: 'down' }]));
    expect(t.outcomes[0]).toMatchObject({ status: 'rejected', rule: 'pinned-ancestor' });
    expect(t.pinned).toHaveLength(2);
  });
});

describe('translateMorph: policies and the invariant', () => {
  const mixed = [
    { op: 'move', target: 'e1', direction: 'up' },
    { op: 'recolor', target: 'e4', palette: 'Night Violet' },
  ];

  it('reject-proposal: one pin violation blocks the whole morph', () => {
    const t = translateMorph(kingdom(), proposal(mixed));
    expect(t.accepted).toBe(1);
    expect(t.pinRejections).toBe(1);
    expect(t.applicable).toBe(false);
    expect(t.blockedReason).toMatch(/morph policy rejects the whole morph/);
  });

  it('drop-operation: pin violations are dropped and listed; the rest applies', () => {
    const w = kingdom();
    const t = translateMorph(w, proposal(mixed), policy({ onPinViolation: 'drop-operation' }));
    expect(t.applicable).toBe(true);
    expect(t.outcomes.map((o) => o.status)).toEqual(['rejected', 'accepted']);
    expect(t.events).toHaveLength(1);
    const store = new WorldStore(w);
    expect(applyMorph(store, t, { mode: 'recorded' }).ok).toBe(true);
    expect(checkPinnedInvariant(w, store.getState())).toEqual([]);
  });

  it('drop-operation still blocks on non-pin rejections (all-or-nothing otherwise)', () => {
    const t = translateMorph(kingdom(), proposal([...mixed, { op: 'hide', target: 'e999' }]), policy({ onPinViolation: 'drop-operation' }));
    expect(t.applicable).toBe(false);
    expect(t.blockedReason).toMatch(/1 operation was rejected/);
  });

  it('the invariant is an independent second layer: it blocks what a disabled ancestor rule lets through', () => {
    const free = policy({ protectAncestors: false });
    const move = translateMorph(kingdom(), proposal([{ op: 'move', target: 'e1', direction: 'up' }]), free);
    expect(move.outcomes[0]!.status).toBe('accepted');
    expect(move.violations.map((v) => v.kind)).toEqual(['pose']);
    expect(move.applicable).toBe(false);
    const hide = translateMorph(kingdom(), proposal([{ op: 'hide', target: 'e1' }]), free);
    expect(hide.violations.map((v) => v.kind)).toEqual(['visibility']);
    expect(hide.applicable).toBe(false);
  });

  it('checkPinnedInvariant detects removal and data changes', () => {
    const w = kingdom();
    const citadel = byName(w, 'Aurelion Citadel').id;
    const renamed = applyEvent(w, { type: 'entity/renamed', id: citadel, name: 'Changed', source: 'user' });
    if (!renamed.ok) throw new Error('setup');
    expect(checkPinnedInvariant(w, renamed.world).map((v) => v.kind)).toEqual(['data']);
    const { [citadel]: _gone, ...rest } = w.entities;
    const removed: World = { ...w, entities: rest, order: w.order.filter((id) => id !== citadel) };
    expect(checkPinnedInvariant(w, removed).map((v) => v.kind)).toEqual(['removed']);
    expect(checkPinnedInvariant(w, w)).toEqual([]);
  });

  it('a morph with no applicable changes is blocked, and an empty action set is rejected by the validator', () => {
    const t = translateMorph(kingdom(), proposal([{ op: 'hide', target: 'e999' }]));
    expect(t.events).toHaveLength(0);
    expect(t.blockedReason).toBe('The morph contains no applicable changes.');
    const empty = parseProposalText(JSON.stringify({ summary: 'Nothing', operations: [] }));
    expect(empty.ok).toBe(false);
  });

  it('works on an empty world: additions apply, edits find no targets', () => {
    const w = createEmptyWorld({ id: 'e', name: 'Empty', biome: 'void', seed: 9 });
    const add = translateMorph(w, proposal([{ op: 'add', archetype: 'floatingIsland', name: 'First Isle', placement: 'center' }]));
    expect(add.applicable).toBe(true);
    expect(add.pinned).toEqual([]);
    const edit = translateMorph(w, proposal([{ op: 'hide', target: 'e1' }]));
    expect(edit.applicable).toBe(false);
  });

  it('does not change behaviour of plain Director translation', () => {
    const p = proposal([{ op: 'move', target: 'e1', direction: 'up' }]);
    expect(translateProposal(kingdom(), p).applicable).toBe(true); // Edit mode keeps Phase 2 rules
    expect(translateMorph(kingdom(), p).applicable).toBe(false);
  });
});

describe('applyMorph: atomicity, undo/redo, metadata', () => {
  it('applies a morph as one undo step; redo restores identical objects; pinned entity untouched', () => {
    const w = kingdom();
    const store = new WorldStore(w);
    const t = translateMorph(w, proposal(VIOLET_DUSK, 'Violet dusk.'));
    expect(t.applicable).toBe(true);
    expect(applyMorph(store, t, { mode: 'recorded', recordingId: 'morph-violet-dusk' }).ok).toBe(true);
    const after = store.getState();
    expect(JSON.stringify(after)).toBe(JSON.stringify(t.preview));
    expect(checkPinnedInvariant(w, after)).toEqual([]);
    const citadel = byName(w, 'Aurelion Citadel').id;
    expect(after.entities[citadel]).toBe(w.entities[citadel]);

    const entry = store.getLog().at(-1)!;
    expect(entry).toMatchObject({ kind: 'batch', ok: true });
    expect(entry.meta?.label).toBe('Morph (recorded): Violet dusk.');
    expect(entry.meta?.details).toMatchObject({
      kind: 'morph',
      pinnedCount: '1',
      pinnedHash: pinnedHash([citadel]),
      policy: 'reject-proposal;ancestors=protected;addToPinned=allowed',
      policyApproved: 'true',
      pinRejections: '0',
      mode: 'recorded',
      recordingId: 'morph-violet-dusk',
      proposalKey: t.proposalKey,
    });
    expect(Object.values(entry.meta?.details ?? {}).join(' ')).not.toContain('Violet dusk');

    expect(store.undo()).toBe(true);
    expect(store.canUndo()).toBe(false);
    expect(store.getState().entities).toEqual(w.entities);
    expect(store.redo()).toBe(true);
    for (const id of after.order) expect(store.getState().entities[id]).toBe(after.entities[id]);
  });

  it('rolls back completely if any event fails at dispatch, keeping redo history', () => {
    const w = kingdom();
    const store = new WorldStore(w);
    store.dispatch({ type: 'entity/renamed', id: idOf(w, 'e5'), name: 'Temp', source: 'user' });
    store.undo();
    const before = store.getState();
    const t = translateMorph(before, proposal(VIOLET_DUSK));
    const bad: WorldEvent = { type: 'entity/renamed', id: asEntityId('missing'), name: 'x', source: 'director' };
    const tampered = { ...t, events: [...t.events, bad] };
    const r = applyMorph(store, tampered, { mode: 'live' });
    expect(r).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(store.getState()).toBe(before);
    expect(store.canRedo()).toBe(true);
    expect(store.getLog().at(-1)).toMatchObject({ kind: 'batch', ok: false });
  });

  it('refuses blocked and stale morphs without touching the world', () => {
    const store = new WorldStore(kingdom());
    const blocked = translateMorph(store.getState(), proposal([{ op: 'move', target: 'e1', direction: 'up' }]));
    expect(applyMorph(store, blocked, { mode: 'live' })).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
    const t = translateMorph(store.getState(), proposal(VIOLET_DUSK));
    store.dispatch({ type: 'entity/renamed', id: idOf(store.getState(), 'e5'), name: 'Meanwhile', source: 'user' });
    expect(applyMorph(store, t, { mode: 'live' })).toMatchObject({ ok: false, code: 'STALE' });
    expect(store.getLog().filter((e) => e.kind === 'batch')).toHaveLength(0);
  });

  it('repeated morphs: each is one step; undoing all returns to the original entities', () => {
    const w = kingdom();
    const store = new WorldStore(w);
    const morphs = [
      VIOLET_DUSK,
      [{ op: 'recolor', target: 'e5', palette: 'Ember Gold' }, { op: 'move', target: 'e12', direction: 'down' }, { op: 'add', archetype: 'obelisk', name: 'Ember Spire', placement: 'outer-ring', palette: 'Ember Gold' }],
      [{ op: 'recolor', target: 'e4', palette: 'Aurora Mint' }, { op: 'hide', target: 'e23' }, { op: 'rename', target: 'e1', name: 'Isle of Ash' }],
    ];
    const states: World[] = [w];
    for (const ops of morphs) {
      const t = translateMorph(store.getState(), proposal(ops));
      expect(t.applicable, JSON.stringify(t.outcomes)).toBe(true);
      expect(applyMorph(store, t, { mode: 'recorded' }).ok).toBe(true);
      assertConsistent(store.getState());
      expect(checkPinnedInvariant(w, store.getState())).toEqual([]); // pinned unchanged since genesis
      states.push(store.getState());
    }
    for (let i = morphs.length - 1; i >= 0; i--) {
      store.undo();
      expect(store.getState().entities).toEqual(states[i]!.entities);
    }
    for (let i = 1; i <= morphs.length; i++) {
      store.redo();
      expect(store.getState().entities).toEqual(states[i]!.entities);
    }
  });

  it('is deterministic and replays exactly with morphs, user edits, undo and redo (no model call)', () => {
    const w = kingdom();
    const a = translateMorph(w, proposal(VIOLET_DUSK));
    const b = translateMorph(w, proposal(VIOLET_DUSK));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));

    const store = new WorldStore(w);
    applyMorph(store, a, { mode: 'live', model: 'gemini-3.5-flash-lite', requestId: 'r1' });
    store.dispatch({ type: 'entity/renamed', id: idOf(w, 'e5'), name: 'Hand Edit', source: 'user' });
    store.undo();
    store.redo();
    const t2 = translateMorph(store.getState(), proposal([{ op: 'recolor', target: 'e5', palette: 'Moon White' }]));
    applyMorph(store, t2, { mode: 'live' });
    store.undo();
    const replayed = replayLog(w, store.getLog());
    expect(replayed.mismatches).toEqual([]);
    expect(JSON.stringify(replayed.world)).toBe(JSON.stringify(store.getState()));
  });
});

describe('property: random morphs never change pinned entities', () => {
  it('holds across 60 seeded random morphs with random user pins', () => {
    const rng = createRng(0xdecafbad);
    let applied = 0;
    let blocked = 0;
    for (let run = 0; run < 60; run++) {
      const store = new WorldStore(kingdom());
      // Pin up to two random extra entities.
      for (let k = rng.int(0, 2); k > 0; k--) {
        const id = rng.pick(store.getState().order);
        if (!store.getState().entities[id]!.pinned) pin(store, id);
      }
      for (let step = 0; step < 3; step++) {
        const world = store.getState();
        const n = world.order.length;
        const ref = () => `e${rng.int(1, n)}`;
        const ops = Array.from({ length: rng.int(1, 5) }, () => {
          switch (rng.int(0, 6)) {
            case 0: return { op: 'move', target: ref(), direction: rng.pick(DIRECTIONS), steps: rng.int(1, 3) };
            case 1: return { op: 'hide', target: ref() };
            case 2: return { op: 'show', target: ref() };
            case 3: return { op: 'recolor', target: ref(), palette: rng.pick(PALETTE_NAMES) };
            case 4: return { op: 'glow', target: ref(), glow: Math.round(rng.range(0, 10) * 10) / 10 };
            case 5: return { op: 'rename', target: ref(), name: `Morph ${run}-${step}` };
            default: {
              const placement = rng.pick(PLACEMENTS);
              const targeted = placement === 'on-target' || placement === 'near-target';
              return { op: 'add', archetype: rng.pick(ARCHETYPES.filter((a) => a !== 'crystalCitadel')), name: 'Random', placement, ...(targeted ? { target: ref() } : {}) };
            }
          }
        });
        const t = translateMorph(world, proposal(ops), policy({ onPinViolation: rng.next() < 0.5 ? 'reject-proposal' : 'drop-operation' }));
        if (!t.applicable) {
          blocked += 1;
          continue;
        }
        expect(applyMorph(store, t, { mode: 'recorded' }).ok).toBe(true);
        applied += 1;
        const after = store.getState();
        expect(checkPinnedInvariant(world, after)).toEqual([]);
        for (const id of t.pinned) {
          expect(posesEqual(worldPose(world, id)!, worldPose(after, id)!)).toBe(true);
          expect(effectiveVisible(after, id)).toBe(effectiveVisible(world, id));
        }
        assertConsistent(after);
      }
    }
    // The property is only meaningful if both outcomes occur.
    expect(applied).toBeGreaterThan(20);
    expect(blocked).toBeGreaterThan(5);
  });
});
