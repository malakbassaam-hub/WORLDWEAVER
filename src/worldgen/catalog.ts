/**
 * Static design tables shared by planners and the validator: what each
 * structure needs, which species live in which biome, and neutral palettes.
 * The validator reads the SAME tables the planners read, so a rule change
 * cannot make one disagree with the other.
 */
import { LEXICON_BY_ID } from './lexicon';
import type {
  BiomeId,
  ColorHex,
  ConceptId,
  Lighting,
  StructureKind,
  ThemeId,
  TimeOfDay,
  VegetationKind,
  WeatherKind,
} from './types';

export interface Labels {
  readonly en: string;
  readonly ar: string;
}

const EXTRA_LABELS: Readonly<Record<string, Labels>> = {
  ridge: { en: 'Ridge', ar: 'حافة جبلية' },
  basin: { en: 'Basin', ar: 'حوض' },
  pedestal: { en: 'Rise', ar: 'مرتفع' },
  undulation: { en: 'Rolling ground', ar: 'أرض متموجة' },
  monument: { en: 'Monument', ar: 'نصب' },
  settlement: { en: 'Settlement', ar: 'قرية' },
  path: { en: 'Path', ar: 'درب' },
  trail: { en: 'Trail', ar: 'مسار' },
  bridge: { en: 'Bridge', ar: 'جسر' },
  keeper: { en: 'Keeper', ar: 'حارس' },
  villager: { en: 'Villager', ar: 'قروي' },
  guardian: { en: 'Guardian', ar: 'حارس' },
  wanderer: { en: 'Wanderer', ar: 'رحّالة' },
  door: { en: 'Entrance', ar: 'مدخل' },
  waystone: { en: 'Waystone', ar: 'حجر الطريق' },
};

export function labelsFor(key: string): Labels {
  const entry = LEXICON_BY_ID.get(key as ConceptId);
  if (entry) return { en: entry.labelEn, ar: entry.labelAr };
  return EXTRA_LABELS[key] ?? { en: key, ar: key };
}

// --------------------------------------------------------------------------
// Structures
// --------------------------------------------------------------------------

export type SitingNeed = 'coast' | 'high' | 'flat' | 'any';

export interface StructureDef {
  readonly kind: StructureKind;
  readonly footprint: number;
  readonly height: number;
  /** Ground slope above which the structure is not plausible. */
  readonly slopeMax: number;
  readonly landmark: boolean;
  readonly need: SitingNeed;
  /** Lighthouses must stand within this distance of open water. */
  readonly maxWaterDistance: number | null;
}

export const STRUCTURE_DEFS: Readonly<Record<StructureKind, StructureDef>> = {
  lighthouse: { kind: 'lighthouse', footprint: 3.2, height: 22, slopeMax: 0.6, landmark: true, need: 'coast', maxWaterDistance: 28 },
  castle: { kind: 'castle', footprint: 11, height: 28, slopeMax: 0.35, landmark: true, need: 'high', maxWaterDistance: null },
  tower: { kind: 'tower', footprint: 3, height: 18, slopeMax: 0.5, landmark: true, need: 'any', maxWaterDistance: null },
  temple: { kind: 'temple', footprint: 7, height: 15, slopeMax: 0.35, landmark: true, need: 'flat', maxWaterDistance: null },
  house: { kind: 'house', footprint: 2.2, height: 5, slopeMax: 0.4, landmark: false, need: 'flat', maxWaterDistance: null },
  ruins: { kind: 'ruins', footprint: 5, height: 6, slopeMax: 0.5, landmark: false, need: 'any', maxWaterDistance: null },
  windmill: { kind: 'windmill', footprint: 3.5, height: 13, slopeMax: 0.4, landmark: true, need: 'high', maxWaterDistance: null },
  monument: { kind: 'monument', footprint: 3, height: 12, slopeMax: 0.5, landmark: true, need: 'any', maxWaterDistance: null },
};

export const STRUCTURE_CONCEPTS: readonly (readonly [ConceptId, StructureKind])[] = [
  ['lighthouse', 'lighthouse'],
  ['castle', 'castle'],
  ['temple', 'temple'],
  ['tower', 'tower'],
  ['windmill', 'windmill'],
  ['ruins', 'ruins'],
];

