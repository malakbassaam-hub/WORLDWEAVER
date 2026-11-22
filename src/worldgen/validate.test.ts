import { beforeAll, describe, expect, it } from 'vitest';
import { generateWorldDeterministic } from './generate';
import { heightAt } from './terrain';
import type { StrategyId, WorldBlueprint } from './types';
import { validateBlueprint, type ValidationReport } from './validate';

/** Writable view of a type. Homomorphic, so tuples such as Vec3 keep their length. */
type DeepMutable<T> = T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;
type MBlueprint = DeepMutable<WorldBlueprint>;

function generate(prompt: string, seed: number, strategy: StrategyId): WorldBlueprint {
  const r = generateWorldDeterministic({ prompt, seed, strategies: [strategy] });
  if (!r.ok || !r.candidates[0]) throw new Error('generation failed');
  return r.candidates[0].blueprint;
}
/** A deep, writable copy for building broken variants. Test-only. */
const edit = (bp: WorldBlueprint): MBlueprint => structuredClone(bp) as MBlueprint;
const frozen = (m: MBlueprint): WorldBlueprint => m;
const codes = (r: ValidationReport) => r.diagnostics.map((d) => d.code);
const errorCodes = (r: ValidationReport) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);

let coastal: WorldBlueprint;
let oasis: WorldBlueprint;

beforeAll(() => {
  coastal = generate('A misty coastal village with a lighthouse on the cliffs, a river with a waterfall and a stone bridge', 9, 'composition-first');
  oasis = generate('A desert temple with an oasis lake and palm trees at sunset', 9, 'constraint-first');
});

