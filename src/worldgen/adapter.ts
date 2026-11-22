/**
 * Adapters from a WorldBlueprint to existing WORLDWEAVER structures.
 *
 * - `blueprintToEvents` produces `entity/added` WorldEvents that the existing
 *   reducer, store, undo, ledger and replay accept unchanged.
 * - `blueprintToWorld` applies them atomically to an empty core World.
 * - `sampleHeightfield` gives a renderer a regular height grid for the terrain.
 *
 * The core World model has no terrain, water or path primitives, so those stay
 * in the blueprint and are NOT emitted as entities. The renderer reads them
 * from the blueprint (heightfield, river points, lake discs, path points).
 *
 * Archetypes: in 'legacy-proxy' mode (default) each element maps to one of the
 * archetypes the current renderer already draws. These are PLACEHOLDERS, not a
 * faithful look (a lighthouse is drawn as a crystal spire). In 'semantic' mode
 * archetypes are `wg.<kind>` names; the current renderer draws its generic
 * fallback body for them until matching recipes exist.
 */
import { applyEvents, createEmptyWorld, NAME_MAX_LENGTH } from '../core/reducer';
import type { ColorHex, EntityDraft, EventSource, LightComponent, World, WorldEvent } from '../core/types';
import { asEntityId } from '../core/types';
import { heightAt } from './terrain';
import type { BlueprintElement, StructureKind, WorldBlueprint } from './types';

export type ArchetypeMode = 'legacy-proxy' | 'semantic';

export interface AdapterOptions {
  readonly source?: EventSource;
  /** Prepended to every entity id, so a blueprint can be added to a world that already has entities. */
  readonly idPrefix?: string;
  readonly archetypes?: ArchetypeMode;
  /** Which label to use for entity names. 'auto' uses the prompt language. */
  readonly language?: 'en' | 'ar' | 'auto';
}

const LEGACY_STRUCTURE: Readonly<Record<StructureKind, string>> = {
  lighthouse: 'crystalSpire',
  castle: 'castle',
  tower: 'crystalSpire',
  temple: 'crystalCitadel',
  house: 'obelisk',
  ruins: 'obelisk',
  windmill: 'obelisk',
  monument: 'obelisk',
};

function nameFor(e: BlueprintElement, language: 'en' | 'ar'): string {
  const n = e.name.trim();
  const label = language === 'ar' ? e.labels.ar : e.labels.en;
  // Keep the numbering suffix from the element name ("House 3") on the chosen label.
  const suffix = /\s(\d+)$/.exec(n)?.[1];
  const text = suffix && !label.endsWith(suffix) ? `${label} ${suffix}` : label || n;
  return text.slice(0, NAME_MAX_LENGTH);
}

