/**
 * Interpretation providers.
 *
 * A provider turns prompt text into an Interpretation (requirements, biome,
 * theme, time, weather). A future AI provider (for example Gemini through the
 * existing server-side proxy) implements `InterpretationProvider`. Its output
 * is UNTRUSTED and goes through `parseInterpretation` before use.
 *
 * Layout planning is always deterministic, whichever provider interprets.
 *
 * Nothing in this file makes network calls, reads credentials or claims AI
 * inference. When no provider is configured, or a provider fails, generation
 * uses the deterministic keyword interpreter and the result says so in
 * `GeneratorInfo` (mode 'deterministic-fallback', aiInference false).
 */
import { CONCEPT_IDS } from './conceptIds';
import { interpretPrompt, parseInterpretation, type Interpretation } from './interpret';
import { detectLanguage } from './lexicon';
import { BIOMES, THEMES, TIMES_OF_DAY, WEATHER_KINDS, type GeneratorInfo, type PromptLanguage } from './types';

export interface InterpretationRequest {
  readonly prompt: string;
  readonly language: PromptLanguage;
  readonly schemaVersion: 1;
  /** Closed vocabularies the provider must choose from. */
  readonly allowed: {
    readonly biomes: readonly string[];
    readonly themes: readonly string[];
    readonly timesOfDay: readonly string[];
    readonly weather: readonly string[];
    readonly concepts: readonly string[];
  };
}

export interface InterpretationProvider {
  /** Stable identifier recorded in provenance, e.g. "gemini-proxy". */
  readonly id: string;
  /** 'ai-model' only for providers that actually call a language model. */
  readonly kind: 'ai-model' | 'rule-based';
  readonly model?: string;
  /** Returns raw, untrusted output. Must honour `signal`. */
  interpret(request: InterpretationRequest, signal: AbortSignal): Promise<unknown>;
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export const DETERMINISTIC_NOTE =
  'Deterministic keyword interpretation (English and Arabic lexicon). This is not AI inference.';

export function deterministicGenerator(note: string = DETERMINISTIC_NOTE): GeneratorInfo {
  return { name: 'worldweaver-worldgen', version: 1, mode: 'deterministic-fallback', providerId: null, aiInference: false, note };
}

export function buildInterpretationRequest(prompt: string): InterpretationRequest {
  return {
    prompt,
    language: detectLanguage(prompt),
    schemaVersion: 1,
    allowed: { biomes: BIOMES, themes: THEMES, timesOfDay: TIMES_OF_DAY, weather: WEATHER_KINDS, concepts: CONCEPT_IDS },
  };
}

/**
 * JSON schema a model-backed provider should request as structured output.
 * It mirrors exactly what `parseInterpretation` accepts.
 */
export const INTERPRETATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', enum: ['en', 'ar', 'mixed', 'unknown'] },
    biome: { type: 'string', enum: [...BIOMES] },
    theme: { type: 'string', enum: [...THEMES] },
    timeOfDay: { type: 'string', enum: [...TIMES_OF_DAY] },
    weather: { type: 'string', enum: [...WEATHER_KINDS] },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concept: { type: 'string', enum: [...CONCEPT_IDS] },
          count: { type: 'integer' },
          negated: { type: 'boolean' },
          matchedText: { type: 'string' },
        },
        required: ['concept'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['language', 'biome', 'theme', 'timeOfDay', 'weather', 'requirements'],
} as const;

export type ResolveOutcome =
  | { readonly ok: true; readonly interpretation: Interpretation; readonly generator: GeneratorInfo; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: 'ABORTED'; readonly message: string };

const safeMessage = (e: unknown): string => {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown error';
  return text.replace(/\s+/g, ' ').slice(0, 200);
};

/**
 * Produces the Interpretation for a (pre-validated) prompt.
 * - no provider: deterministic keyword interpretation, labelled as such.
 * - provider succeeds with valid output: provider-assisted.
 * - provider throws, times out or returns invalid output: deterministic
 *   interpretation, with the reason recorded in the generator note and warnings.
 * - the caller's signal aborts: ABORTED (no fallback; the user cancelled).
 */
export async function resolveInterpretation(
  prompt: string,
  provider: InterpretationProvider | null | undefined,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ResolveOutcome> {
  if (options.signal?.aborted) return { ok: false, code: 'ABORTED', message: 'Generation was cancelled.' };
  if (!provider) {
    return {
      ok: true,
      interpretation: interpretPrompt(prompt),
      generator: deterministicGenerator(`No interpretation provider configured. ${DETERMINISTIC_NOTE}`),
      warnings: [],
    };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  let raw: unknown;
  let failure: string | null = null;
  try {
    raw = await Promise.race([provider.interpret(buildInterpretationRequest(prompt), controller.signal), timeout]);
  } catch (e) {
    failure = safeMessage(e);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  if (options.signal?.aborted) return { ok: false, code: 'ABORTED', message: 'Generation was cancelled.' };

  if (failure === null) {
    const parsed = parseInterpretation(raw);
    if (parsed.ok) {
      const interpretation: Interpretation = { ...parsed.value, language: detectLanguage(prompt) };
      const ai = provider.kind === 'ai-model';
      return {
        ok: true,
        interpretation,
        generator: {
          name: 'worldweaver-worldgen',
          version: 1,
          mode: 'provider-assisted',
          providerId: provider.id,
          aiInference: ai,
          note: `Prompt interpreted by ${provider.id}${provider.model ? ` (${provider.model})` : ''}${ai ? ', an AI model' : ', a rule-based provider'}. Layout is planned deterministically.`,
        },
        warnings: interpretation.warnings,
      };
    }
    failure = `invalid output: ${parsed.errors.slice(0, 3).join(' ')}`;
  }

  const warning = `Interpretation provider "${provider.id}" failed (${failure}); the deterministic keyword interpreter was used instead.`;
  const interpretation = interpretPrompt(prompt);
  return {
    ok: true,
    interpretation: { ...interpretation, warnings: [warning, ...interpretation.warnings] },
    generator: { ...deterministicGenerator(`${warning} ${DETERMINISTIC_NOTE}`), providerId: provider.id },
    warnings: [warning],
  };
}
