import { describe, expect, it } from 'vitest';
import { PROMPT_MAX_LENGTH, checkPrompt, interpretPrompt, parseInterpretation, type Interpretation } from './interpret';

const concepts = (i: Interpretation) => i.requirements.filter((r) => !r.negated && r.source !== 'implied').map((r) => r.concept).sort();
const req = (i: Interpretation, c: string) => i.requirements.find((r) => r.concept === c);

describe('checkPrompt', () => {
  it('accepts and trims normal text', () => {
    expect(checkPrompt('  a river  ')).toEqual({ ok: true, prompt: 'a river' });
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['an object', { prompt: 'x' }],
    ['an empty string', ''],
    ['whitespace', '   \n\t '],
    ['an over-long string', 'a'.repeat(PROMPT_MAX_LENGTH + 1)],
    ['control characters', 'a river\u0000with a NUL'],
  ])('rejects %s', (_label, value) => {
    const r = checkPrompt(value);
    expect(r.ok).toBe(false);
  });
});

describe('interpretPrompt (English)', () => {
  it('extracts features, facets and the language', () => {
    const i = interpretPrompt('A misty coastal village with a lighthouse on the cliffs, a river with a waterfall and a stone bridge at sunset');
    expect(i.language).toBe('en');
    expect(concepts(i)).toEqual(['bridge', 'cliff', 'lighthouse', 'river', 'village', 'waterfall']);
    expect(i.biome).toBe('coastal');
    expect(i.timeOfDay).toBe('sunset');
    expect(i.weather).toBe('fog');
  });

  it('reads counts from digits and number words', () => {
    expect(req(interpretPrompt('three towers'), 'tower')?.count).toBe(3);
    expect(req(interpretPrompt('2 bridges over the river'), 'bridge')?.count).toBe(2);
    expect(req(interpretPrompt('a tall tower'), 'tower')?.count).toBe(1);
  });

  it('caps counts at the concept maximum', () => {
    expect(req(interpretPrompt('8 lighthouses'), 'lighthouse')?.count).toBe(2);
  });

  it('understands negation', () => {
    const i = interpretPrompt('a snowy tower with a lake and no river');
    expect(req(i, 'river')).toMatchObject({ negated: true, count: 0 });
    expect(req(i, 'lake')?.negated).toBe(false);
  });

  it('reports conflicting mentions instead of hiding them', () => {
    const i = interpretPrompt('a river valley without a river');
    expect(req(i, 'river')?.negated).toBe(true);
    expect(i.warnings.some((w) => w.includes('Conflicting mentions of "river"'))).toBe(true);
  });

  it('reports conflicting biomes and uses the first', () => {
    const i = interpretPrompt('a desert island with arctic glaciers');
    expect(i.biome).toBe('desert');
    expect(i.warnings.some((w) => w.startsWith('Conflicting biomes'))).toBe(true);
  });

  it('infers a biome from features and says when it defaults', () => {
    expect(interpretPrompt('a lighthouse').biome).toBe('coastal');
    const plain = interpretPrompt('a tower');
    expect(plain.biome).toBe('temperate');
    expect(plain.defaulted).toContain('biome');
    expect(plain.warnings.some((w) => w.includes('temperate'))).toBe(true);
  });

  it('adds requirements for explicit facets only', () => {
    const explicit = interpretPrompt('a desert temple at night in a storm');
    expect(req(explicit, 'desert')?.source).toBe('implied');
    expect(req(explicit, 'night')).toBeDefined();
    expect(req(explicit, 'storm')).toBeDefined();
    const defaulted = interpretPrompt('a tower');
    expect(req(defaulted, 'temperate')).toBeUndefined();
    expect(req(defaulted, 'day')).toBeUndefined();
  });

  it('warns when nothing is recognised', () => {
    const i = interpretPrompt('xyzzy plugh');
    expect(i.requirements).toEqual([]);
    expect(i.warnings.some((w) => w.includes('No world features'))).toBe(true);
  });
});

describe('interpretPrompt (Arabic and mixed)', () => {
  it('extracts the same features from Arabic as from the English equivalent', () => {
    const ar = interpretPrompt('قرية ساحلية مع منارة على الجرف ونهر وشلال وجسر عند الغروب');
    const en = interpretPrompt('A coastal village with a lighthouse on the cliff, a river, a waterfall and a bridge at sunset');
    expect(ar.language).toBe('ar');
    expect(concepts(ar)).toEqual(concepts(en));
    expect(ar.biome).toBe(en.biome);
    expect(ar.timeOfDay).toBe('sunset');
  });

  it('reads Arabic number words and Arabic-Indic digits', () => {
    expect(req(interpretPrompt('ثلاثة أبراج'), 'tower')?.count).toBe(3);
    expect(req(interpretPrompt('٢ جسور'), 'bridge')?.count).toBe(2);
  });

  it('understands Arabic negation', () => {
    expect(req(interpretPrompt('بحيرة متجمدة بدون نهر'), 'river')?.negated).toBe(true);
  });

  it('handles mixed-language prompts', () => {
    const i = interpretPrompt('A castle قلعة with a نهر');
    expect(i.language).toBe('mixed');
    expect(concepts(i)).toEqual(['castle', 'river']);
  });
});

describe('parseInterpretation (provider output)', () => {
  const good = {
    language: 'en',
    biome: 'alpine',
    theme: 'ancient',
    timeOfDay: 'dawn',
    weather: 'snow',
    requirements: [{ concept: 'castle', count: 1 }, { concept: 'river', negated: true }],
  };

  it('accepts valid output and marks requirements as provider-sourced', () => {
    const r = parseInterpretation(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.requirements.find((x) => x.concept === 'castle')).toMatchObject({ source: 'provider', count: 1 });
    expect(r.value.requirements.find((x) => x.concept === 'river')).toMatchObject({ negated: true, count: 0 });
    expect(r.value.requirements.find((x) => x.concept === 'alpine')?.source).toBe('implied');
  });

  it.each([
    ['not an object', 'castle'],
    ['an unknown field', { ...good, code: 'eval()' }],
    ['a bad biome', { ...good, biome: 'lava' }],
    ['an unknown concept', { ...good, requirements: [{ concept: 'spaceship' }] }],
    ['a repeated concept', { ...good, requirements: [{ concept: 'castle' }, { concept: 'castle' }] }],
    ['a count above the maximum', { ...good, requirements: [{ concept: 'lighthouse', count: 9 }] }],
    ['a fractional count', { ...good, requirements: [{ concept: 'tower', count: 1.5 }] }],
    ['too many requirements', { ...good, requirements: Array.from({ length: 41 }, () => ({ concept: 'tower' })) }],
    ['non-string warnings', { ...good, warnings: [1, 2] }],
  ])('rejects %s', (_label, value) => {
    const r = parseInterpretation(value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
});
