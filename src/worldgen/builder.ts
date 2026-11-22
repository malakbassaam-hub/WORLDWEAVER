/**
 * BlueprintBuilder: the shared construction layer used by both planners.
 *
 * It owns id generation, provenance stamps, naming and element constructors,
 * and it keeps the terrain live so planners can query heights while they work.
 * It makes NO planning decisions: where things go and in what order is decided
 * by the strategy, not here.
 */
import { createIdFactory, hashString } from '../core/random';
import {
  STRUCTURE_DEFS,
  SOUNDS,
  labelsFor,
  lightingFor,
  materialFor,
  paletteFor,
  type Labels,
} from './catalog';
import type { PlanSpec } from './constraints';
import { dist2, round3 } from './geometry';
import type { Interpretation } from './interpret';
import { heightAt, lakeSurfaceFor, profileRiver } from './terrain';
import {
  BLUEPRINT_SCHEMA,
  BLUEPRINT_VERSION,
  type Bridge,
  type Character,
  type Composition,
  type ElementProvenance,
  type GeneratorInfo,
  type Interactable,
  type Lake,
  type MotionDescriptor,
  type PathWay,
  type PlanConstraint,
  type PlanStage,
  type Relation,
  type RelationType,
  type River,
  type RiverMouth,
  type Settlement,
  type Structure,
  type StructureKind,
  type StrategyId,
  type Terrain,
  type TerrainRegion,
  type TerrainRegionKind,
  type Transform,
  type Vec2,
  type Vec3,
  type VegetationCluster,
  type Waterfall,
  type WorldBlueprint,
} from './types';
import { labelFor } from './lexicon';

export interface BuildContext {
  readonly prompt: string;
  readonly interp: Interpretation;
  readonly spec: PlanSpec;
  readonly seed: number;
  readonly strategy: StrategyId;
  readonly extent: number;
  readonly generator: GeneratorInfo;
}

interface MutableTerrain {
  seaLevel: number;
  baseHeight: number;
  islandRadius: number | null;
  tilt: { angle: number; gradient: number } | null;
  regions: TerrainRegion[];
}

export const WATER_BED = 0.4;
/** A river segment that drops at least this much is a natural waterfall. */
export const NATURAL_FALL_DROP = 9;
export const MIN_FALL_DROP = 2;

export class BlueprintBuilder {
  readonly terrain: MutableTerrain;
  readonly lakes: Lake[] = [];
  readonly rivers: River[] = [];
  readonly waterfalls: Waterfall[] = [];
  readonly structures: Structure[] = [];
  readonly settlements: Settlement[] = [];
  readonly vegetation: VegetationCluster[] = [];
  readonly paths: PathWay[] = [];
  readonly bridges: Bridge[] = [];
  readonly characters: Character[] = [];
  readonly interactables: Interactable[] = [];
  readonly relations: Relation[] = [];
  readonly stages: PlanStage[] = [];
  readonly extraConstraints: PlanConstraint[] = [];
  private readonly nextId = createIdFactory('wg');
  private readonly counts = new Map<string, number>();
  private composition: Composition | null = null;
  private currentStage = 'init';

  constructor(readonly ctx: BuildContext) {
    this.terrain = { seaLevel: 0, baseHeight: ctx.spec.sea ? 5 : 7, islandRadius: null, tilt: null, regions: [] };
  }

  get isArabic(): boolean {
    return this.ctx.interp.language === 'ar';
  }

  /** Terrain as the read-only model type (live view; reflects later edits). */
  get terrainView(): Terrain {
    return this.terrain;
  }

  height(x: number, z: number): number {
    return heightAt(this.terrain, x, z);
  }

  // ---- bookkeeping --------------------------------------------------------

  stage(name: string, summary: string): void {
    this.currentStage = name;
    this.stages.push({ name, summary });
  }

  stamp(requirementIds: readonly string[], rationale: string): ElementProvenance {
    return {
      origin: 'worldgen',
      strategy: this.ctx.strategy,
      stage: this.currentStage,
      requirementIds: [...requirementIds],
      rationale,
      seed: this.ctx.seed,
    };
  }

