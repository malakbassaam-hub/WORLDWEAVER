import { beforeAll, describe, expect, it } from 'vitest';
import { worldFingerprint } from '../core/fingerprint';
import { NAME_MAX_LENGTH, applyEvents, createEmptyWorld } from '../core/reducer';
import { replay } from '../core/replay';
import { WorldStore } from '../core/store';
import { checkEventShape } from '../core/wellformed';
import { ARCHETYPES } from '../director/schema';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { blueprintToEvents, blueprintToWorld, sampleHeightfield } from './adapter';
import { generateWorldDeterministic } from './generate';
import { heightAt } from './terrain';
import type { WorldBlueprint } from './types';

let en: WorldBlueprint;
let ar: WorldBlueprint;

beforeAll(() => {
  const pick = (prompt: string) => {
    const r = generateWorldDeterministic({ prompt, seed: 21, strategies: ['constraint-first'] });
    if (!r.ok || !r.candidates[0]) throw new Error('generation failed');
    return r.candidates[0].blueprint;
  };
  en = pick('A misty coastal village with a lighthouse on the cliffs, a river with a waterfall and a stone bridge');
  ar = pick('منارة على جرف بجانب البحر مع قرية صغيرة وشلال وجسر');
});

const expectedCount = (bp: WorldBlueprint) => bp.structures.length + bp.bridges.length + bp.vegetation.length + bp.characters.length;

describe('blueprintToEvents', () => {
  it('produces well-formed entity/added events', () => {
    const events = blueprintToEvents(en);
    expect(events).toHaveLength(expectedCount(en));
    for (const e of events) {
      expect(checkEventShape(e)).toBeNull();
      expect(e.type).toBe('entity/added');
      expect(e.source).toBe('system');
      expect(e.note).toMatch(/^worldgen constraint-first wg:/);
    }
  });

  it('applies through the real reducer into a fresh world', () => {
    const r = blueprintToWorld(en);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.order).toHaveLength(expectedCount(en));
    expect(r.world.biome).toBe('coastal');
    expect(r.world.seed).toBe(en.identity.seed);
    for (const id of r.world.order) {
      const e = r.world.entities[id]!;
      expect(e.name.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
      expect(e.provenance.createdBy).toBe('system');
      expect(e.tags).toContain('worldgen');
    }
  });

  it('is deterministic and replayable', () => {
    const a = blueprintToWorld(en);
    const b = blueprintToWorld(en);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(worldFingerprint(a.world)).toBe(worldFingerprint(b.world));
    // Replaying the emitted events with the core replay() reproduces the same world.
    const empty = createEmptyWorld({ id: en.identity.id, name: en.identity.title.slice(0, NAME_MAX_LENGTH), biome: en.theme.biome, seed: en.identity.seed });
    const replayed = replay(empty, a.events);
    expect(replayed.rejected).toEqual([]);
    expect(worldFingerprint(replayed.world)).toBe(worldFingerprint(a.world));
  });

  it('can be added to an existing world as one undo step', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const before = store.getState();
    const result = store.dispatchBatch(blueprintToEvents(en, { idPrefix: 'gen1/', source: 'user' }), { label: 'WorldGen blueprint', source: 'user' });
    expect(result.ok).toBe(true);
    expect(store.getState().order.length).toBe(before.order.length + expectedCount(en));
    expect(store.undo()).toBe(true);
    expect(worldFingerprint(store.getState())).toBe(worldFingerprint(before));
  });

  it('rejects the whole blueprint if any id collides (all or nothing)', () => {
    const once = blueprintToWorld(en);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const again = applyEvents(once.world, blueprintToEvents(en));
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.index).toBe(0);
      expect(again.world).toBe(once.world);
    }
  });

  it('uses only archetypes the current renderer knows in legacy-proxy mode', () => {
    const known = new Set<string>(ARCHETYPES);
    for (const e of blueprintToEvents(en)) {
      if (e.type === 'entity/added') expect(known.has(e.entity.components.visual?.archetype ?? '')).toBe(true);
    }
  });

  it('uses wg.* archetypes in semantic mode and keeps the semantic kind', () => {
    const events = blueprintToEvents(en, { archetypes: 'semantic' });
    for (const e of events) if (e.type === 'entity/added') expect(e.entity.components.visual?.archetype).toMatch(/^wg\./);
    const kinds = new Set(events.flatMap((e) => (e.type === 'entity/added' ? [e.entity.kind] : [])));
    expect(kinds.has('lighthouse')).toBe(true);
    expect(kinds.has('character')).toBe(true);
  });

  it('names entities in the prompt language unless told otherwise', () => {
    const arNames = blueprintToEvents(ar).flatMap((e) => (e.type === 'entity/added' ? [e.entity.name] : []));
    expect(arNames.every((n) => /[\u0600-\u06FF]/.test(n))).toBe(true);
    const enNames = blueprintToEvents(ar, { language: 'en' }).flatMap((e) => (e.type === 'entity/added' ? [e.entity.name] : []));
    expect(enNames).toContain('Lighthouse');
  });

  it('attaches the lighthouse light component', () => {
    const lighthouse = blueprintToEvents(en).find((e) => e.type === 'entity/added' && e.entity.kind === 'lighthouse');
    expect(lighthouse?.type === 'entity/added' && lighthouse.entity.components.light).toBeTruthy();
  });
});

describe('sampleHeightfield', () => {
  it('samples the analytic terrain on a regular grid', () => {
    const hf = sampleHeightfield(en, 33);
    expect(hf.heights).toHaveLength(33 * 33);
    expect(hf.extent).toBe(en.space.extent);
    expect([...hf.heights].every(Number.isFinite)).toBe(true);
    const E = en.space.extent;
    expect(hf.heights[0]).toBeCloseTo(heightAt(en.terrain, -E, -E), 4);
    expect(hf.heights[16 * 33 + 16]).toBeCloseTo(heightAt(en.terrain, 0, 0), 4);
    expect(hf.heights[33 * 33 - 1]).toBeCloseTo(heightAt(en.terrain, E, E), 4);
  });

  it('rejects invalid resolutions', () => {
    expect(() => sampleHeightfield(en, 1)).toThrow(RangeError);
    expect(() => sampleHeightfield(en, 2.5)).toThrow(RangeError);
    expect(() => sampleHeightfield(en, 5000)).toThrow(RangeError);
  });
});