export function blueprintToEvents(bp: WorldBlueprint, options: AdapterOptions = {}): WorldEvent[] {
  const source = options.source ?? 'system';
  const prefix = options.idPrefix ?? '';
  const mode = options.archetypes ?? 'legacy-proxy';
  const language = options.language === 'en' || options.language === 'ar' ? options.language : bp.identity.language === 'ar' ? 'ar' : 'en';
  const palette = bp.theme.palette;
  const color = (i: number): ColorHex => palette[i % Math.max(palette.length, 1)] ?? '#888888';
  const accent = color(palette.length - 1);
  const glow = bp.atmosphere.timeOfDay !== 'day';
  const lightFor = new Map(bp.atmosphere.lighting.accentLights.map((l) => [l.attachedTo, l]));
  const heroId = bp.composition.focalPoints.find((f) => f.role === 'hero')?.targetId;
  const note = (e: BlueprintElement) => `worldgen ${bp.identity.strategy} ${e.id}`;
  const events: WorldEvent[] = [];

  const push = (e: BlueprintElement, kind: string, archetype: string, opts: { color: ColorHex; emissive: ColorHex; intensity: number; light?: LightComponent; extraTags?: string[] }) => {
    const entity: EntityDraft = {
      id: asEntityId(`${prefix}${e.id}`),
      name: nameFor(e, language),
      kind,
      parentId: null,
      tags: ['worldgen', `wg-strategy:${bp.identity.strategy}`, ...e.tags, ...(opts.extraTags ?? [])],
      pinned: false,
      components: {
        transform: e.transform,
        visual: { archetype, color: opts.color, emissive: opts.emissive, emissiveIntensity: opts.intensity, visible: true },
        ...(opts.light ? { light: opts.light } : {}),
      },
    };
    events.push({ type: 'entity/added', entity, source, note: note(e) });
  };

  const ordered = [...bp.structures].sort((a, b) => Number(a.structureKind === 'house') - Number(b.structureKind === 'house'));
  for (const s of ordered) {
    const l = lightFor.get(s.id);
    push(s, s.structureKind, mode === 'semantic' ? `wg.${s.structureKind}` : LEGACY_STRUCTURE[s.structureKind], {
      color: color(0),
      emissive: l ? l.color : accent,
      intensity: l ? (glow ? Math.min(l.intensity, 20) : 0.4) : s.id === heroId ? 0.6 : 0,
      ...(l ? { light: { color: l.color, intensity: l.intensity, range: l.range } } : {}),
      extraTags: s.id === heroId ? ['focal-point'] : [],
    });
  }
  for (const b of bp.bridges) push(b, 'bridge', mode === 'semantic' ? 'wg.bridge' : 'obelisk', { color: color(2), emissive: '#000000', intensity: 0 });
  for (const v of bp.vegetation) {
    push(v, 'vegetation', mode === 'semantic' ? `wg.vegetation.${v.vegetationKind}` : 'crystalCluster', { color: color(1), emissive: '#000000', intensity: 0, extraTags: [v.speciesId] });
  }
  for (const c of bp.characters) push(c, 'character', mode === 'semantic' ? 'wg.character' : 'lightOrb', { color: color(3), emissive: accent, intensity: 1.2, extraTags: [c.role] });
  return events;
}

export type AdaptResult = { readonly ok: true; readonly world: World; readonly events: readonly WorldEvent[] } | { readonly ok: false; readonly index: number; readonly reason: string };

/** Builds a fresh core World from a blueprint through the real reducer (all or nothing). */
export function blueprintToWorld(bp: WorldBlueprint, options: AdapterOptions = {}): AdaptResult {
  const events = blueprintToEvents(bp, options);
  const empty = createEmptyWorld({ id: bp.identity.id, name: bp.identity.title.slice(0, NAME_MAX_LENGTH), biome: bp.theme.biome, seed: bp.identity.seed });
  const applied = applyEvents(empty, events);
  if (!applied.ok) return { ok: false, index: applied.index, reason: applied.reason };
  return { ok: true, world: applied.world, events };
}

export interface Heightfield {
  /** Samples per side. */
  readonly resolution: number;
  /** World units from the centre to an edge. Samples span [-extent, extent]. */
  readonly extent: number;
  readonly seaLevel: number;
  /** Row-major, z outer, x inner: heights[zi * resolution + xi]. */
  readonly heights: Float32Array;
}

export function sampleHeightfield(bp: WorldBlueprint, resolution = 129): Heightfield {
  if (!Number.isInteger(resolution) || resolution < 2 || resolution > 1025) throw new RangeError('resolution must be an integer from 2 to 1025');
  const E = bp.space.extent;
  const heights = new Float32Array(resolution * resolution);
  for (let zi = 0; zi < resolution; zi++) {
    const z = -E + (2 * E * zi) / (resolution - 1);
    for (let xi = 0; xi < resolution; xi++) {
      const x = -E + (2 * E * xi) / (resolution - 1);
      heights[zi * resolution + xi] = heightAt(bp.terrain, x, z);
    }
  }
  return { resolution, extent: E, seaLevel: bp.terrain.seaLevel, heights };
}
