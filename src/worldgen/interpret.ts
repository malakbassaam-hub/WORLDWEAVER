/**
 * Prompt interpretation: natural-language text -> structured Interpretation.
 *
 * `interpretPrompt` is the deterministic keyword fallback (English and Arabic).
 * `parseInterpretation` strictly validates an interpretation produced by an
 * external provider; provider output is untrusted data.
 */
import {
  LEXICON_BY_ID,
  TERM_INDEX,
  candidateForms,
  detectLanguage,
  isNegator,
  normalizeText,
  parseCountToken,
  tokenize,
} from './lexicon';
import {
  BIOMES,
  THEMES,
  TIMES_OF_DAY,
  WEATHER_KINDS,
  type BiomeId,
  type ConceptId,
  type PromptLanguage,
  type Requirement,
  type ThemeId,
  type TimeOfDay,
  type WeatherKind,
} from './types';

export const PROMPT_MAX_LENGTH = 2000;

export interface Interpretation {
  readonly language: PromptLanguage;
  readonly requirements: readonly Requirement[];
  readonly biome: BiomeId;
  readonly theme: ThemeId;
  readonly timeOfDay: TimeOfDay;
  readonly weather: WeatherKind;
  /** Plain-English notes about defaults and conflicts. Never silent. */
  readonly warnings: readonly string[];
  /** Which defaults were applied because the prompt did not say. */
  readonly defaulted: readonly ('biome' | 'theme' | 'timeOfDay' | 'weather')[];
}

export type PromptCheck = { readonly ok: true; readonly prompt: string } | { readonly ok: false; readonly error: string };

/** Trust-boundary check for the raw prompt. */
export function checkPrompt(value: unknown): PromptCheck {
  if (typeof value !== 'string') return { ok: false, error: 'Prompt must be text.' };
  const prompt = value.trim();
  if (prompt.length === 0) return { ok: false, error: 'Prompt must not be empty.' };
  if (prompt.length > PROMPT_MAX_LENGTH) return { ok: false, error: `Prompt must be at most ${PROMPT_MAX_LENGTH} characters.` };
  // Control characters other than whitespace are never legitimate prompt text.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(prompt)) {
    return { ok: false, error: 'Prompt contains control characters.' };
  }
  return { ok: true, prompt };
}

interface Mention {
  concept: ConceptId;
  count: number;
  negated: boolean;
  text: string;
  index: number;
}

const BIOME_FROM_FEATURE: readonly (readonly [ConceptId, BiomeId])[] = [
  ['lighthouse', 'coastal'],
  ['sea', 'coastal'],
  ['island', 'coastal'],
  ['mountain', 'alpine'],
  ['waterfall', 'temperate'],
];

function findMentions(prompt: string): Mention[] {
  const tokens = tokenize(normalizeText(prompt));
  const mentions: Mention[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    let entry = undefined as ReturnType<typeof TERM_INDEX.get>;
    for (const form of candidateForms(token)) {
      entry = TERM_INDEX.get(form);
      if (entry) break;
    }
    if (!entry) continue;

    // Look at the two preceding tokens for a negator ("without a river") and a
    // number ("three tall towers"). Both are always examined.
    let negated = false;
    let count: number | null = null;
    for (let back = 1; back <= 2 && i - back >= 0; back++) {
      const prev = tokens[i - back] as string;
      if (isNegator(prev)) negated = true;
      const n = parseCountToken(prev);
      if (n !== null && count === null) count = n;
    }
    const bounded = Math.min(Math.max(count ?? 1, 1), entry.maxCount);
    mentions.push({ concept: entry.id, count: bounded, negated, text: token, index: i });
  }
  return mentions;
}

function pickFirst<T extends string>(mentions: readonly Mention[], allowed: readonly T[]): { value: T | null; all: T[] } {
  const found: T[] = [];
  for (const m of mentions) {
    if (m.negated) continue;
    if ((allowed as readonly string[]).includes(m.concept) && !found.includes(m.concept as T)) found.push(m.concept as T);
  }
  return { value: found[0] ?? null, all: found };
}

