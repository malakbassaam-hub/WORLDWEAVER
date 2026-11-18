import { describe, expect, it } from 'vitest';
import { applyEvent, childrenOf, createEmptyWorld } from './reducer';
import { asEntityId, type EntityDraft, type World, type WorldEvent } from './types';

const A = asEntityId('t:a');
const B = asEntityId('t:b');

function draft(id: string, overrides: Partial<EntityDraft> = {}): EntityDraft {
  return {
    id: asEntityId(id),
    name: `Entity ${id}`,
    kind: 'crystal',
    parentId: null,
    tags: [],
    pinned: false,
    components: {
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visual: { archetype: 'crystalSpire', color: '#112233', emissive: '#445566', emissiveIntensity: 1, visible: true },
    },
    ...overrides,
  };
}

function apply(world: World, event: WorldEvent): World {
  const result = applyEvent(world, event);
  if (!result.ok) throw new Error(result.reason);
  return result.world;
}

const empty = () => createEmptyWorld({ id: 'w', name: 'Test', biome: 'void', seed: 7 });

describe('applyEvent', () => {
  it('adds an entity, stamps provenance and increments seq', () => {
    const w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    expect(w.seq).toBe(1);
    expect(w.order).toEqual([A]);
    expect(w.entities[A]?.provenance).toEqual({
      createdBy: 'system',
      createdAtSeq: 1,
      lastModifiedBy: 'system',
      lastModifiedSeq: 1,
    });
  });

  it('does not mutate the input world', () => {
    const before = empty();
    const snapshot = JSON.stringify(before);
    apply(before, { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('rejects duplicate ids and unknown parents', () => {
    const w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    const dup = applyEvent(w, { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    expect(dup.ok).toBe(false);
    const orphan = applyEvent(w, {
      type: 'entity/added',
      entity: draft('t:b', { parentId: asEntityId('t:missing') }),
      source: 'system',
    });
    expect(orphan.ok).toBe(false);
    expect(dup.world).toBe(w);
  });

  it('renames with trimming and rejects empty names', () => {
    let w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    w = apply(w, { type: 'entity/renamed', id: A, name: '  Aurora Spire  ', source: 'user' });
    expect(w.entities[A]?.name).toBe('Aurora Spire');
    expect(w.entities[A]?.provenance.lastModifiedBy).toBe('user');
    expect(w.entities[A]?.provenance.createdBy).toBe('system');
    const bad = applyEvent(w, { type: 'entity/renamed', id: A, name: '   ', source: 'user' });
    expect(bad.ok).toBe(false);
  });

  it('treats a no-op change as rejected so history stays clean', () => {
    const w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    const same = applyEvent(w, { type: 'entity/renamed', id: A, name: 'Entity t:a', source: 'user' });
    expect(same.ok).toBe(false);
  });

  it('patches visuals, preserves archetype and validates colours and intensity', () => {
    let w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    w = apply(w, { type: 'entity/visualChanged', id: A, patch: { color: '#ff00aa' }, source: 'user' });
    expect(w.entities[A]?.components.visual?.color).toBe('#ff00aa');
    expect(w.entities[A]?.components.visual?.archetype).toBe('crystalSpire');
    expect(applyEvent(w, { type: 'entity/visualChanged', id: A, patch: { color: '#zzz' as `#${string}` }, source: 'user' }).ok).toBe(false);
    expect(applyEvent(w, { type: 'entity/visualChanged', id: A, patch: { emissiveIntensity: -1 }, source: 'user' }).ok).toBe(false);
    expect(applyEvent(w, { type: 'entity/visualChanged', id: A, patch: { emissiveIntensity: 99 }, source: 'user' }).ok).toBe(false);
  });

  it('merges partial transforms and rejects non-finite or non-positive values', () => {
    let w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    w = apply(w, { type: 'entity/transformed', id: A, transform: { position: [1, 2, 3] }, source: 'user' });
    expect(w.entities[A]?.components.transform).toEqual({
      position: [1, 2, 3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(applyEvent(w, { type: 'entity/transformed', id: A, transform: { position: [NaN, 0, 0] }, source: 'user' }).ok).toBe(false);
    expect(applyEvent(w, { type: 'entity/transformed', id: A, transform: { scale: [1, 0, 1] }, source: 'user' }).ok).toBe(false);
  });

  it('keeps unchanged entities referentially equal (cheap snapshots, cheap diffing)', () => {
    let w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    w = apply(w, { type: 'entity/added', entity: draft('t:b'), source: 'system' });
    const bBefore = w.entities[B];
    w = apply(w, { type: 'entity/renamed', id: A, name: 'Changed', source: 'user' });
    expect(w.entities[B]).toBe(bBefore);
  });

  it('protects pinned entities and entities with children from removal', () => {
    let w = apply(empty(), { type: 'entity/added', entity: draft('t:a'), source: 'system' });
    w = apply(w, { type: 'entity/added', entity: draft('t:b', { parentId: A }), source: 'system' });
    expect(childrenOf(w, A)).toEqual([B]);
    expect(applyEvent(w, { type: 'entity/removed', id: A, source: 'user' }).ok).toBe(false);

    w = apply(w, { type: 'entity/pinnedChanged', id: B, pinned: true, source: 'user' });
    const pinned = applyEvent(w, { type: 'entity/removed', id: B, source: 'user' });
    expect(pinned.ok).toBe(false);
    if (!pinned.ok) expect(pinned.reason).toMatch(/pinned/);

    w = apply(w, { type: 'entity/pinnedChanged', id: B, pinned: false, source: 'user' });
    w = apply(w, { type: 'entity/removed', id: B, source: 'user' });
    expect(w.entities[B]).toBeUndefined();
    expect(w.order).toEqual([A]);
  });

  it('reports unknown entities without throwing', () => {
    const result = applyEvent(empty(), { type: 'entity/renamed', id: A, name: 'x', source: 'user' });
    expect(result.ok).toBe(false);
  });
});
