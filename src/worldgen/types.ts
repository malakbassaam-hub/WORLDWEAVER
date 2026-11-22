/**
 * WORLDWEAVER WorldGen: canonical WorldBlueprint model.
 *
 * A WorldBlueprint is a structured, versioned, serialisable plan for a world.
 * It is renderer-agnostic and UI-agnostic (no three.js, no DOM). Studio and
 * renderer code consume it directly or through `adapter.ts`, which converts it
 * to the existing core `WorldEvent` stream.
 *
 * Reused core types: `Vec3`, `ColorHex`, `Transform` (src/core/types.ts).
 * Units are abstract "world units"; +y is up, the ground plane is x/z.
 */
import type { ColorHex, Transform, Vec3 } from '../core/types';

export type { ColorHex, Transform, Vec3 };

export const BLUEPRINT_SCHEMA = 'worldweaver.blueprint' as const;
export const BLUEPRINT_VERSION = 1 as const;

export type Vec2 = readonly [number, number];

export type BiomeId = 'temperate' | 'desert' | 'arctic' | 'tropical' | 'alpine' | 'coastal';
export type ThemeId = 'serene' | 'mystic' | 'ominous' | 'ancient' | 'vibrant';
export type TimeOfDay = 'dawn' | 'day' | 'sunset' | 'night';
export type WeatherKind = 'clear' | 'fog' | 'rain' | 'snow' | 'storm';
export type StrategyId = 'constraint-first' | 'composition-first';
export type PromptLanguage = 'en' | 'ar' | 'mixed' | 'unknown';

export const BIOMES: readonly BiomeId[] = ['temperate', 'desert', 'arctic', 'tropical', 'alpine', 'coastal'];
export const THEMES: readonly ThemeId[] = ['serene', 'mystic', 'ominous', 'ancient', 'vibrant'];
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['dawn', 'day', 'sunset', 'night'];
export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'fog', 'rain', 'snow', 'storm'];
export const STRATEGIES: readonly StrategyId[] = ['constraint-first', 'composition-first'];

// --------------------------------------------------------------------------
// Concepts and requirements (what the prompt asked for)
// --------------------------------------------------------------------------

export type FeatureConcept =
  | 'river'
  | 'waterfall'
  | 'lake'
  | 'sea'
  | 'mountain'
  | 'hill'
  | 'valley'
  | 'island'
  | 'cliff'
  | 'lighthouse'
  | 'castle'
  | 'tower'
  | 'temple'
  | 'village'
  | 'house'
  | 'ruins'
  | 'windmill'
  | 'bridge'
  | 'road'
  | 'forest'
  | 'tree'
  | 'flowers'
  | 'character';

export type ConceptId = FeatureConcept | BiomeId | ThemeId | TimeOfDay | Exclude<WeatherKind, 'clear'>;

export interface Requirement {
  /** `req-<concept>`; unique within a blueprint. */
  readonly id: string;
  readonly concept: ConceptId;
  /** Requested quantity (1 when the prompt gives no number). */
  readonly count: number;
  /** True when the prompt asked for the concept to be ABSENT ("no river"). */
  readonly negated: boolean;
  /** The words in the prompt that produced this requirement. */
  readonly matchedText: string;
  readonly source: 'lexicon' | 'provider' | 'implied';
}

// --------------------------------------------------------------------------
// Provenance, relations, generic element shape
// --------------------------------------------------------------------------

export type PropValue = string | number | boolean;

export interface ElementProvenance {
  readonly origin: 'worldgen';
  readonly strategy: StrategyId;
  /** Planner stage that created the element, e.g. "reserve-landmarks". */
  readonly stage: string;
  /** Requirements this element satisfies. Empty for secondary/ambient elements. */
  readonly requirementIds: readonly string[];
  /** Why the planner created it (plain English, deterministic text). */
  readonly rationale: string;
  readonly seed: number;
}

export interface BlueprintElement {
  /** Stable, unique across the blueprint. Same seed and prompt give the same ids. */
  readonly id: string;
  /** Display name in the prompt's primary language. */
  readonly name: string;
  readonly labels: { readonly en: string; readonly ar: string };
  readonly transform: Transform;
  readonly tags: readonly string[];
  readonly provenance: ElementProvenance;
  /** Editable properties (scalars only so they serialise and diff cleanly). */
  readonly properties: Readonly<Record<string, PropValue>>;
}

export type RelationType =
  | 'near'
  | 'on'
  | 'flows-into'
  | 'spans'
  | 'connects'
  | 'faces'
  | 'part-of'
  | 'overlooks'
  | 'inhabits'
  | 'falls-from';

