/**
 * WorldBlueprint serialisation.
 *
 * - `serializeBlueprint` writes canonical JSON (sorted keys), so the same
 *   blueprint always produces the same bytes and fingerprint.
 * - `parseBlueprint` treats its input as UNTRUSTED: size limit, JSON parse,
 *   schema and version check (with a migration hook), then a strict structural
 *   check of every field. Unknown fields are rejected. It never throws.
 *
 * Structural validity is separate from semantic validity: run
 * `validateBlueprint` on the parsed value to check rivers, paths and so on.
 */
import { canonical, fingerprint } from '../core/fingerprint';
import { BIOMES, BLUEPRINT_SCHEMA, BLUEPRINT_VERSION, STRATEGIES, THEMES, TIMES_OF_DAY, WEATHER_KINDS, type WorldBlueprint } from './types';

export const MAX_BLUEPRINT_BYTES = 4_000_000;
const MAX_ITEMS = 5000;
const MAX_ERRORS = 25;

export type SerializeResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };
export type BlueprintParse = { readonly ok: true; readonly blueprint: WorldBlueprint } | { readonly ok: false; readonly errors: readonly string[] };

function firstNonFinite(value: unknown, path: string): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = firstNonFinite(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = firstNonFinite(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function serializeBlueprint(bp: WorldBlueprint): SerializeResult {
  const bad = firstNonFinite(bp, '$');
  if (bad) return { ok: false, error: `Blueprint contains a non-finite number at ${bad}.` };
  return { ok: true, text: canonical(bp) };
}

/** Content fingerprint (64-bit, non-cryptographic; see core/fingerprint.ts). */
export function blueprintFingerprint(bp: WorldBlueprint): string {
  return fingerprint(canonical(bp));
}

// ---------------------------------------------------------------------------
// Version handling
// ---------------------------------------------------------------------------

/**
 * Migrations from older versions: MIGRATIONS[n] upgrades a raw v(n) object to v(n+1).
 * Version 1 is the first published version, so the table is empty today.
 */
const MIGRATIONS: Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>> = {};

export function upgradeBlueprint(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'Blueprint must be a JSON object.' };
  if (raw.schema !== BLUEPRINT_SCHEMA) return { ok: false, error: `Not a WorldBlueprint (schema must be "${BLUEPRINT_SCHEMA}").` };
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { ok: false, error: 'Blueprint version must be a positive integer.' };
  if (v > BLUEPRINT_VERSION) return { ok: false, error: `Blueprint version ${v} is newer than this build supports (${BLUEPRINT_VERSION}).` };
  let value = raw;
  for (let from = v; from < BLUEPRINT_VERSION; from++) {
    const step = MIGRATIONS[from];
    if (!step) return { ok: false, error: `No migration from blueprint version ${from}.` };
    value = step(value);
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Structural schema
// ---------------------------------------------------------------------------

type Check = (v: unknown, path: string, errs: string[]) => void;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (errs: string[], msg: string) => {
  if (errs.length < MAX_ERRORS) errs.push(msg);
};

const str = (max = 2000): Check => (v, p, e) => {
  if (typeof v !== 'string' || v.length > max) fail(e, `${p} must be text (at most ${max} characters).`);
};
const num: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(e, `${p} must be a finite number.`);
};
const int: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(e, `${p} must be an integer.`);
};
const bool: Check = (v, p, e) => {
  if (typeof v !== 'boolean') fail(e, `${p} must be true or false.`);
};
const oneOf = (values: readonly unknown[]): Check => (v, p, e) => {
  if (!values.includes(v)) fail(e, `${p} must be one of ${values.map(String).join(', ')}.`);
};
const tuple = (n: number): Check => (v, p, e) => {
  if (!Array.isArray(v) || v.length !== n || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) fail(e, `${p} must be ${n} finite numbers.`);
};
const vec2 = tuple(2);
const vec3 = tuple(3);
const hex: Check = (v, p, e) => {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) fail(e, `${p} must be a #rrggbb colour.`);
};
const nullable = (c: Check): Check => (v, p, e) => {
  if (v !== null) c(v, p, e);
};
const arr = (item: Check, max = MAX_ITEMS): Check => (v, p, e) => {
  if (!Array.isArray(v)) return fail(e, `${p} must be a list.`);
  if (v.length > max) return fail(e, `${p} has more than ${max} items.`);
  v.forEach((x, i) => item(x, `${p}[${i}]`, e));
};
const obj = (fields: Record<string, Check>, optional: readonly string[] = []): Check => (v, p, e) => {
  if (!isObj(v)) return fail(e, `${p} must be an object.`);
  for (const key of Object.keys(v)) if (!(key in fields)) fail(e, `${p} has unknown field "${key}".`);
  for (const [key, check] of Object.entries(fields)) {
    if (v[key] === undefined) {
      if (!optional.includes(key)) fail(e, `${p}.${key} is missing.`);
      continue;
    }
    check(v[key], `${p}.${key}`, e);
  }
};
const scalarRecord: Check = (v, p, e) => {
  if (!isObj(v)) return fail(e, `${p} must be an object.`);
  for (const [k, x] of Object.entries(v)) {
    const ok = typeof x === 'string' ? x.length <= 500 : typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));
    if (!ok) fail(e, `${p}.${k} must be text, a finite number or true/false.`);
  }
};