export const DEFAULT_HERO: Readonly<Record<BiomeId, StructureKind>> = {
  temperate: 'tower',
  desert: 'temple',
  arctic: 'tower',
  tropical: 'temple',
  alpine: 'castle',
  coastal: 'lighthouse',
};

const MATERIALS: Readonly<Record<BiomeId, string>> = {
  temperate: 'stone and timber',
  desert: 'sandstone',
  arctic: 'frosted stone',
  tropical: 'bamboo and thatch',
  alpine: 'granite',
  coastal: 'whitewashed stone',
};
export const materialFor = (biome: BiomeId): string => MATERIALS[biome];

/** A requested forest is satisfied by at least this many tree clusters. */
export const FOREST_MIN_CLUSTERS = 3;

/** Structures are limited per world so the entity count stays bounded. */
export const LIMITS = {
  structures: 30,
  vegetation: 24,
  characters: 12,
  housesPerSettlement: 8,
  rivers: 2,
  lakes: 3,
} as const;

// --------------------------------------------------------------------------
// Vegetation
// --------------------------------------------------------------------------

export interface SpeciesDef {
  readonly id: string;
  readonly labels: Labels;
  readonly kind: VegetationKind;
  readonly biomes: readonly BiomeId[];
  /** Maximum ground slope the species grows on. */
  readonly slopeMax: number;
  /** When set, the species needs open water within this distance (oases, wetlands). */
  readonly waterWithin: number | null;
  /** Highest ground (above sea level) the species grows at. */
  readonly maxAltitude: number;
}

const sp = (
  id: string,
  en: string,
  ar: string,
  kind: VegetationKind,
  biomes: BiomeId[],
  slopeMax: number,
  waterWithin: number | null,
  maxAltitude: number,
): SpeciesDef => ({ id, labels: { en, ar }, kind, biomes, slopeMax, waterWithin, maxAltitude });

export const SPECIES: readonly SpeciesDef[] = [
  sp('oak', 'Oak grove', 'بستان بلوط', 'tree', ['temperate', 'coastal'], 0.7, null, 55),
  sp('birch', 'Birch stand', 'أشجار البتولا', 'tree', ['temperate', 'alpine'], 0.7, null, 60),
  sp('meadow-flowers', 'Meadow flowers', 'زهور المرج', 'flower', ['temperate', 'coastal', 'alpine', 'tropical'], 0.5, null, 60),
  sp('tall-grass', 'Tall grass', 'عشب طويل', 'grass', ['temperate', 'coastal', 'tropical'], 0.6, null, 60),
  sp('date-palm', 'Date palms', 'نخيل', 'tree', ['desert', 'tropical', 'coastal'], 0.5, 22, 30),
  sp('cactus', 'Cactus patch', 'صبار', 'cactus', ['desert'], 0.6, null, 45),
  sp('dune-scrub', 'Dune scrub', 'شجيرات الكثبان', 'shrub', ['desert', 'coastal'], 0.7, null, 45),
  sp('spruce', 'Spruce stand', 'أشجار التنوب', 'tree', ['arctic', 'alpine'], 0.8, null, 70),
  sp('frost-shrub', 'Frost shrubs', 'شجيرات الصقيع', 'shrub', ['arctic', 'alpine'], 0.9, null, 90),
  sp('snow-grass', 'Snow grass', 'عشب الثلج', 'grass', ['arctic'], 0.7, null, 90),
  sp('palm', 'Palm grove', 'بستان نخيل', 'tree', ['tropical', 'coastal'], 0.6, null, 40),
  sp('fern', 'Ferns', 'سراخس', 'shrub', ['tropical', 'temperate'], 0.8, null, 50),
  sp('orchid', 'Orchids', 'أوركيد', 'flower', ['tropical'], 0.6, null, 40),
  sp('pine', 'Pine forest', 'غابة صنوبر', 'tree', ['alpine', 'coastal', 'arctic', 'temperate'], 0.9, null, 75),
  sp('alpine-shrub', 'Alpine shrubs', 'شجيرات جبلية', 'shrub', ['alpine'], 1.0, null, 95),
  sp('gentian', 'Gentians', 'جنطيانا', 'flower', ['alpine'], 0.8, null, 95),
  sp('reed-bed', 'Reed bed', 'قصب', 'grass', ['temperate', 'tropical', 'coastal', 'desert', 'arctic', 'alpine'], 0.3, 6, 25),
];