/** Deterministic keyword interpretation. Never throws for valid prompt text. */
export function interpretPrompt(prompt: string): Interpretation {
  const mentions = findMentions(prompt);
  const warnings: string[] = [];
  const defaulted: Array<'biome' | 'theme' | 'timeOfDay' | 'weather'> = [];

  // Merge repeated mentions: the later mention wins, and a flip is reported.
  const merged = new Map<ConceptId, Mention>();
  for (const m of mentions) {
    const prior = merged.get(m.concept);
    if (prior && prior.negated !== m.negated) {
      warnings.push(`Conflicting mentions of "${m.concept}"; the later one ("${m.negated ? 'absent' : 'present'}") was used.`);
    }
    if (prior && prior.negated === m.negated && !m.negated) {
      merged.set(m.concept, { ...m, count: Math.max(prior.count, m.count) });
    } else {
      merged.set(m.concept, m);
    }
  }

  const requirements: Requirement[] = [];
  for (const m of merged.values()) {
    const entry = LEXICON_BY_ID.get(m.concept);
    if (!entry || entry.kind !== 'feature') continue;
    requirements.push({
      id: `req-${m.concept}`,
      concept: m.concept,
      count: m.negated ? 0 : m.count,
      negated: m.negated,
      matchedText: m.text,
      source: 'lexicon',
    });
  }

  const biomePick = pickFirst<BiomeId>(mentions, BIOMES);
  let biome: BiomeId;
  if (biomePick.value) {
    biome = biomePick.value;
    if (biomePick.all.length > 1) {
      warnings.push(`Conflicting biomes (${biomePick.all.join(', ')}); the first ("${biome}") was used.`);
    }
  } else {
    const inferred = BIOME_FROM_FEATURE.find(([concept]) =>
      requirements.some((r) => r.concept === concept && !r.negated),
    );
    biome = inferred ? inferred[1] : 'temperate';
    if (!inferred) {
      defaulted.push('biome');
      warnings.push('No biome was recognised; "temperate" was used as a default.');
    }
  }

  const themePick = pickFirst<ThemeId>(mentions, THEMES);
  let theme: ThemeId;
  if (themePick.value) theme = themePick.value;
  else {
    theme = 'serene';
    defaulted.push('theme');
  }

  const timePick = pickFirst<TimeOfDay>(mentions, TIMES_OF_DAY);
  let timeOfDay: TimeOfDay;
  if (timePick.value) {
    timeOfDay = timePick.value;
    if (timePick.all.length > 1) warnings.push(`Several times of day (${timePick.all.join(', ')}); the first ("${timeOfDay}") was used.`);
  } else {
    timeOfDay = 'day';
    defaulted.push('timeOfDay');
  }

  // Weather priority: the most dramatic mentioned condition wins.
  const weatherPick = pickFirst<WeatherKind>(mentions, WEATHER_KINDS);
  let weather: WeatherKind = 'clear';
  if (weatherPick.all.length > 0) {
    for (const kind of ['storm', 'snow', 'rain', 'fog'] as const) {
      if (weatherPick.all.includes(kind)) {
        weather = kind;
        break;
      }
    }
  } else {
    defaulted.push('weather');
  }

  if (requirements.length === 0) {
    warnings.push('No world features were recognised in the prompt; the planner will use its defaults.');
  }

  return withFacetRequirements({
    language: detectLanguage(prompt),
    requirements,
    biome,
    theme,
    timeOfDay,
    weather,
    warnings,
    defaulted,
  });
}

/**
 * Adds one requirement per explicit facet (biome, theme, time, weather) so the
 * validator can check that the blueprint honours them. Defaulted facets are not
 * requirements, because the prompt did not ask for them.
 */