const transform = obj({ position: vec3, rotation: vec3, scale: vec3 });
const provenance = obj({ origin: oneOf(['worldgen']), strategy: oneOf(STRATEGIES), stage: str(80), requirementIds: arr(str(80), 50), rationale: str(500), seed: int });
const base: Record<string, Check> = {
  id: str(120),
  name: str(160),
  labels: obj({ en: str(160), ar: str(160) }),
  transform,
  tags: arr(str(60), 40),
  provenance,
  properties: scalarRecord,
};
const element = (extra: Record<string, Check>): Check => obj({ ...base, ...extra });

const mouth: Check = (v, p, e) => {
  if (!isObj(v)) return fail(e, `${p} must be an object.`);
  if (v.type === 'lake') obj({ type: oneOf(['lake']), lakeId: str(120) })(v, p, e);
  else obj({ type: oneOf(['sea', 'edge']) })(v, p, e);
};

const BLUEPRINT_SHAPE: Check = obj({
  schema: oneOf([BLUEPRINT_SCHEMA]),
  version: oneOf([BLUEPRINT_VERSION]),
  identity: obj({
    id: str(120),
    title: str(200),
    description: str(2000),
    prompt: str(2000),
    language: oneOf(['en', 'ar', 'mixed', 'unknown']),
    seed: int,
    strategy: oneOf(STRATEGIES),
    generator: obj({
      name: oneOf(['worldweaver-worldgen']),
      version: oneOf([1]),
      mode: oneOf(['deterministic-fallback', 'provider-assisted']),
      providerId: nullable(str(80)),
      aiInference: bool,
      note: str(1000),
    }),
  }),
  theme: obj({ theme: oneOf(THEMES), biome: oneOf(BIOMES), palette: arr(hex, 16) }),
  atmosphere: obj({
    timeOfDay: oneOf(TIMES_OF_DAY),
    weather: obj({ kind: oneOf(WEATHER_KINDS), intensity: num, windSpeed: num, windAngleDeg: num }),
    lighting: obj({
      sun: obj({ azimuthDeg: num, elevationDeg: num, color: hex, intensity: num }),
      ambient: obj({ color: hex, intensity: num }),
      fogDensity: num,
      accentLights: arr(obj({ id: str(80), attachedTo: str(120), color: hex, intensity: num, range: num }), 64),
    }),
    ambience: obj({ sounds: arr(str(80), 20), mood: arr(str(80), 20) }),
  }),
  motion: arr(obj({ id: str(80), target: oneOf(['water', 'vegetation', 'clouds', 'particles', 'light']), kind: str(60), speed: num, amplitude: num }), 32),
  space: obj({ extent: num }),
  terrain: obj({
    seaLevel: num,
    baseHeight: num,
    islandRadius: nullable(num),
    tilt: nullable(obj({ angle: num, gradient: num })),
    regions: arr(
      element({
        regionKind: oneOf(['mountain', 'hill', 'valley', 'cliff', 'ridge', 'basin', 'pedestal', 'undulation']),
        center: vec2,
        radius: num,
        amplitude: num,
        sharpness: num,
        aspect: num,
        angle: num,
      }),
      200,
    ),
  }),
  water: obj({
    rivers: arr(element({ width: num, points: arr(vec3, 1000), mouth }), 20),
    waterfalls: arr(element({ riverId: str(120), segmentIndex: int, drop: num, width: num }), 40),
    lakes: arr(element({ center: vec2, radius: num, surfaceY: num }), 20),
  }),
  structures: arr(
    element({
      structureKind: oneOf(['lighthouse', 'castle', 'tower', 'temple', 'house', 'ruins', 'windmill', 'monument']),
      footprintRadius: num,
      height: num,
      isLandmark: bool,
      settlementId: nullable(str(120)),
      material: str(80),
    }),
    200,
  ),
  settlements: arr(element({ center: vec2, radius: num, structureIds: arr(str(120), 100) }), 20),
  vegetation: arr(
    element({
      speciesId: str(60),
      vegetationKind: oneOf(['tree', 'shrub', 'flower', 'cactus', 'grass']),
      ecosystem: str(60),
      center: vec2,
      radius: num,
      count: int,
    }),
    200,
  ),
  paths: arr(element({ pathKind: oneOf(['road', 'trail']), width: num, points: arr(vec3, 2000), fromId: str(120), toId: str(120) }), 200),
  bridges: arr(element({ pathId: str(120), overId: str(120), length: num, width: num, deckY: num }), 100),
  characters: arr(element({ role: str(60), homeId: nullable(str(120)), greeting: str(300) }), 100),
  interactables: arr(element({ interaction: oneOf(['inspect', 'talk', 'enter', 'use']), targetId: str(120) }), 100),
  composition: obj({
    focalPoints: arr(obj({ id: str(80), targetId: str(120), role: oneOf(['hero', 'secondary', 'accent']), weight: num }), 32),
    cameraPaths: arr(
      obj({
        id: str(80),
        kind: oneOf(['establishing', 'dolly', 'orbit', 'reveal']),
        durationSec: num,
        keyframes: arr(obj({ t: num, position: vec3, lookAt: vec3, fovDeg: num }), 64),
      }),
      16,
    ),
    sightlines: arr(obj({ id: str(80), from: vec3, toId: str(120) }), 32),
    basis: oneOf(['designed-first', 'derived-after-layout']),
  }),
  relations: arr(
    obj({ type: oneOf(['near', 'on', 'flows-into', 'spans', 'connects', 'faces', 'part-of', 'overlooks', 'inhabits', 'falls-from']), from: str(120), to: str(120), note: str(300) }, ['note']),
    4000,
  ),
  requirements: arr(
    obj({ id: str(80), concept: str(40), count: int, negated: bool, matchedText: str(200), source: oneOf(['lexicon', 'provider', 'implied']) }),
    80,
  ),
  planning: obj({
    stages: arr(obj({ name: str(80), summary: str(600) }), 40),
    constraints: arr(obj({ id: str(40), kind: str(40), subject: str(80), detail: str(600), implied: bool }), 400),
  }),
});