  /** Display name in the prompt language, numbered when more than one exists. */
  naming(key: string): { name: string; labels: Labels } {
    const labels = labelsFor(key);
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    const base = this.isArabic ? labels.ar : labels.en;
    return { name: n > 1 ? `${base} ${n}` : base, labels };
  }

  tf(position: Vec3, yaw = 0, scale: Vec3 = [1, 1, 1]): Transform {
    return { position: [round3(position[0]), round3(position[1]), round3(position[2])], rotation: [0, round3(yaw), 0], scale };
  }

  relate(type: RelationType, from: string, to: string, note?: string): void {
    this.relations.push(note ? { type, from, to, note } : { type, from, to });
  }

  // ---- terrain ------------------------------------------------------------

  addRegion(opts: {
    kind: TerrainRegionKind;
    center: Vec2;
    radius: number;
    amplitude: number;
    sharpness?: number;
    aspect?: number;
    angle?: number;
    requirementIds?: readonly string[];
    rationale: string;
  }): TerrainRegion {
    const { name, labels } = this.naming(opts.kind);
    const region: TerrainRegion = {
      id: this.nextId(`terrain-${opts.kind}`),
      name,
      labels,
      transform: this.tf([opts.center[0], 0, opts.center[1]], opts.angle ?? 0),
      tags: ['terrain', opts.kind],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { amplitude: round3(opts.amplitude), radius: round3(opts.radius) },
      regionKind: opts.kind,
      center: [round3(opts.center[0]), round3(opts.center[1])],
      radius: round3(opts.radius),
      amplitude: round3(opts.amplitude),
      sharpness: opts.sharpness ?? 2,
      aspect: opts.aspect ?? 1,
      angle: round3(opts.angle ?? 0),
    };
    this.terrain.regions.push(region);
    return region;
  }

  // ---- water --------------------------------------------------------------

  /**
   * Adds a lake and digs a matching basin so the terrain agrees with the water.
   * The surface sits slightly below the ground that was there, so water is
   * contained by the surrounding bank.
   */
  addLake(opts: { center: Vec2; radius: number; requirementIds?: readonly string[]; rationale: string; surfaceY?: number }): Lake {
    const h0 = this.height(opts.center[0], opts.center[1]);
    const surfaceY = round3(opts.surfaceY ?? lakeSurfaceFor(this.terrain, opts.center));
    const dig = surfaceY - 2.5 - h0;
    // Steep-edged basin (sharpness 4) so digging barely lowers the bank outside the shore.
    this.addRegion({
      kind: 'basin',
      center: opts.center,
      radius: opts.radius * 0.9,
      sharpness: 4,
      amplitude: Math.min(dig, -1),
      requirementIds: opts.requirementIds ?? [],
      rationale: 'Basin dug so the lake is contained by the terrain.',
    });
    const { name, labels } = this.naming('lake');
    const lake: Lake = {
      id: this.nextId('lake'),
      name,
      labels,
      transform: this.tf([opts.center[0], surfaceY, opts.center[1]]),
      tags: ['water', 'lake'],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { radius: round3(opts.radius), surfaceY },
      center: [round3(opts.center[0]), round3(opts.center[1])],
      radius: round3(opts.radius),
      surfaceY,
    };
    this.lakes.push(lake);
    return lake;
  }