export function withFacetRequirements(interp: Interpretation): Interpretation {
  const have = new Set(interp.requirements.map((r) => r.concept));
  const extra: Requirement[] = [];
  const add = (concept: ConceptId, matchedText: string) => {
    if (have.has(concept)) return;
    have.add(concept);
    extra.push({ id: `req-${concept}`, concept, count: 1, negated: false, matchedText, source: 'implied' });
  };
  const explicit = (facet: 'biome' | 'theme' | 'timeOfDay' | 'weather') => !interp.defaulted.includes(facet);
  if (explicit('biome')) add(interp.biome, 'biome');
  if (explicit('theme')) add(interp.theme, 'theme');
  if (explicit('timeOfDay')) add(interp.timeOfDay, 'timeOfDay');
  if (explicit('weather') && interp.weather !== 'clear') add(interp.weather as ConceptId, 'weather');
  return extra.length === 0 ? interp : { ...interp, requirements: [...interp.requirements, ...extra] };
}

// --------------------------------------------------------------------------
// Strict validation of provider output
// --------------------------------------------------------------------------

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

const FEATURE_IDS = new Set<string>([...LEXICON_BY_ID.values()].filter((x) => x.kind === 'feature').map((x) => x.id));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Validates an unknown value as an Interpretation. Unknown fields are rejected,
 * enums are closed, strings are bounded. A provider can only choose among
 * values the planners already understand.
 */
export function parseInterpretation(value: unknown): ParseResult<Interpretation> {
  const errors: string[] = [];
  if (!isObj(value)) return { ok: false, errors: ['Interpretation must be an object.'] };
  const allowed = new Set(['language', 'requirements', 'biome', 'theme', 'timeOfDay', 'weather', 'warnings', 'defaulted']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`Unknown field "${key}".`);

  if (!oneOf(value.language, ['en', 'ar', 'mixed', 'unknown'] as const)) errors.push('language is invalid.');
  if (!oneOf(value.biome, BIOMES)) errors.push('biome is invalid.');
  if (!oneOf(value.theme, THEMES)) errors.push('theme is invalid.');
  if (!oneOf(value.timeOfDay, TIMES_OF_DAY)) errors.push('timeOfDay is invalid.');
  if (!oneOf(value.weather, WEATHER_KINDS)) errors.push('weather is invalid.');

  const requirements: Requirement[] = [];
  if (!Array.isArray(value.requirements)) errors.push('requirements must be a list.');
  else if (value.requirements.length > 40) errors.push('requirements has more than 40 items.');
  else {
    const seen = new Set<string>();
    value.requirements.forEach((raw: unknown, i: number) => {
      if (!isObj(raw)) {
        errors.push(`requirements[${i}] must be an object.`);
        return;
      }
      const concept = raw.concept;
      if (typeof concept !== 'string' || !FEATURE_IDS.has(concept)) {
        errors.push(`requirements[${i}].concept is invalid.`);
        return;
      }
      if (seen.has(concept)) {
        errors.push(`requirements[${i}] repeats concept "${concept}".`);
        return;
      }
      seen.add(concept);
      const negated = raw.negated === true;
      if (raw.negated !== undefined && typeof raw.negated !== 'boolean') errors.push(`requirements[${i}].negated must be true or false.`);
      const max = LEXICON_BY_ID.get(concept as ConceptId)?.maxCount ?? 1;
      const count = raw.count === undefined ? 1 : raw.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > max) {
        errors.push(`requirements[${i}].count must be an integer from 0 to ${max}.`);
        return;
      }
      const matched = typeof raw.matchedText === 'string' ? raw.matchedText.slice(0, 80) : '';
      requirements.push({
        id: `req-${concept}`,
        concept: concept as ConceptId,
        count: negated ? 0 : Math.max(count, 1),
        negated,
        matchedText: matched,
        source: 'provider',
      });
    });
  }

  const warnings: string[] = [];
  if (value.warnings !== undefined) {
    if (!Array.isArray(value.warnings) || value.warnings.length > 20 || !value.warnings.every((w: unknown) => typeof w === 'string' && w.length <= 300)) {
      errors.push('warnings must be a list of at most 20 short strings.');
    } else warnings.push(...(value.warnings as string[]));
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: withFacetRequirements({
      language: value.language as PromptLanguage,
      requirements,
      biome: value.biome as BiomeId,
      theme: value.theme as ThemeId,
      timeOfDay: value.timeOfDay as TimeOfDay,
      weather: value.weather as WeatherKind,
      warnings,
      defaulted: [],
    }),
  };
}