/** Structural check only. Returns the problems found (empty when well-formed). */
export function checkBlueprintShape(value: unknown): string[] {
  const errs: string[] = [];
  BLUEPRINT_SHAPE(value, '$', errs);
  return errs;
}

/**
 * Type guard over the structural check: true only when every field of
 * WorldBlueprint was verified above. Problems are appended to `errors`.
 */
export function isWellFormedBlueprint(value: unknown, errors: string[] = []): value is WorldBlueprint {
  errors.push(...checkBlueprintShape(value));
  return errors.length === 0;
}

export function parseBlueprint(text: unknown): BlueprintParse {
  if (typeof text !== 'string') return { ok: false, errors: ['Blueprint must be provided as JSON text.'] };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BLUEPRINT_BYTES) return { ok: false, errors: [`Blueprint is ${bytes} bytes; the limit is ${MAX_BLUEPRINT_BYTES}.`] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Blueprint is not valid JSON.'] };
  }
  const upgraded = upgradeBlueprint(raw);
  if (!upgraded.ok) return { ok: false, errors: [upgraded.error] };
  const errors: string[] = [];
  const value: unknown = upgraded.value;
  if (!isWellFormedBlueprint(value, errors)) return { ok: false, errors };
  return { ok: true, blueprint: value };
}
