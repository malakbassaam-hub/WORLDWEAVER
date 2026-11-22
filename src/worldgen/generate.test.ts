import { describe, expect, it } from 'vitest';
import { generateWorldDeterministic, preferredCandidate, defaultSeed, type GenerateResult } from './generate';
import { candidateDiversity, DIVERSITY_FLOOR } from './score';
import { serializeBlueprint } from './serialize';
import { allElements, type StrategyId, type WorldBlueprint } from './types';

type Ok = Extract<GenerateResult, { ok: true }>;

function gen(prompt: string, seed?: number, strategies?: StrategyId[]): Ok {
  const r = generateWorldDeterministic({ prompt, ...(seed !== undefined ? { seed } : {}), ...(strategies ? { strategies } : {}) });
  if (!r.ok) throw new Error(`generation failed: ${r.code} ${r.message}`);
  return r;
}
const bp = (r: Ok, s: StrategyId): WorldBlueprint => {
  const c = r.candidates.find((x) => x.strategy === s);
  if (!c) throw new Error(`no ${s} candidate`);
  return c.blueprint;
};
const text = (b: WorldBlueprint) => {
  const s = serializeBlueprint(b);
  if (!s.ok) throw new Error(s.error);
  return s.text;
};

const COASTAL_EN = 'A misty coastal village with a lighthouse on the cliffs, a river with a waterfall and a stone bridge';
const COASTAL_AR = 'منارة على جرف بجانب البحر مع قرية صغيرة وشلال وجسر';

