import { describe, expect, it } from 'vitest';
import { LUMINOUS_PALETTE } from '../core/palette';
import { applyEvent, createEmptyWorld } from '../core/reducer';
import { replay } from '../core/replay';
import { WorldStore } from '../core/store';
import { asEntityId, type World, type WorldEvent } from '../core/types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildWorldContext } from './context';
import { PROPOSAL_LIMITS, type WorldProposal } from './schema';
import { canonicalJson, MOVE_STEP, translateProposal } from './translate';
import { validateProposal } from './validate';

const kingdom = () => buildCrystalKingdom();

/** Builds a proposal through the validator, exactly as model output would arrive. */
function proposal(input: unknown): WorldProposal {
  const result = validateProposal(input);
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
  return result.proposal;
}

function refOf(world: World, name: string): string {
  const entry = buildWorldContext(world).entities.find((e) => e.name === name);
  if (!entry) throw new Error(`no entity named ${name}`);
  return entry.ref;
}

const KNOWN_TYPES = new Set(['entity/added', 'entity/removed', 'entity/renamed', 'entity/transformed', 'entity/visualChanged', 'entity/pinnedChanged']);

describe('translateProposal: create', () => {
  it('turns an add operation into director-sourced entity/added events with local IDs', () => {
    const world = kingdom();
    const t = translateProposal(world, proposal({
      summary: 'A ring of violet spires.',
      operations: [{ op: 'add', archetype: 'crystalSpire', name: 'Violet Sentinel', count: 3, placement: 'inner-ring', palette: 'Night Violet', glow: 2 }],
    }));
    expect(t.accepted).toBe(1);
    expect(t.events).toHaveLength(3);
    const violet = LUMINOUS_PALETTE.find((p) => p.name === 'Night Violet')!;
    t.events.forEach((event, i) => {
      expect(event.source).toBe('director');
      expect(event.note).toContain(t.proposalKey);
      if (event.type !== 'entity/added') throw new Error('expected entity/added');
      const e = event.entity;
      expect(e.id.startsWith(`ai-${t.proposalKey}:crystalspire-`)).toBe(true);
      expect(world.entities[e.id]).toBeUndefined();
      expect(e.name).toBe(`Violet Sentinel ${['I', 'II', 'III'][i]}`);
      expect(e.parentId).toBeNull();
      expect(e.components.visual).toMatchObject({ archetype: 'crystalSpire', color: violet.color, emissive: violet.emissive, emissiveIntensity: 2, visible: true });
      const [x, y, z] = e.components.transform.position;
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThanOrEqual(10);
      expect(r).toBeLessThanOrEqual(18);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(6);
    });
    expect(t.preview.order.length).toBe(world.order.length + 3);
    expect(t.preview.entities[t.events[0]!.type === 'entity/added' ? t.events[0]!.entity.id : '']?.provenance.createdBy).toBe('director');
  });

  it('places on-target additions as children inside the target footprint', () => {
    const world = kingdom();
    const isle = refOf(world, 'Isle of Aurelion');
    const t = translateProposal(world, proposal({
      summary: 'Crystals on the main isle.',
      operations: [{ op: 'add', archetype: 'crystalCluster', name: 'Shard Garden', count: 4, placement: 'on-target', target: isle }],
    }));
    const isleId = buildWorldContext(world).refs.get(isle)!;
    const scale = world.entities[isleId]!.components.transform.scale;
    for (const event of t.events) {
      if (event.type !== 'entity/added') throw new Error('expected add');
      expect(event.entity.parentId).toBe(isleId);
      const [x, y, z] = event.entity.components.transform.position;
      expect(y).toBe(0);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(0.7 * Math.min(scale[0], scale[2]) + 1e-9);
    }
  });

  it('places near-target additions as siblings of the target', () => {
    const world = kingdom();
    const spire = refOf(world, 'Sentinel Spire I');
    const t = translateProposal(world, proposal({ summary: 'A lantern by the spire.', operations: [{ op: 'add', archetype: 'lightOrb', name: 'Lantern', placement: 'near-target', target: spire }] }));
    const spireEntity = world.entities[buildWorldContext(world).refs.get(spire)!]!;
    const event = t.events[0]!;
    if (event.type !== 'entity/added') throw new Error('expected add');
    expect(event.entity.parentId).toBe(spireEntity.parentId);
  });

  it('respects the point-light budget', () => {
    const world = kingdom();
    const existing = world.order.filter((id) => world.entities[id]?.components.light).length;
    const t = translateProposal(world, proposal({ summary: 'Many lanterns.', operations: [{ op: 'add', archetype: 'lightOrb', name: 'Lantern', count: 4, placement: 'sky' }] }));
    const withLight = t.events.filter((e) => e.type === 'entity/added' && e.entity.components.light).length;
    expect(existing + withLight).toBe(PROPOSAL_LIMITS.maxWorldLights);
    expect(t.events).toHaveLength(4);
  });

  it('keeps numbered names within the reducer limit, including emoji', () => {
    const world = kingdom();
    const longAscii = 'N'.repeat(PROPOSAL_LIMITS.maxNameLength);
    const emoji = '🔮'.repeat(PROPOSAL_LIMITS.maxNameLength / 2);
    const t = translateProposal(world, proposal({
      summary: 'Long names.',
      operations: [
        { op: 'add', archetype: 'obelisk', name: longAscii, count: 2, placement: 'outer-ring' },
        { op: 'add', archetype: 'obelisk', name: emoji, count: 2, placement: 'outer-ring' },
      ],
    }));
    expect(t.rejected).toBe(0);
    for (const event of t.events) {
      if (event.type !== 'entity/added') continue;
      expect(event.entity.name.length).toBeLessThanOrEqual(PROPOSAL_LIMITS.maxNameLength);
      expect(event.entity.name).toMatch(/ (I|II)$/);
      expect(event.entity.name).not.toMatch(/[\ud800-\udbff]$|[\ud800-\udbff](?![\udc00-\udfff])/);
    }
  });

  it('stores hostile text only as an inert entity name', () => {
    const world = kingdom();
    const t = translateProposal(world, proposal({ summary: '<script>alert(1)</script>', operations: [{ op: 'add', archetype: 'obelisk', name: '<img src=x onerror=alert(1)>', placement: 'sky' }] }));
    expect(t.events).toHaveLength(1);
    const event = t.events[0]!;
    if (event.type !== 'entity/added') throw new Error('expected add');
    expect(event.entity.name).toBe('<img src=x onerror=alert(1)>');
    expect(Object.keys(event.entity).sort()).toEqual(['components', 'id', 'kind', 'name', 'parentId', 'pinned', 'tags']);
  });
});