describe('fixtures', () => {
  it('start valid, so every failure below comes from the mutation', () => {
    for (const bp of [coastal, oasis]) {
      const r = validateBlueprint(bp);
      expect(errorCodes(r)).toEqual([]);
      expect(r.valid).toBe(true);
    }
    expect(coastal.water.rivers.length).toBeGreaterThan(0);
    expect(coastal.water.waterfalls.length).toBeGreaterThan(0);
    expect(coastal.bridges.length).toBeGreaterThan(0);
    expect(coastal.structures.length).toBeGreaterThan(2);
    expect(oasis.water.lakes.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(validateBlueprint(coastal)).toEqual(validateBlueprint(coastal));
  });
});

describe('integrity', () => {
  it('detects duplicate ids', () => {
    const m = edit(coastal);
    m.structures[1]!.id = m.structures[0]!.id;
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('ID_DUPLICATE');
  });

  it('detects malformed ids', () => {
    const m = edit(coastal);
    m.structures[0]!.id = 'WG Bad Id';
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('ID_FORMAT');
  });

  it('detects non-finite transforms and non-positive scale', () => {
    const a = edit(coastal);
    a.structures[0]!.transform.position[0] = Number.NaN;
    expect(errorCodes(validateBlueprint(frozen(a)))).toContain('TRANSFORM_INVALID');
    const b = edit(coastal);
    b.vegetation[0]!.transform.scale[1] = 0;
    expect(errorCodes(validateBlueprint(frozen(b)))).toContain('TRANSFORM_INVALID');
  });

  it('detects elements outside the world', () => {
    const m = edit(coastal);
    m.characters[0]!.transform.position[0] = m.space.extent * 2;
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('OUT_OF_BOUNDS');
  });

  it('detects dangling references', () => {
    const m = edit(coastal);
    m.water.waterfalls[0]!.riverId = 'wg:missing-001';
    m.bridges[0]!.pathId = 'wg:missing-002';
    const r = validateBlueprint(frozen(m));
    expect(r.diagnostics.filter((d) => d.code === 'REF_MISSING').length).toBeGreaterThanOrEqual(2);
  });

  it('detects provenance that cites unknown requirements', () => {
    const m = edit(coastal);
    m.structures[0]!.provenance.requirementIds.push('req-unicorn');
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('REF_MISSING');
  });
});

describe('terrain and placement', () => {
  it('detects a structure standing in the sea', () => {
    const m = edit(coastal);
    const E = m.space.extent;
    let sea: [number, number] | null = null;
    for (const p of [[E * 0.97, 0], [0, E * 0.97], [-E * 0.97, 0], [0, -E * 0.97]] as [number, number][]) {
      if (heightAt(coastal.terrain, p[0], p[1]) < coastal.terrain.seaLevel) sea = p;
    }
    expect(sea).not.toBeNull();
    const s = m.structures[0]!;
    s.transform.position = [sea![0], heightAt(coastal.terrain, sea![0], sea![1]), sea![1]];
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('STRUCTURE_UNDERWATER');
  });

  it('detects a floating structure', () => {
    const m = edit(coastal);
    m.structures[0]!.transform.position[1] += 5;
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('STRUCTURE_FLOATING');
  });

  it('detects overlapping structures', () => {
    const m = edit(coastal);
    const a = m.structures[0]!;
    const b = m.structures[1]!;
    b.transform.position = [a.transform.position[0] + 0.5, a.transform.position[1], a.transform.position[2]];
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('COLLISION');
  });

  it('detects a lighthouse far from open water', () => {
    // The desert world has no sea and one small lake: find dry ground well away from it.
    const m = edit(oasis);
    const lake = oasis.water.lakes[0]!;
    let spot: [number, number] | null = null;
    for (let x = -80; x <= 80 && !spot; x += 8) {
      for (let z = -80; z <= 80 && !spot; z += 8) {
        if (Math.hypot(x - lake.center[0], z - lake.center[1]) > lake.radius + 50) spot = [x, z];
      }
    }
    expect(spot).not.toBeNull();
    const s = m.structures[0]!;
    s.structureKind = 'lighthouse';
    s.footprintRadius = 3.2;
    s.transform.position = [spot![0], heightAt(oasis.terrain, spot![0], spot![1]), spot![1]];
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('LANDMARK_SITE');
  });
});

describe('water', () => {
  it('detects a river flowing uphill', () => {
    const m = edit(coastal);
    const pts = m.water.rivers[0]!.points;
    pts[2]![1] = pts[1]![1] + 5;
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('RIVER_UPHILL');
  });

  it('detects a broken river course', () => {
    const m = edit(coastal);
    const river = m.water.rivers[0]!;
    expect(river.points.length).toBeGreaterThan(6);
    river.points.splice(1, river.points.length - 3);
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('RIVER_GAP');
  });

  it('detects a river that does not reach its stated outlet', () => {
    const m = edit(coastal);
    const river = m.water.rivers[0]!;
    river.mouth = { type: 'edge' };
    // Cut the river short so it ends inland.
    river.points.splice(Math.ceil(river.points.length / 2));
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('RIVER_MOUTH');
  });

  it('detects a river running through a building', () => {
    const m = edit(coastal);
    const p = m.water.rivers[0]!.points[3]!;
    const s = m.structures[0]!;
    s.transform.position = [p[0], heightAt(coastal.terrain, p[0], p[2]), p[2]];
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('RIVER_THROUGH_STRUCTURE');
  });

  it('detects a waterfall whose drop does not match the river', () => {
    const m = edit(coastal);
    m.water.waterfalls[0]!.drop += 3;
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('WATERFALL_SEGMENT');
  });

  it('detects a waterfall on a segment with no drop', () => {
    const m = edit(coastal);
    const river = m.water.rivers[0]!;
    const fall = m.water.waterfalls[0]!;
    const flat = river.points.findIndex((p, i) => i + 1 < river.points.length && p[1] - river.points[i + 1]![1] < 0.5);
    expect(flat).toBeGreaterThanOrEqual(0);
    fall.segmentIndex = flat;
    fall.drop = Math.round((river.points[flat]![1] - river.points[flat + 1]![1]) * 1000) / 1000;
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('WATERFALL_NO_DROP');
  });

  it('detects a lake with no water in it and overlapping lakes', () => {
    const dry = edit(oasis);
    dry.water.lakes[0]!.surfaceY = -50;
    expect(errorCodes(validateBlueprint(frozen(dry)))).toContain('LAKE_DRY');
    const twin = edit(oasis);
    const copy = structuredClone(twin.water.lakes[0]!);
    copy.id = 'wg:lake-twin';
    twin.water.lakes.push(copy);
    expect(errorCodes(validateBlueprint(frozen(twin)))).toContain('LAKE_OVERLAP');
  });
});

describe('connectivity', () => {
  it('detects a river crossing without a bridge', () => {
    const m = edit(coastal);
    m.bridges = [];
    m.relations = m.relations.filter((r) => r.type !== 'spans' && !r.from.includes('bridge'));
    const r = validateBlueprint(frozen(m));
    expect(errorCodes(r)).toContain('PATH_RIVER_UNBRIDGED');
    expect(errorCodes(r)).toContain('REQUIREMENT_MISSING');
  });

  it('detects unreachable places', () => {
    const m = edit(coastal);
    m.paths = [];
    m.bridges = [];
    m.relations = [];
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('UNREACHABLE');
  });

  it('detects a path that does not reach its endpoint', () => {
    const m = edit(coastal);
    const path = m.paths[0]!;
    path.points = path.points.slice(0, 2);
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('PATH_ENDPOINT');
  });

  it('detects a bridge that is not on its path or over its river', () => {
    const m = edit(coastal);
    const b = m.bridges[0]!;
    b.transform.position = [b.transform.position[0] + 25, b.transform.position[1], b.transform.position[2] + 25];
    const r = validateBlueprint(frozen(m));
    expect(errorCodes(r)).toContain('BRIDGE_OFF_PATH');
    expect(errorCodes(r)).toContain('BRIDGE_NOT_OVER_WATER');
  });
});

describe('consistency, requirements and composition', () => {
  it('detects species that do not belong to the biome', () => {
    const m = edit(coastal);
    m.vegetation[0]!.speciesId = 'cactus';
    expect(errorCodes(validateBlueprint(frozen(m)))).toContain('SPECIES_BIOME');
  });

  it('warns about implausible weather for the biome', () => {
    const m = edit(oasis);
    m.atmosphere.weather.kind = 'snow';
    expect(codes(validateBlueprint(frozen(m)))).toContain('WEATHER_BIOME');
  });

  it('checks requested, partial and forbidden elements', () => {
    const partial = edit(coastal);
    const river = partial.requirements.find((r) => r.concept === 'river')!;
    river.count = 2;
    const pr = validateBlueprint(frozen(partial));
    expect(codes(pr)).toContain('REQUIREMENT_PARTIAL');
    expect(pr.requirements.find((r) => r.concept === 'river')).toMatchObject({ requested: 2, found: 1, satisfied: false });

    const forbidden = edit(coastal);
    forbidden.requirements.push({ id: 'req-forest', concept: 'forest', count: 0, negated: true, matchedText: 'forest', source: 'lexicon' });
    forbidden.vegetation[0]!.vegetationKind = 'tree';
    expect(errorCodes(validateBlueprint(frozen(forbidden)))).toContain('REQUIREMENT_FORBIDDEN');

    const facet = edit(coastal);
    facet.atmosphere.weather.kind = 'clear';
    expect(errorCodes(validateBlueprint(frozen(facet)))).toContain('REQUIREMENT_MISSING');
  });

  it('requires a hero focal point and a usable camera', () => {
    const noHero = edit(coastal);
    noHero.composition.focalPoints = [];
    expect(errorCodes(validateBlueprint(frozen(noHero)))).toContain('NO_HERO');
    const badCam = edit(coastal);
    badCam.composition.cameraPaths[0]!.keyframes[0]!.fovDeg = 200;
    expect(errorCodes(validateBlueprint(frozen(badCam)))).toContain('CAMERA_INVALID');
    const noCam = edit(coastal);
    noCam.composition.cameraPaths = [];
    expect(errorCodes(validateBlueprint(frozen(noCam)))).toContain('NO_CAMERA');
  });

  it('measures hero framing and reports a hero outside the frame', () => {
    const r = validateBlueprint(coastal);
    expect(r.metrics.heroInFrame).toBe(true);
    expect(r.metrics.thirds).toBeGreaterThan(0.8);
    const m = edit(coastal);
    const key = m.composition.cameraPaths[0]!.keyframes[0]!;
    // Look the opposite way.
    key.lookAt = [2 * key.position[0] - key.lookAt[0], key.lookAt[1], 2 * key.position[2] - key.lookAt[2]];
    const turned = validateBlueprint(frozen(m));
    expect(turned.metrics.heroInFrame).toBe(false);
    expect(codes(turned)).toContain('HERO_OUT_OF_FRAME');
  });
});