export interface Relation {
  readonly type: RelationType;
  readonly from: string;
  readonly to: string;
  readonly note?: string;
}

// --------------------------------------------------------------------------
// Terrain
// --------------------------------------------------------------------------

export type TerrainRegionKind = 'mountain' | 'hill' | 'valley' | 'cliff' | 'ridge' | 'basin' | 'pedestal' | 'undulation';

/**
 * One analytic height contribution:
 *   amplitude * exp(-(d ^ sharpness)),  d = elliptical distance / radius.
 * sharpness 2 is a smooth gaussian; 4 gives a plateau with a steep edge.
 * Negative amplitude digs (valleys, basins).
 */
export interface TerrainRegion extends BlueprintElement {
  readonly regionKind: TerrainRegionKind;
  readonly center: Vec2;
  readonly radius: number;
  readonly amplitude: number;
  readonly sharpness: number;
  /** Elongation along `angle` (1 = circular). */
  readonly aspect: number;
  /** Radians, rotation of the long axis in the x/z plane. */
  readonly angle: number;
}

export interface Terrain {
  readonly seaLevel: number;
  readonly baseHeight: number;
  /** When set, ground falls below sea level outside this radius (island/coast). */
  readonly islandRadius: number | null;
  /** Optional constant ramp: height += gradient * (x*cos(angle) + z*sin(angle)). */
  readonly tilt: { readonly angle: number; readonly gradient: number } | null;
  readonly regions: readonly TerrainRegion[];
}

// --------------------------------------------------------------------------
// Water
// --------------------------------------------------------------------------

export interface Lake extends BlueprintElement {
  readonly center: Vec2;
  readonly radius: number;
  readonly surfaceY: number;
}

export type RiverMouth =
  | { readonly type: 'sea' }
  | { readonly type: 'lake'; readonly lakeId: string }
  | { readonly type: 'edge' };

export interface River extends BlueprintElement {
  readonly width: number;
  /** Source to mouth. y is the water surface. */
  readonly points: readonly Vec3[];
  readonly mouth: RiverMouth;
}

export interface Waterfall extends BlueprintElement {
  readonly riverId: string;
  /** The fall happens between points[segmentIndex] and points[segmentIndex + 1]. */
  readonly segmentIndex: number;
  readonly drop: number;
  readonly width: number;
}

// --------------------------------------------------------------------------
// Architecture, settlements, vegetation
// --------------------------------------------------------------------------

export type StructureKind = 'lighthouse' | 'castle' | 'tower' | 'temple' | 'house' | 'ruins' | 'windmill' | 'monument';

export interface Structure extends BlueprintElement {
  readonly structureKind: StructureKind;
  readonly footprintRadius: number;
  readonly height: number;
  readonly isLandmark: boolean;
  readonly settlementId: string | null;
  readonly material: string;
}

export interface Settlement extends BlueprintElement {
  readonly center: Vec2;
  readonly radius: number;
  readonly structureIds: readonly string[];
}

export type VegetationKind = 'tree' | 'shrub' | 'flower' | 'cactus' | 'grass';

export interface VegetationCluster extends BlueprintElement {
  readonly speciesId: string;
  readonly vegetationKind: VegetationKind;
  readonly ecosystem: string;
  readonly center: Vec2;
  readonly radius: number;
  readonly count: number;
}

// --------------------------------------------------------------------------
// Connectivity
// --------------------------------------------------------------------------

export interface PathWay extends BlueprintElement {
  readonly pathKind: 'road' | 'trail';
  readonly width: number;
  readonly points: readonly Vec3[];
  /** Element ids (structure or settlement) the path joins. */
  readonly fromId: string;
  readonly toId: string;
}

export interface Bridge extends BlueprintElement {
  readonly pathId: string;
  /** River or lake id being crossed. */
  readonly overId: string;
  readonly length: number;
  readonly width: number;
  readonly deckY: number;
}

// --------------------------------------------------------------------------
// Characters and interaction
// --------------------------------------------------------------------------

export interface Character extends BlueprintElement {
  readonly role: string;
  readonly homeId: string | null;
  /** Neutral, deterministic text hook. This is NOT model-generated dialogue. */
  readonly greeting: string;
}

export interface Interactable extends BlueprintElement {
  readonly interaction: 'inspect' | 'talk' | 'enter' | 'use';
  readonly targetId: string;
}

// --------------------------------------------------------------------------
// Atmosphere, lighting, motion (descriptors only; the renderer decides looks)
// --------------------------------------------------------------------------

