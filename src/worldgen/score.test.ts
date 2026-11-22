import { describe, expect, it } from 'vitest';
import { generateWorldDeterministic } from './generate';
import { CATEGORY_WEIGHTS, DIVERSITY_FLOOR, candidateDiversity, compareCandidates, scoreBlueprint, type RankedCandidate } from './score';
import type { StrategyId, WorldBlueprint } from './types';
import { CATEGORIES, validateBlueprint } from './validate';

/** Writable view of a type. Homomorphic, so tuples such as Vec3 keep their length. */
type DeepMutable<T> = T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;

function candidate(bp: WorldBlueprint): RankedCandidate {
  const report = validateBlueprint(bp);
  return { blueprint: bp, report, score: scoreBlueprint(bp, report) };
}
function generate(prompt: string, seed: number, strategy: StrategyId): WorldBlueprint {
  const r = generateWorldDeterministic({ prompt, seed, strategies: [strategy] });
  if (!r.ok || !r.candidates[0]) throw new Error('generation failed');
  return r.candidates[0].blueprint;
}

const PROMPT = 'A misty coastal village with a lighthouse on the cliffs, a river with a waterfall and a stone bridge';

describe('scoreBlueprint', () => {
  it('weights sum to 1 and every category is scored', () => {
    expect(Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const s = candidate(generate(PROMPT, 3, 'constraint-first')).score;
    expect(s.categories.map((c) => c.category)).toEqual([...CATEGORIES]);
    for (const c of s.categories) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
      expect(c.summary.length).toBeGreaterThan(0);
    }
    expect(s.total).toBeGreaterThan(0);
  });

  it('loses points exactly where diagnostics are reported', () => {
    const good = generate(PROMPT, 3, 'composition-first');
    const broken = structuredClone(good) as DeepMutable<WorldBlueprint>;
    broken.bridges = [];
    const g = candidate(good).score;
    const b = candidate(broken).score;
    const cat = (s: typeof g, name: string) => s.categories.find((c) => c.category === name)!;
    expect(cat(b, 'connectivity').score).toBeLessThan(cat(g, 'connectivity').score);
    expect(cat(b, 'requirements').score).toBeLessThan(cat(g, 'requirements').score);
    expect(cat(b, 'terrain').score).toBe(cat(g, 'terrain').score);
    expect(b.valid).toBe(false);
    expect(b.total).toBeLessThan(g.total);
  });
});

describe('compareCandidates', () => {
  it('prefers a valid candidate over an invalid one and names the error', () => {
    const a = generate(PROMPT, 3, 'constraint-first');
    const b = structuredClone(generate(PROMPT, 3, 'composition-first')) as DeepMutable<WorldBlueprint>;
    b.paths = [];
    b.bridges = [];
    const cmp = compareCandidates([candidate(b), candidate(a)]);
    expect(cmp.preferred).toBe('constraint-first');
    expect(cmp.ranking[0]).toMatchObject({ strategy: 'constraint-first', valid: true });
    expect(cmp.reasons[0]).toMatch(/composition-first has \d+ error/);
  });

  it('explains category differences and includes diversity', () => {
    const cmp = compareCandidates([candidate(generate(PROMPT, 3, 'constraint-first')), candidate(generate(PROMPT, 3, 'composition-first'))]);
    expect(cmp.preferred).not.toBeNull();
    expect(cmp.reasons.length).toBeGreaterThanOrEqual(2);
    expect(cmp.diversity).not.toBeNull();
    expect(cmp.reasons.at(-1)).toContain('Diversity');
  });

  it('breaks ties by strategy order, deterministically', () => {
    const bp = generate(PROMPT, 3, 'constraint-first');
    const twin = structuredClone(bp) as DeepMutable<WorldBlueprint>;
    twin.identity.strategy = 'composition-first';
    for (const e of [...twin.structures, ...twin.terrain.regions, ...twin.water.rivers, ...twin.water.lakes, ...twin.water.waterfalls, ...twin.settlements, ...twin.vegetation, ...twin.paths, ...twin.bridges, ...twin.characters, ...twin.interactables]) {
      e.provenance.strategy = 'composition-first';
    }
    const cmp = compareCandidates([candidate(twin), candidate(bp)]);
    expect(cmp.ranking[0]!.total).toBe(cmp.ranking[1]!.total);
    expect(cmp.preferred).toBe('constraint-first');
    expect(cmp.reasons[0]).toMatch(/tie/);
  });

  it('handles empty input', () => {
    expect(compareCandidates([]).preferred).toBeNull();
  });
});

describe('candidateDiversity', () => {
  it('is zero for identical blueprints and flags them as near-duplicates', () => {
    const bp = generate(PROMPT, 3, 'constraint-first');
    const d = candidateDiversity(bp, bp);
    expect(d.score).toBe(0);
    expect(d.nearDuplicate).toBe(true);
    expect(d.summary).toMatch(/near-duplicates/);
  });

  it('is above the floor for the two strategies', () => {
    const d = candidateDiversity(generate(PROMPT, 3, 'constraint-first'), generate(PROMPT, 3, 'composition-first'));
    expect(d.score).toBeGreaterThanOrEqual(DIVERSITY_FLOOR);
    expect(d.topologyDifference).toBeGreaterThan(0);
  });

  it('is symmetric', () => {
    const a = generate(PROMPT, 3, 'constraint-first');
    const b = generate(PROMPT, 3, 'composition-first');
    expect(candidateDiversity(a, b).score).toBeCloseTo(candidateDiversity(b, a).score, 2);
  });
});