  /** Adds a river along a fixed horizontal path; the water surface is solved from the terrain. */
  addRiver(opts: { path: readonly Vec2[]; width: number; mouth: RiverMouth; requirementIds?: readonly string[]; rationale: string }): River {
    const lake = opts.mouth.type === 'lake' ? this.lakes.find((l) => l.id === (opts.mouth as { lakeId: string }).lakeId) : undefined;
    const last = opts.path[opts.path.length - 1] as Vec2;
    let endLevel = this.terrain.seaLevel;
    if (lake) endLevel = lake.surfaceY;
    else if (opts.mouth.type === 'edge') endLevel = Math.max(this.terrain.seaLevel, this.height(last[0], last[1]) - WATER_BED);
    const points = profileRiver(this.terrain, opts.path, endLevel, WATER_BED);
    const { name, labels } = this.naming('river');
    const river: River = {
      id: this.nextId('river'),
      name,
      labels,
      transform: this.tf(points[0] as Vec3),
      tags: ['water', 'river'],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { width: opts.width },
      width: opts.width,
      points,
      mouth: opts.mouth,
    };
    this.rivers.push(river);
    if (lake) this.relate('flows-into', river.id, lake.id);
    return river;
  }

  /**
   * Marks waterfalls on a river. Segments dropping at least NATURAL_FALL_DROP
   * are always marked; if `required` more are needed, the largest remaining
   * drops (at least MIN_FALL_DROP) are marked too. Returns the ones created.
   */
  markWaterfalls(river: River, required: number, requirementIds: readonly string[]): Waterfall[] {
    const segs: { i: number; drop: number }[] = [];
    for (let i = 0; i + 1 < river.points.length; i++) {
      segs.push({ i, drop: round3((river.points[i] as Vec3)[1] - (river.points[i + 1] as Vec3)[1]) });
    }
    const chosen = new Set<number>(segs.filter((s) => s.drop >= NATURAL_FALL_DROP).map((s) => s.i));
    const ranked = segs.filter((s) => s.drop >= MIN_FALL_DROP && !chosen.has(s.i)).sort((a, b) => b.drop - a.drop || a.i - b.i);
    for (const s of ranked) {
      if (chosen.size >= required) break;
      chosen.add(s.i);
    }
    const out: Waterfall[] = [];
    for (const i of [...chosen].sort((a, b) => a - b)) {
      const seg = segs[i] as { i: number; drop: number };
      const top = river.points[i] as Vec3;
      const { name, labels } = this.naming('waterfall');
      const fall: Waterfall = {
        id: this.nextId('waterfall'),
        name,
        labels,
        transform: this.tf(top),
        tags: ['water', 'waterfall'],
        provenance: this.stamp(requirementIds, `The river drops ${seg.drop} units over one segment.`),
        properties: { drop: seg.drop },
        riverId: river.id,
        segmentIndex: i,
        drop: seg.drop,
        width: round3(Math.max(1.5, river.width * 0.8)),
      };
      this.waterfalls.push(fall);
      this.relate('falls-from', fall.id, river.id);
      out.push(fall);
    }
    return out;
  }

  // ---- architecture -------------------------------------------------------

  addStructure(opts: {
    kind: StructureKind;
    at: Vec2;
    yaw?: number;
    settlementId?: string | null;
    requirementIds?: readonly string[];
    rationale: string;
    nameKey?: string;
    extraTags?: readonly string[];
  }): Structure {
    const def = STRUCTURE_DEFS[opts.kind];
    const { name, labels } = this.naming(opts.nameKey ?? opts.kind);
    const y = round3(this.height(opts.at[0], opts.at[1]));
    const material = materialFor(this.ctx.interp.biome);
    const structure: Structure = {
      id: this.nextId(opts.kind),
      name,
      labels,
      transform: this.tf([opts.at[0], y, opts.at[1]], opts.yaw ?? 0),
      tags: ['structure', opts.kind, ...(def.landmark ? ['landmark'] : []), ...(opts.extraTags ?? [])],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { footprintRadius: def.footprint, height: def.height, material },
      structureKind: opts.kind,
      footprintRadius: def.footprint,
      height: def.height,
      isLandmark: def.landmark,
      settlementId: opts.settlementId ?? null,
      material,
    };
    this.structures.push(structure);
    return structure;
  }

  /** Reserves an id up front (for example a settlement id that its houses refer to). */
  newId(slug: string): string {
    return this.nextId(slug);
  }