export interface Lighting {
  readonly sun: {
    readonly azimuthDeg: number;
    readonly elevationDeg: number;
    readonly color: ColorHex;
    readonly intensity: number;
  };
  readonly ambient: { readonly color: ColorHex; readonly intensity: number };
  readonly fogDensity: number;
  readonly accentLights: readonly {
    readonly id: string;
    readonly attachedTo: string;
    readonly color: ColorHex;
    readonly intensity: number;
    readonly range: number;
  }[];
}

export interface Weather {
  readonly kind: WeatherKind;
  readonly intensity: number;
  readonly windSpeed: number;
  readonly windAngleDeg: number;
}

export interface Ambience {
  readonly sounds: readonly string[];
  readonly mood: readonly string[];
}

export interface MotionDescriptor {
  readonly id: string;
  readonly target: 'water' | 'vegetation' | 'clouds' | 'particles' | 'light';
  readonly kind: string;
  readonly speed: number;
  readonly amplitude: number;
}

// --------------------------------------------------------------------------
// Composition (focal points, sightlines, camera paths)
// --------------------------------------------------------------------------

export interface FocalPoint {
  readonly id: string;
  readonly targetId: string;
  readonly role: 'hero' | 'secondary' | 'accent';
  readonly weight: number;
}

export interface CameraKeyframe {
  readonly t: number;
  readonly position: Vec3;
  readonly lookAt: Vec3;
  readonly fovDeg: number;
}

export interface CameraPath {
  readonly id: string;
  readonly kind: 'establishing' | 'dolly' | 'orbit' | 'reveal';
  readonly durationSec: number;
  readonly keyframes: readonly CameraKeyframe[];
}

export interface Sightline {
  readonly id: string;
  readonly from: Vec3;
  readonly toId: string;
}

export interface Composition {
  readonly focalPoints: readonly FocalPoint[];
  readonly cameraPaths: readonly CameraPath[];
  readonly sightlines: readonly Sightline[];
  /** How the composition was obtained. */
  readonly basis: 'designed-first' | 'derived-after-layout';
}

// --------------------------------------------------------------------------
// Planning record (explainability)
// --------------------------------------------------------------------------

export interface PlanStage {
  readonly name: string;
  readonly summary: string;
}

export interface PlanConstraint {
  readonly id: string;
  readonly kind: string;
  readonly subject: string;
  readonly detail: string;
  readonly implied: boolean;
}

export interface GeneratorInfo {
  readonly name: 'worldweaver-worldgen';
  readonly version: 1;
  readonly mode: 'deterministic-fallback' | 'provider-assisted';
  readonly providerId: string | null;
  /** True only when an AI model supplied the interpretation. */
  readonly aiInference: boolean;
  readonly note: string;
}

// --------------------------------------------------------------------------
// The blueprint
// --------------------------------------------------------------------------

export interface WorldBlueprint {
  readonly schema: typeof BLUEPRINT_SCHEMA;
  readonly version: typeof BLUEPRINT_VERSION;
  readonly identity: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly prompt: string;
    readonly language: PromptLanguage;
    readonly seed: number;
    readonly strategy: StrategyId;
    readonly generator: GeneratorInfo;
  };
  readonly theme: {
    readonly theme: ThemeId;
    readonly biome: BiomeId;
    readonly palette: readonly ColorHex[];
  };
  readonly atmosphere: {
    readonly timeOfDay: TimeOfDay;
    readonly weather: Weather;
    readonly lighting: Lighting;
    readonly ambience: Ambience;
  };
  readonly motion: readonly MotionDescriptor[];
  readonly space: { readonly extent: number };
  readonly terrain: Terrain;
  readonly water: {
    readonly rivers: readonly River[];
    readonly waterfalls: readonly Waterfall[];
    readonly lakes: readonly Lake[];
  };
  readonly structures: readonly Structure[];
  readonly settlements: readonly Settlement[];
  readonly vegetation: readonly VegetationCluster[];
  readonly paths: readonly PathWay[];
  readonly bridges: readonly Bridge[];
  readonly characters: readonly Character[];
  readonly interactables: readonly Interactable[];
  readonly composition: Composition;
  readonly relations: readonly Relation[];
  readonly requirements: readonly Requirement[];
  readonly planning: {
    readonly stages: readonly PlanStage[];
    readonly constraints: readonly PlanConstraint[];
  };
}

/** Every element collection, in one place, for generic id and transform checks. */
export function allElements(bp: WorldBlueprint): BlueprintElement[] {
  return [
    ...bp.terrain.regions,
    ...bp.water.rivers,
    ...bp.water.waterfalls,
    ...bp.water.lakes,
    ...bp.structures,
    ...bp.settlements,
    ...bp.vegetation,
    ...bp.paths,
    ...bp.bridges,
    ...bp.characters,
    ...bp.interactables,
  ];
}