describe('generateWorldDeterministic: input validation', () => {
  it.each([
    ['empty prompt', { prompt: '' }, 'INVALID_PROMPT'],
    ['non-text prompt', { prompt: 7 }, 'INVALID_PROMPT'],
    ['missing prompt', { prompt: undefined }, 'INVALID_PROMPT'],
    ['negative seed', { prompt: 'a river', seed: -1 }, 'INVALID_SEED'],
    ['fractional seed', { prompt: 'a river', seed: 1.5 }, 'INVALID_SEED'],
    ['NaN seed', { prompt: 'a river', seed: Number.NaN }, 'INVALID_SEED'],
    ['seed above 2^32-1', { prompt: 'a river', seed: 2 ** 32 }, 'INVALID_SEED'],
    ['unknown strategy', { prompt: 'a river', strategies: ['random-scatter' as StrategyId] }, 'INVALID_STRATEGY'],
    ['duplicate strategy', { prompt: 'a river', strategies: ['constraint-first', 'constraint-first'] as StrategyId[] }, 'INVALID_STRATEGY'],
    ['no strategies', { prompt: 'a river', strategies: [] as StrategyId[] }, 'INVALID_STRATEGY'],
  ])('rejects %s with a coded error', (_label, req, code) => {
    const r = generateWorldDeterministic(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(code);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it('never throws on hostile text', () => {
    for (const prompt of ['{"__proto__":{"x":1}}', '<script>alert(1)</script>', '\u202Eriver', '🌋🌋🌋', 'a'.repeat(2000)]) {
      expect(() => generateWorldDeterministic({ prompt })).not.toThrow();
    }
  });
});

describe('determinism', () => {
  it('same prompt and seed give byte-identical blueprints for both strategies', () => {
    const a = gen(COASTAL_EN, 42);
    const b = gen(COASTAL_EN, 42);
    for (const s of ['constraint-first', 'composition-first'] as const) expect(text(bp(a, s))).toBe(text(bp(b, s)));
    expect(a.comparison).toEqual(b.comparison);
  });

  it('the default seed is a stable hash of the prompt and is recorded', () => {
    const r = gen(COASTAL_EN);
    expect(r.seed).toBe(defaultSeed(COASTAL_EN));
    expect(bp(r, 'constraint-first').identity.seed).toBe(r.seed);
    expect(text(bp(gen(COASTAL_EN), 'composition-first'))).toBe(text(bp(r, 'composition-first')));
  });

  it('different seeds give different worlds', () => {
    for (const s of ['constraint-first', 'composition-first'] as const) {
      expect(text(bp(gen(COASTAL_EN, 1), s))).not.toBe(text(bp(gen(COASTAL_EN, 2), s)));
    }
  });

  it('element ids are stable across regeneration and unique within a blueprint', () => {
    const a = bp(gen(COASTAL_EN, 7), 'composition-first');
    const b = bp(gen(COASTAL_EN, 7), 'composition-first');
    const ids = allElements(a).map((e) => e.id);
    expect(ids).toEqual(allElements(b).map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the two strategies are genuinely different', () => {
  const PROMPTS = [COASTAL_EN, COASTAL_AR, 'An alpine castle above a valley with a forest and two bridges', 'A desert temple with an oasis lake and palm trees at sunset'];

  it('record different decision orders', () => {
    const r = gen(COASTAL_EN, 5);
    const a = bp(r, 'constraint-first').planning.stages.map((s) => s.name);
    const b = bp(r, 'composition-first').planning.stages.map((s) => s.name);
    expect(a[0]).toBe('extract-constraints');
    expect(a).toContain('water-flow');
    expect(a.indexOf('derive-composition')).toBe(a.length - 1);
    expect(b[0]).toBe('design-composition');
    expect(b.indexOf('sculpt-silhouette')).toBeLessThan(b.indexOf('solve-landmarks'));
    expect(b).toContain('leading-lines');
  });

  it('derive composition differently and build different networks', () => {
    for (const prompt of PROMPTS) {
      const r = gen(prompt, 11);
      const a = bp(r, 'constraint-first');
      const b = bp(r, 'composition-first');
      expect(a.composition.basis).toBe('derived-after-layout');
      expect(b.composition.basis).toBe('designed-first');
      // Composition-first always starts from a designed arrival point; constraint-first never does.
      expect(b.structures.some((s) => s.tags.includes('arrival'))).toBe(true);
      expect(a.structures.some((s) => s.tags.includes('arrival'))).toBe(false);
      // Terrain vocabulary differs: B sculpts a hero plateau, A does not.
      expect(b.terrain.regions.some((t) => t.regionKind === 'pedestal')).toBe(true);
      expect(a.terrain.regions.some((t) => t.regionKind === 'pedestal')).toBe(false);
    }
  });

  it('are measurably diverse on every test prompt', () => {
    for (const prompt of PROMPTS) {
      for (const seed of [1, 2, 3]) {
        const r = gen(prompt, seed);
        const d = candidateDiversity(bp(r, 'constraint-first'), bp(r, 'composition-first'));
        expect(d.score, `${prompt} seed ${seed}`).toBeGreaterThanOrEqual(DIVERSITY_FLOOR);
        expect(d.nearDuplicate).toBe(false);
      }
    }
  });

  it('can each be requested alone', () => {
    const r = gen(COASTAL_EN, 3, ['composition-first']);
    expect(r.candidates.map((c) => c.strategy)).toEqual(['composition-first']);
    expect(r.comparison.preferred).toBe('composition-first');
  });
});

describe('validity across prompts and seeds', () => {
  // A deterministic sweep: every candidate must pass validation with zero errors.
  const SWEEP = [
    COASTAL_EN,
    COASTAL_AR,
    'An alpine castle above a valley with a forest and two bridges',
    'A desert temple with an oasis lake and palm trees at sunset',
    'A snowy arctic tower with a frozen lake, no river',
    'Three towers in a magical forest at night with a river and flowers and villagers',
    'قلعة قديمة على جبل مع غابة ونهر وقرية',
    'A tropical island with ruins, a waterfall, a lake and a temple',
  ];

  it.each(SWEEP)('"%s" produces only valid candidates', (prompt) => {
    for (const seed of [101, 202, 303, 404]) {
      const r = gen(prompt, seed);
      expect(r.failures).toEqual([]);
      expect(r.candidates).toHaveLength(2);
      for (const c of r.candidates) {
        const errors = c.report.diagnostics.filter((d) => d.severity === 'error');
        expect(errors, `${c.strategy} seed ${seed}: ${errors.map((e) => e.code).join(', ')}`).toEqual([]);
        expect(c.report.requirements.every((x) => x.satisfied)).toBe(true);
      }
    }
  });
});

describe('content follows the prompt', () => {
  it('builds what an English prompt asks for', () => {
    const r = gen(COASTAL_EN, 9);
    for (const c of r.candidates) {
      const b = c.blueprint;
      expect(b.structures.some((s) => s.structureKind === 'lighthouse')).toBe(true);
      expect(b.water.rivers.length).toBeGreaterThanOrEqual(1);
      expect(b.water.waterfalls.length).toBeGreaterThanOrEqual(1);
      expect(b.bridges.length).toBeGreaterThanOrEqual(1);
      expect(b.settlements.length).toBeGreaterThanOrEqual(1);
      expect(b.theme.biome).toBe('coastal');
      expect(b.atmosphere.weather.kind).toBe('fog');
    }
  });

  it('honours "no river" in English and Arabic', () => {
    for (const prompt of ['A snowy arctic tower with a frozen lake, no river', 'برج جليدي مع بحيرة متجمدة بدون نهر']) {
      for (const c of gen(prompt, 4).candidates) expect(c.blueprint.water.rivers).toEqual([]);
    }
  });

  it('names elements in Arabic for an Arabic prompt and keeps both labels', () => {
    const r = gen(COASTAL_AR, 9);
    for (const c of r.candidates) {
      const b = c.blueprint;
      expect(b.identity.language).toBe('ar');
      expect(b.identity.title).toMatch(/[\u0600-\u06FF]/);
      expect(b.identity.description).toMatch(/[\u0600-\u06FF]/);
      const lighthouse = b.structures.find((s) => s.structureKind === 'lighthouse');
      expect(lighthouse?.name).toMatch(/[\u0600-\u06FF]/);
      expect(lighthouse?.labels.en).toBe('Lighthouse');
      expect(b.characters[0]?.greeting).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it('every element carries provenance that points at real requirements', () => {
    const r = gen(COASTAL_EN, 9);
    for (const c of r.candidates) {
      const reqIds = new Set(c.blueprint.requirements.map((x) => x.id));
      for (const e of allElements(c.blueprint)) {
        expect(e.provenance.origin).toBe('worldgen');
        expect(e.provenance.strategy).toBe(c.strategy);
        expect(e.provenance.rationale.length).toBeGreaterThan(0);
        for (const id of e.provenance.requirementIds) expect(reqIds.has(id)).toBe(true);
      }
      const lighthouse = c.blueprint.structures.find((s) => s.structureKind === 'lighthouse');
      expect(lighthouse?.provenance.requirementIds).toContain('req-lighthouse');
    }
  });
});

describe('labelling and comparison', () => {
  it('labels deterministic generation honestly', () => {
    const r = gen(COASTAL_EN, 1);
    expect(r.generator.mode).toBe('deterministic-fallback');
    expect(r.generator.aiInference).toBe(false);
    expect(r.generator.note).toMatch(/not AI inference/);
    for (const c of r.candidates) expect(c.blueprint.identity.generator).toEqual(r.generator);
  });

  it('explains the preferred candidate', () => {
    const r = gen(COASTAL_EN, 1);
    expect(r.comparison.ranking).toHaveLength(2);
    expect(r.comparison.reasons.length).toBeGreaterThan(1);
    expect(r.comparison.reasons[0]).toContain(String(r.comparison.preferred));
    expect(preferredCandidate(r).strategy).toBe(r.comparison.preferred);
  });

  it('passes interpretation warnings through', () => {
    const r = gen('a tower', 1);
    expect(r.warnings.some((w) => w.includes('temperate'))).toBe(true);
  });
});