  addSettlement(opts: { id?: string; center: Vec2; radius: number; structureIds: readonly string[]; requirementIds?: readonly string[]; rationale: string }): Settlement {
    const { name, labels } = this.naming('village');
    const y = round3(this.height(opts.center[0], opts.center[1]));
    const settlement: Settlement = {
      id: opts.id ?? this.nextId('settlement'),
      name,
      labels,
      transform: this.tf([opts.center[0], y, opts.center[1]]),
      tags: ['settlement'],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { radius: round3(opts.radius), houses: opts.structureIds.length },
      center: [round3(opts.center[0]), round3(opts.center[1])],
      radius: round3(opts.radius),
      structureIds: [...opts.structureIds],
    };
    this.settlements.push(settlement);
    for (const id of opts.structureIds) this.relate('part-of', id, settlement.id);
    return settlement;
  }

  // ---- life ---------------------------------------------------------------

  addVegetation(opts: {
    speciesId: string;
    labels: Labels;
    vegetationKind: VegetationCluster['vegetationKind'];
    ecosystem: string;
    center: Vec2;
    radius: number;
    count: number;
    requirementIds?: readonly string[];
    rationale: string;
  }): VegetationCluster {
    const name = this.isArabic ? opts.labels.ar : opts.labels.en;
    const n = (this.counts.get(`veg-${opts.speciesId}`) ?? 0) + 1;
    this.counts.set(`veg-${opts.speciesId}`, n);
    const y = round3(this.height(opts.center[0], opts.center[1]));
    const cluster: VegetationCluster = {
      id: this.nextId(`veg-${opts.speciesId}`),
      name: n > 1 ? `${name} ${n}` : name,
      labels: opts.labels,
      transform: this.tf([opts.center[0], y, opts.center[1]]),
      tags: ['vegetation', opts.vegetationKind, opts.ecosystem],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { count: opts.count, radius: round3(opts.radius), ecosystem: opts.ecosystem },
      speciesId: opts.speciesId,
      vegetationKind: opts.vegetationKind,
      ecosystem: opts.ecosystem,
      center: [round3(opts.center[0]), round3(opts.center[1])],
      radius: round3(opts.radius),
      count: opts.count,
    };
    this.vegetation.push(cluster);
    return cluster;
  }

  addCharacter(opts: { role: string; at: Vec2; homeId: string | null; requirementIds?: readonly string[]; rationale: string }): Character {
    const { name, labels } = this.naming(opts.role);
    const y = round3(this.height(opts.at[0], opts.at[1]));
    const character: Character = {
      id: this.nextId(`character-${opts.role}`),
      name,
      labels,
      transform: this.tf([opts.at[0], y, opts.at[1]]),
      tags: ['character', opts.role],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { role: opts.role },
      role: opts.role,
      homeId: opts.homeId,
      greeting: this.isArabic ? 'مرحبًا بالمسافر.' : 'Greetings, traveller.',
    };
    this.characters.push(character);
    if (opts.homeId) this.relate('inhabits', character.id, opts.homeId);
    return character;
  }

  addInteractable(opts: { targetId: string; at: Vec2; interaction: Interactable['interaction']; rationale: string }): Interactable {
    const { name, labels } = this.naming('door');
    const y = round3(this.height(opts.at[0], opts.at[1]));
    const item: Interactable = {
      id: this.nextId('interactable'),
      name,
      labels,
      transform: this.tf([opts.at[0], y, opts.at[1]]),
      tags: ['interactable', opts.interaction],
      provenance: this.stamp([], opts.rationale),
      properties: { interaction: opts.interaction },
      interaction: opts.interaction,
      targetId: opts.targetId,
    };
    this.interactables.push(item);
    this.relate('part-of', item.id, opts.targetId);
    return item;
  }

  // ---- connectivity -------------------------------------------------------

