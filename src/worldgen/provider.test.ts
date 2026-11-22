import { describe, expect, it, vi } from 'vitest';
import { generateWorld } from './generate';
import { BIOMES } from './types';
import {
  DETERMINISTIC_NOTE,
  INTERPRETATION_RESPONSE_SCHEMA,
  buildInterpretationRequest,
  resolveInterpretation,
  type InterpretationProvider,
  type InterpretationRequest,
} from './provider';

const PROMPT = 'An ancient castle on a mountain at dawn';
const VALID = {
  language: 'en',
  biome: 'alpine',
  theme: 'ancient',
  timeOfDay: 'dawn',
  weather: 'snow',
  requirements: [{ concept: 'castle', count: 1, matchedText: 'castle' }, { concept: 'mountain', count: 1 }],
};

function provider(kind: InterpretationProvider['kind'], impl: (req: InterpretationRequest, signal: AbortSignal) => Promise<unknown>): InterpretationProvider & { calls: InterpretationRequest[] } {
  const calls: InterpretationRequest[] = [];
  return {
    id: kind === 'ai-model' ? 'test-model' : 'test-rules',
    kind,
    model: 'fixture-1',
    calls,
    interpret: (req, signal) => {
      calls.push(req);
      return impl(req, signal);
    },
  };
}

describe('resolveInterpretation', () => {
  it('without a provider uses the labelled deterministic interpreter', async () => {
    const r = await resolveInterpretation(PROMPT, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.generator).toMatchObject({ mode: 'deterministic-fallback', aiInference: false, providerId: null });
    expect(r.generator.note).toContain('No interpretation provider configured');
    expect(r.generator.note).toContain(DETERMINISTIC_NOTE);
  });

  it('uses valid AI output and labels it as AI inference', async () => {
    const p = provider('ai-model', async () => VALID);
    const r = await resolveInterpretation(PROMPT, p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.generator).toMatchObject({ mode: 'provider-assisted', aiInference: true, providerId: 'test-model' });
    expect(r.generator.note).toContain('fixture-1');
    expect(r.generator.note).toContain('Layout is planned deterministically');
    expect(r.interpretation.biome).toBe('alpine');
    expect(r.interpretation.requirements.find((x) => x.concept === 'castle')?.source).toBe('provider');
  });

  it('never labels a rule-based provider as AI inference', async () => {
    const r = await resolveInterpretation(PROMPT, provider('rule-based', async () => VALID));
    expect(r.ok && r.generator).toMatchObject({ mode: 'provider-assisted', aiInference: false });
  });

  it('uses detected language, not the language the provider claims', async () => {
    const r = await resolveInterpretation('قلعة على جبل', provider('ai-model', async () => ({ ...VALID, language: 'en' })));
    expect(r.ok && r.interpretation.language).toBe('ar');
  });

  it('falls back explicitly when the provider throws', async () => {
    const r = await resolveInterpretation(PROMPT, provider('ai-model', async () => {
      throw new Error('HTTP 429 quota exceeded');
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.generator).toMatchObject({ mode: 'deterministic-fallback', aiInference: false, providerId: 'test-model' });
    expect(r.generator.note).toContain('HTTP 429 quota exceeded');
    expect(r.warnings[0]).toMatch(/"test-model" failed/);
    expect(r.interpretation.warnings[0]).toBe(r.warnings[0]);
    expect(r.interpretation.requirements.some((x) => x.concept === 'castle' && x.source === 'lexicon')).toBe(true);
  });

  it('falls back explicitly when the provider output is invalid', async () => {
    const r = await resolveInterpretation(PROMPT, provider('ai-model', async () => ({ ...VALID, biome: 'lava', exec: 'rm -rf /' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.generator.mode).toBe('deterministic-fallback');
    expect(r.warnings[0]).toMatch(/invalid output/);
  });

  it('times out a provider that never answers and aborts its signal', async () => {
    let seen: AbortSignal | null = null;
    const p = provider('ai-model', (_req, signal) => {
      seen = signal;
      return new Promise(() => undefined);
    });
    const r = await resolveInterpretation(PROMPT, p, { timeoutMs: 20 });
    expect(r.ok && r.generator.mode).toBe('deterministic-fallback');
    expect(r.ok && r.warnings[0]).toMatch(/timed out after 20 ms/);
    expect(seen).not.toBeNull();
    expect(seen!.aborted).toBe(true);
  });

  it('returns ABORTED (no fallback) when the caller cancels', async () => {
    const before = new AbortController();
    before.abort();
    const p1 = provider('ai-model', async () => VALID);
    expect(await resolveInterpretation(PROMPT, p1, { signal: before.signal })).toMatchObject({ ok: false, code: 'ABORTED' });
    expect(p1.calls).toHaveLength(0);

    const during = new AbortController();
    const p2 = provider('ai-model', (_req, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const pending = resolveInterpretation(PROMPT, p2, { signal: during.signal });
    during.abort();
    expect(await pending).toMatchObject({ ok: false, code: 'ABORTED' });
  });

  it('truncates long provider error messages', async () => {
    const r = await resolveInterpretation(PROMPT, provider('ai-model', async () => {
      throw new Error(`boom ${'x'.repeat(5000)}`);
    }));
    expect(r.ok && r.warnings[0]!.length).toBeLessThan(400);
  });
});

describe('InterpretationRequest', () => {
  it('sends only the prompt, its language and the closed vocabularies', () => {
    const req = buildInterpretationRequest('قلعة');
    expect(Object.keys(req).sort()).toEqual(['allowed', 'language', 'prompt', 'schemaVersion']);
    expect(req.language).toBe('ar');
    expect(req.allowed.biomes).toEqual(BIOMES);
    expect(req.allowed.concepts).toContain('waterfall');
  });

  it('response schema mirrors the accepted vocabularies', () => {
    expect(INTERPRETATION_RESPONSE_SCHEMA.properties.biome.enum).toEqual([...BIOMES]);
    expect(INTERPRETATION_RESPONSE_SCHEMA.properties.requirements.items.properties.concept.enum).toEqual(buildInterpretationRequest('x').allowed.concepts);
  });
});

describe('generateWorld (async)', () => {
  it('validates the prompt before calling the provider', async () => {
    const p = provider('ai-model', async () => VALID);
    const r = await generateWorld({ prompt: '   ', provider: p });
    expect(r).toMatchObject({ ok: false, code: 'INVALID_PROMPT' });
    expect(p.calls).toHaveLength(0);
  });

  it('records provider-assisted generation on every candidate', async () => {
    const r = await generateWorld({ prompt: PROMPT, seed: 4, provider: provider('ai-model', async () => VALID) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const c of r.candidates) {
      expect(c.blueprint.identity.generator).toMatchObject({ mode: 'provider-assisted', aiInference: true });
      expect(c.blueprint.theme.biome).toBe('alpine');
      expect(c.report.valid).toBe(true);
    }
  });

  it('a failing provider still yields valid, honestly labelled candidates', async () => {
    const r = await generateWorld({ prompt: PROMPT, seed: 4, provider: provider('ai-model', async () => Promise.reject(new Error('offline'))) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.generator.aiInference).toBe(false);
    expect(r.warnings.some((w) => w.includes('offline'))).toBe(true);
    for (const c of r.candidates) expect(c.report.valid).toBe(true);
  });

  it('makes no network calls of its own', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await generateWorld({ prompt: PROMPT, seed: 4 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