describe('translateProposal: edit', () => {
  it('maps every edit operation to the matching reducer event', () => {
    const world = kingdom();
    const [a, b, c, d] = ['Sentinel Spire I', 'Sentinel Spire II', 'Sentinel Spire III', 'Sentinel Spire IV'].map((n) => refOf(world, n));
    const t = translateProposal(world, proposal({
      summary: 'Edit spires.',
      operations: [
        { op: 'recolor', target: a, palette: 'Ember Gold' },
        { op: 'glow', target: a, glow: 7 },
        { op: 'rename', target: b, name: 'Warden' },
        { op: 'move', target: c, direction: 'up', steps: 2 },
        { op: 'hide', target: d },
        { op: 'show', target: d },
      ],
    }));
    expect(t.rejected).toBe(0);
    expect(t.events.map((e) => e.type)).toEqual(['entity/visualChanged', 'entity/visualChanged', 'entity/renamed', 'entity/transformed', 'entity/visualChanged', 'entity/visualChanged']);
    const ids = buildWorldContext(world).refs;
    const before = world.entities[ids.get(c!)!]!.components.transform.position;
    expect(t.preview.entities[ids.get(c!)!]!.components.transform.position).toEqual([before[0], before[1] + 2 * MOVE_STEP, before[2]]);
    expect(t.preview.entities[ids.get(a!)!]!.components.visual).toMatchObject({ color: '#ffd29a', emissive: '#ff9a3c', emissiveIntensity: 7 });
    expect(t.preview.entities[ids.get(b!)!]!.name).toBe('Warden');
    expect(t.preview.entities[ids.get(d!)!]!.components.visual?.visible).toBe(true);
  });

  it('protects pinned entities but still applies the other operations', () => {
    const world = kingdom();
    const citadel = refOf(world, 'Aurelion Citadel'); // pinned in the Crystal Kingdom
    const spire = refOf(world, 'Sentinel Spire I');
    const t = translateProposal(world, proposal({
      summary: 'Mixed.',
      operations: [
        { op: 'recolor', target: citadel, palette: 'Orchid Flare' },
        { op: 'remove', target: citadel },
        { op: 'recolor', target: spire, palette: 'Orchid Flare' },
      ],
    }));
    expect(t.outcomes.map((o) => o.status)).toEqual(['rejected', 'rejected', 'accepted']);
    expect(t.outcomes[0]!.reason).toMatch(/pinned/);
    const citadelId = buildWorldContext(world).refs.get(citadel)!;
    expect(t.preview.entities[citadelId]).toBe(world.entities[citadelId]);
  });

  it('rejects unknown refs, removed targets and reducer-invalid changes per operation', () => {
    const world = kingdom();
    const isle = refOf(world, 'Isle of Aurelion'); // has children
    const spire = refOf(world, 'Sentinel Spire II');
    const t = translateProposal(world, proposal({
      summary: 'Edge cases.',
      operations: [
        { op: 'hide', target: 'e999' },
        { op: 'remove', target: isle },
        { op: 'remove', target: spire },
        { op: 'rename', target: spire, name: 'Ghost' },
        { op: 'glow', target: refOf(world, 'Sentinel Spire III'), glow: 1.8 },
      ],
    }));
    expect(t.outcomes.map((o) => o.status)).toEqual(['rejected', 'rejected', 'accepted', 'rejected', 'rejected']);
    expect(t.outcomes[0]!.reason).toMatch(/Unknown entity ref/);
    expect(t.outcomes[1]!.reason).toMatch(/child entities/);
    expect(t.outcomes[3]!.reason).toMatch(/no longer exists/);
    expect(t.outcomes[4]!.reason).toBe('No change.');
    expect(t.events).toHaveLength(1);
  });

  it('rejects no-op visual and transform changes so history stays clean', () => {
    const world = kingdom();
    const spire = refOf(world, 'Sentinel Spire IV');
    const t = translateProposal(world, proposal({
      summary: 'No-ops.',
      operations: [
        { op: 'show', target: spire },
        { op: 'glow', target: spire, glow: 1.8 },
        { op: 'hide', target: spire },
        { op: 'hide', target: spire },
      ],
    }));
    expect(t.outcomes.map((o) => o.reason ?? o.status)).toEqual(['No change.', 'No change.', 'accepted', 'No change.']);
    expect(t.events).toHaveLength(1);
  });

  it('rejects an add that would exceed the world entity limit, atomically', () => {
    let world = createEmptyWorld({ id: 'full', name: 'Full', biome: 'test', seed: 1 });
    for (let i = 0; i < PROPOSAL_LIMITS.maxWorldEntities - 3; i++) {
      const r = applyEvent(world, {
        type: 'entity/added',
        source: 'system',
        entity: { id: asEntityId(`t:${i}`), name: `E${i}`, kind: 'crystal', parentId: null, tags: [], pinned: false, components: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } },
      });
      if (!r.ok) throw new Error(r.reason);
      world = r.world;
    }
    const t = translateProposal(world, proposal({
      summary: 'Too many.',
      operations: [
        { op: 'add', archetype: 'crystalSpire', name: 'A', count: 4, placement: 'sky' },
        { op: 'add', archetype: 'crystalSpire', name: 'B', count: 3, placement: 'sky' },
      ],
    }));
    expect(t.outcomes.map((o) => o.status)).toEqual(['rejected', 'accepted']);
    expect(t.outcomes[0]!.reason).toMatch(/world limit/);
    expect(t.preview.order.length).toBe(PROPOSAL_LIMITS.maxWorldEntities);
  });
});