export const speciesById = (id: string): SpeciesDef | undefined => SPECIES.find((s) => s.id === id);
export const speciesForBiome = (biome: BiomeId): SpeciesDef[] => SPECIES.filter((s) => s.biomes.includes(biome));

/** Weather that makes physical sense in a biome. */
export function weatherFitsBiome(weather: WeatherKind, biome: BiomeId): boolean {
  if (weather === 'snow') return biome === 'arctic' || biome === 'alpine';
  if (weather === 'rain') return biome !== 'desert';
  return true;
}

// --------------------------------------------------------------------------
// Palettes and lighting (descriptors only)
// --------------------------------------------------------------------------

const BIOME_PALETTE: Readonly<Record<BiomeId, readonly ColorHex[]>> = {
  temperate: ['#3f6b3a', '#7a8f4a', '#8a6f4a'],
  desert: ['#d9b36c', '#b8783f', '#8f5a34'],
  arctic: ['#dbe8f2', '#9ab8d0', '#5c7a99'],
  tropical: ['#2f8a4a', '#5bb36a', '#c99a54'],
  alpine: ['#6b7b6a', '#8e9aa6', '#4a5d48'],
  coastal: ['#c9b78a', '#5f8f9a', '#4c6a58'],
};
const THEME_ACCENT: Readonly<Record<ThemeId, readonly ColorHex[]>> = {
  serene: ['#a9c9d6', '#e8dfc8'],
  mystic: ['#9b7bff', '#5de0ff'],
  ominous: ['#6a2f3a', '#2b2b3a'],
  ancient: ['#a58f6a', '#6f5f45'],
  vibrant: ['#ff9f4a', '#ff5fa8'],
};
export const paletteFor = (biome: BiomeId, theme: ThemeId): ColorHex[] => [...BIOME_PALETTE[biome], ...THEME_ACCENT[theme]];

const SUN: Readonly<Record<TimeOfDay, { az: number; el: number; color: ColorHex; intensity: number }>> = {
  dawn: { az: 95, el: 8, color: '#ffc59a', intensity: 0.9 },
  day: { az: 160, el: 58, color: '#fff4dc', intensity: 1.4 },
  sunset: { az: 265, el: 6, color: '#ff9a57', intensity: 1.0 },
  night: { az: 20, el: -12, color: '#8fa6ff', intensity: 0.25 },
};
const AMBIENT: Readonly<Record<TimeOfDay, { color: ColorHex; intensity: number }>> = {
  dawn: { color: '#b9a8c9', intensity: 0.45 },
  day: { color: '#bcd4e6', intensity: 0.6 },
  sunset: { color: '#8f78a8', intensity: 0.4 },
  night: { color: '#27325a', intensity: 0.22 },
};
const FOG: Readonly<Record<WeatherKind, number>> = { clear: 0.004, fog: 0.03, rain: 0.012, snow: 0.015, storm: 0.02 };

export function lightingFor(time: TimeOfDay, weather: WeatherKind, theme: ThemeId): Omit<Lighting, 'accentLights'> {
  const s = SUN[time];
  const dim = weather === 'storm' ? 0.45 : weather === 'fog' || weather === 'rain' ? 0.7 : 1;
  const mood = theme === 'ominous' ? 0.85 : 1;
  return {
    sun: { azimuthDeg: s.az, elevationDeg: s.el, color: s.color, intensity: Math.round(s.intensity * dim * mood * 100) / 100 },
    ambient: AMBIENT[time],
    fogDensity: FOG[weather] + (theme === 'mystic' ? 0.004 : 0),
  };
}

export const SOUNDS: Readonly<Record<BiomeId, readonly string[]>> = {
  temperate: ['birdsong', 'rustling leaves'],
  desert: ['dry wind', 'distant sand hiss'],
  arctic: ['howling wind', 'creaking ice'],
  tropical: ['insects', 'distant birds'],
  alpine: ['thin wind', 'distant rockfall'],
  coastal: ['waves', 'gulls'],
};