  /** Adds a path along a horizontal polyline, resampled to at most `spacing` between points. */
  addPath(opts: {
    kind: PathWay['pathKind'];
    line: readonly Vec2[];
    fromId: string;
    toId: string;
    width?: number;
    spacing?: number;
    requirementIds?: readonly string[];
    rationale: string;
  }): PathWay {
    const spacing = opts.spacing ?? 8;
    const dense: Vec2[] = [];
    for (let i = 0; i + 1 < opts.line.length; i++) {
      const a = opts.line[i] as Vec2;
      const b = opts.line[i + 1] as Vec2;
      const steps = Math.max(1, Math.ceil(dist2(a, b) / spacing));
      for (let k = 0; k < steps; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
    }
    dense.push(opts.line[opts.line.length - 1] as Vec2);
    const points: Vec3[] = dense.map((p) => [round3(p[0]), round3(this.height(p[0], p[1]) + 0.15), round3(p[1])]);
    const key = opts.kind === 'road' ? 'path' : 'trail';
    const { name, labels } = this.naming(key);
    const path: PathWay = {
      id: this.nextId(key),
      name,
      labels,
      transform: this.tf(points[0] as Vec3),
      tags: ['path', opts.kind],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { width: opts.width ?? 2.2 },
      pathKind: opts.kind,
      width: opts.width ?? 2.2,
      points,
      fromId: opts.fromId,
      toId: opts.toId,
    };
    this.paths.push(path);
    this.relate('connects', path.id, opts.fromId);
    this.relate('connects', path.id, opts.toId);
    return path;
  }

  addBridge(opts: { path: PathWay; over: River | Lake; at: Vec2; yaw: number; length: number; requirementIds?: readonly string[]; rationale: string }): Bridge {
    const { name, labels } = this.naming('bridge');
    const bank = Math.max(this.height(opts.at[0], opts.at[1]), this.height(opts.at[0] + Math.cos(opts.yaw) * opts.length * 0.5, opts.at[1] + Math.sin(opts.yaw) * opts.length * 0.5));
    const riverY = opts.over.transform.position[1];
    const deckY = round3(Math.max(bank, riverY) + 0.6);
    const bridge: Bridge = {
      id: this.nextId('bridge'),
      name,
      labels,
      transform: this.tf([opts.at[0], deckY, opts.at[1]], opts.yaw),
      tags: ['bridge'],
      provenance: this.stamp(opts.requirementIds ?? [], opts.rationale),
      properties: { length: round3(opts.length), deckY },
      pathId: opts.path.id,
      overId: opts.over.id,
      length: round3(opts.length),
      width: opts.path.width + 0.6,
      deckY,
    };
    this.bridges.push(bridge);
    this.relate('spans', bridge.id, opts.over.id);
    this.relate('part-of', bridge.id, opts.path.id);
    return bridge;
  }

  setComposition(composition: Composition): void {
    this.composition = composition;
  }

  // ---- assembly -----------------------------------------------------------

  finish(): WorldBlueprint {
    const { ctx } = this;
    const { interp, spec } = ctx;
    const hero = this.structures.find((s) => s.tags.includes('hero')) ?? this.structures.find((s) => s.isLandmark);
    const biomeLabel = labelFor(interp.biome, this.isArabic ? 'ar' : 'en');
    const heroLabel = hero ? (this.isArabic ? hero.labels.ar : hero.labels.en) : this.isArabic ? 'عالم' : 'World';
    const title = this.isArabic ? `عالم ${biomeLabel}: ${heroLabel}` : `${biomeLabel} ${heroLabel}`;

    const lightingBase = lightingFor(interp.timeOfDay, interp.weather, interp.theme);
    const glow = interp.timeOfDay === 'night' || interp.timeOfDay === 'sunset' || interp.timeOfDay === 'dawn';
    const accentLights = this.structures
      .filter((s) => s.structureKind === 'lighthouse' || (glow && s.structureKind === 'house'))
      .slice(0, 10)
      .map((s, i) => ({
        id: `light-${i + 1}`,
        attachedTo: s.id,
        color: (s.structureKind === 'lighthouse' ? '#fff1c2' : '#ffcf8a') as `#${string}`,
        intensity: s.structureKind === 'lighthouse' ? 2.4 : 0.8,
        range: s.structureKind === 'lighthouse' ? 60 : 10,
      }));

    const motion: MotionDescriptor[] = [{ id: 'motion-clouds', target: 'clouds', kind: 'drift', speed: 0.4, amplitude: 1 }];
    if (this.rivers.length > 0 || this.lakes.length > 0 || spec.sea) motion.push({ id: 'motion-water', target: 'water', kind: 'flow', speed: 0.8, amplitude: 0.6 });
    if (this.vegetation.length > 0) motion.push({ id: 'motion-sway', target: 'vegetation', kind: 'sway', speed: interp.weather === 'storm' ? 2.2 : 0.7, amplitude: 0.3 });
    if (interp.weather === 'rain' || interp.weather === 'snow' || interp.weather === 'storm') {
      motion.push({ id: 'motion-precip', target: 'particles', kind: interp.weather === 'snow' ? 'snowfall' : 'rainfall', speed: 1.2, amplitude: 1 });
    }
    if (interp.theme === 'mystic') motion.push({ id: 'motion-motes', target: 'particles', kind: 'floating-motes', speed: 0.2, amplitude: 0.5 });

    const mood: string[] = [interp.theme, interp.timeOfDay];
    const counts = `${this.rivers.length} river(s), ${this.lakes.length} lake(s), ${this.structures.length} structure(s), ${this.settlements.length} settlement(s), ${this.vegetation.length} vegetation cluster(s)`;
    const description = this.isArabic
      ? `عالم ${biomeLabel} بطابع ${labelFor(interp.theme, 'ar')} عند ${labelFor(interp.timeOfDay, 'ar')}، تتوسطه ${heroLabel}. ${this.rivers.length} نهر، ${this.lakes.length} بحيرة، ${this.structures.length} منشأة.`
      : `A ${interp.theme} ${interp.biome} world at ${interp.timeOfDay}, anchored by a ${heroLabel.toLowerCase()}: ${counts}.`;

    const windAngle = (hashString(`${ctx.seed}:wind`) % 360) | 0;
    const composition: Composition = this.composition ?? { focalPoints: [], cameraPaths: [], sightlines: [], basis: 'derived-after-layout' };

    return {
      schema: BLUEPRINT_SCHEMA,
      version: BLUEPRINT_VERSION,
      identity: {
        id: `wg-${ctx.strategy}-${(hashString(`${ctx.prompt}|${ctx.seed}|${ctx.strategy}`) >>> 0).toString(16).padStart(8, '0')}`,
        title,
        description,
        prompt: ctx.prompt,
        language: interp.language,
        seed: ctx.seed,
        strategy: ctx.strategy,
        generator: ctx.generator,
      },
      theme: { theme: interp.theme, biome: interp.biome, palette: paletteFor(interp.biome, interp.theme) },
      atmosphere: {
        timeOfDay: interp.timeOfDay,
        weather: {
          kind: interp.weather,
          intensity: interp.weather === 'clear' ? 0 : interp.weather === 'storm' ? 0.9 : 0.5,
          windSpeed: interp.weather === 'storm' ? 14 : interp.weather === 'clear' ? 2 : 6,
          windAngleDeg: windAngle,
        },
        lighting: { ...lightingBase, accentLights },
        ambience: { sounds: [...SOUNDS[interp.biome], ...(this.rivers.length > 0 ? ['flowing water'] : [])], mood },
      },
      motion,
      space: { extent: ctx.extent },
      terrain: this.terrain,
      water: { rivers: this.rivers, waterfalls: this.waterfalls, lakes: this.lakes },
      structures: this.structures,
      settlements: this.settlements,
      vegetation: this.vegetation,
      paths: this.paths,
      bridges: this.bridges,
      characters: this.characters,
      interactables: this.interactables,
      composition,
      relations: this.relations,
      requirements: interp.requirements,
      planning: { stages: this.stages, constraints: [...spec.constraints, ...this.extraConstraints] },
    };
  }
}