describe('translateProposal: determinism, replay and repetition', () => {
  const create = () => proposal({
    summary: 'Islands and wisps.',
    operations: [
      { op: 'add', archetype: 'floatingIsland', name: 'Drift Isle', count: 2, placement: 'outer-ring' },
      { op: 'add', archetype: 'lightOrb', name: 'Wisp', count: 2, placement: 'sky', palette: 'Aurora Mint' },
      { op: 'recolor', target: 'e5', palette: 'Moon White' },
    ],
  });

  it('is deterministic for the same world and proposal', () => {
    const a = translateProposal(kingdom(), create());
    const b = translateProposal(kingdom(), create());
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.proposalKey).toBe(b.proposalKey);
  });

  it('ignores key order in model output', () => {
    const shuffled = proposal({
      operations: [
        { placement: 'outer-ring', count: 2, name: 'Drift Isle', archetype: 'floatingIsland', op: 'add' },
        { palette: 'Aurora Mint', placement: 'sky', count: 2, name: 'Wisp', archetype: 'lightOrb', op: 'add' },
        { palette: 'Moon White', target: 'e5', op: 'recolor' },
      ],
      summary: 'Islands and wisps.',
    });
    expect(canonicalJson(shuffled)).toBe(canonicalJson(create()));
    expect(JSON.stringify(translateProposal(kingdom(), shuffled).events)).toBe(JSON.stringify(translateProposal(kingdom(), create()).events));
  });

  it('replays to exactly the previewed world, through replay() and through the store', () => {
    const world = kingdom();
    const t = translateProposal(world, create());
    const replayed = replay(world, t.events);
    expect(replayed.rejected).toEqual([]);
    expect(JSON.stringify(replayed.world)).toBe(JSON.stringify(t.preview));

    const store = new WorldStore(world);
    for (const event of t.events) expect(store.dispatch(event).ok).toBe(true);
    expect(JSON.stringify(store.getState())).toBe(JSON.stringify(t.preview));
  });

  it('gives a repeated proposal fresh IDs, with no collisions and a clean replay', () => {
    const world = kingdom();
    const first = translateProposal(world, create());
    const second = translateProposal(first.preview, create());
    expect(second.proposalKey).not.toBe(first.proposalKey);
    expect(first.outcomes.map((o) => o.status)).toEqual(['accepted', 'accepted', 'accepted']);
    // The additions repeat with fresh IDs; the recolour is already in effect, so it is a no-op.
    expect(second.outcomes.map((o) => o.status)).toEqual(['accepted', 'accepted', 'rejected']);
    expect(second.outcomes[2]!.reason).toBe('No change.');
    const ids = (t: typeof first) => t.events.flatMap((e) => (e.type === 'entity/added' ? [e.entity.id] : []));
    const overlap = ids(first).filter((id) => ids(second).includes(id));
    expect(overlap).toEqual([]);
    const all = replay(world, [...first.events, ...second.events]);
    expect(all.rejected).toEqual([]);
    expect(JSON.stringify(all.world)).toBe(JSON.stringify(second.preview));
  });

  it('produces different layouts for different world seeds', () => {
    const a = translateProposal(buildCrystalKingdom(1), create());
    const b = translateProposal(buildCrystalKingdom(2), create());
    const pos = (t: typeof a) => t.events.flatMap((e) => (e.type === 'entity/added' ? [e.entity.components.transform.position] : []));
    expect(pos(a)).not.toEqual(pos(b));
  });

  it('leaves untouched entities referentially unchanged and emits only known event types', () => {
    const world = kingdom();
    const t = translateProposal(world, create());
    for (const event of t.events) expect(KNOWN_TYPES.has(event.type)).toBe(true);
    const touched = new Set(t.outcomes.flatMap((o) => o.entityIds));
    for (const id of world.order) if (!touched.has(id)) expect(t.preview.entities[id]).toBe(world.entities[id]);
  });

  it('does not mutate the input world or proposal', () => {
    const world = kingdom();
    const p = create();
    const before = JSON.stringify(world);
    translateProposal(world, p);
    expect(JSON.stringify(world)).toBe(before);
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('keeps the Crystal Kingdom editor workflow intact after applying a proposal', () => {
    const store = new WorldStore(kingdom());
    const t = translateProposal(store.getState(), create());
    t.events.forEach((e: WorldEvent) => store.dispatch(e));
    const added = t.outcomes[0]!.entityIds[0]!;
    expect(store.dispatch({ type: 'entity/renamed', id: added, name: 'Edited by hand', source: 'user' }).ok).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.getState().entities[added]?.name).toBe('Drift Isle I');
  });
});
