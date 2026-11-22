/**
 * WorldGen entry points.
 *
 *   generateWorld(request)               async; may use an InterpretationProvider
 *   generateWorldDeterministic(request)  sync; keyword interpretation only
 *   planCandidate(...)                   one strategy, no validation
 *
 * Every candidate is validated and scored; the comparison explains which one
 * is preferred and why. A planner bug never crashes generation: it becomes a
 * reported CandidateFailure.
 */
import { hashString } from '../core/random';
import type { BuildContext } from './builder';
import { expandRequirements } from './constraints';
import { checkPrompt, interpretPrompt, type Interpretation } from './interpret';
import { normalizeText } from './lexicon';
import { planCompositionFirst } from './planners/compositionFirst';
import { planConstraintFirst } from './planners/constraintFirst';
import { deterministicGenerator, resolveInterpretation, type InterpretationProvider } from './provider';
import { compareCandidates, scoreBlueprint, type CandidateScore, type Comparison } from './score';
import { STRATEGIES, type GeneratorInfo, type StrategyId, type WorldBlueprint } from './types';
import { validateBlueprint, type ValidationReport } from './validate';

export const DEFAULT_EXTENT = 120;

export interface GenerateRequest {
  readonly prompt: unknown;
  /** Unsigned 32-bit integer. Defaults to a hash of the normalised prompt. */
  readonly seed?: number;
  readonly strategies?: readonly StrategyId[];
}

export interface AsyncGenerateRequest extends GenerateRequest {
  readonly provider?: InterpretationProvider | null;
  readonly signal?: AbortSignal;
  readonly providerTimeoutMs?: number;
}

export interface Candidate {
  readonly strategy: StrategyId;
  readonly blueprint: WorldBlueprint;
  readonly report: ValidationReport;
  readonly score: CandidateScore;
}

export interface CandidateFailure {
  readonly strategy: StrategyId;
  readonly error: string;
}

export type GenerateErrorCode = 'INVALID_PROMPT' | 'INVALID_SEED' | 'INVALID_STRATEGY' | 'ALL_CANDIDATES_FAILED' | 'ABORTED';

export type GenerateResult =
  | {
      readonly ok: true;
      readonly seed: number;
      readonly interpretation: Interpretation;
      readonly generator: GeneratorInfo;
      readonly candidates: readonly Candidate[];
      readonly failures: readonly CandidateFailure[];
      readonly comparison: Comparison;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly code: GenerateErrorCode; readonly message: string; readonly failures?: readonly CandidateFailure[] };

const PLANNERS: Readonly<Record<StrategyId, (ctx: BuildContext) => WorldBlueprint>> = {
  'constraint-first': planConstraintFirst,
  'composition-first': planCompositionFirst,
};

export function defaultSeed(prompt: string): number {
  return hashString(normalizeText(prompt.trim()));
}

/** Plans one candidate. Throws only on internal planner bugs (generate* catch those). */
export function planCandidate(prompt: string, interpretation: Interpretation, strategy: StrategyId, seed: number, generator: GeneratorInfo = deterministicGenerator()): WorldBlueprint {
  const spec = expandRequirements(interpretation);
  return PLANNERS[strategy]({ prompt, interp: interpretation, spec, seed, strategy, extent: DEFAULT_EXTENT, generator });
}

type Prepared = { ok: true; prompt: string; seed: number; strategies: readonly StrategyId[] } | Extract<GenerateResult, { ok: false }>;

function prepare(req: GenerateRequest): Prepared {
  const checked = checkPrompt(req.prompt);
  if (!checked.ok) return { ok: false, code: 'INVALID_PROMPT', message: checked.error };
  const seed = req.seed ?? defaultSeed(checked.prompt);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, code: 'INVALID_SEED', message: 'Seed must be an integer from 0 to 4294967295.' };
  }
  const strategies = req.strategies ?? STRATEGIES;
  if (strategies.length === 0 || strategies.some((s) => !STRATEGIES.includes(s)) || new Set(strategies).size !== strategies.length) {
    return { ok: false, code: 'INVALID_STRATEGY', message: `Strategies must be distinct values from: ${STRATEGIES.join(', ')}.` };
  }
  return { ok: true, prompt: checked.prompt, seed, strategies };
}

function run(prompt: string, seed: number, strategies: readonly StrategyId[], interpretation: Interpretation, generator: GeneratorInfo, extraWarnings: readonly string[]): GenerateResult {
  const candidates: Candidate[] = [];
  const failures: CandidateFailure[] = [];
  for (const strategy of strategies) {
    try {
      const blueprint = planCandidate(prompt, interpretation, strategy, seed, generator);
      const report = validateBlueprint(blueprint);
      candidates.push({ strategy, blueprint, report, score: scoreBlueprint(blueprint, report) });
    } catch (e) {
      failures.push({ strategy, error: e instanceof Error ? e.message.slice(0, 300) : 'unknown planner error' });
    }
  }
  if (candidates.length === 0) return { ok: false, code: 'ALL_CANDIDATES_FAILED', message: 'No strategy produced a blueprint.', failures };
  const warnings = [...new Set([...extraWarnings, ...interpretation.warnings, ...failures.map((f) => `Strategy ${f.strategy} failed: ${f.error}`)])];
  return { ok: true, seed, interpretation, generator, candidates, failures, comparison: compareCandidates(candidates), warnings };
}

/** Synchronous, provider-free generation. Always deterministic for the same prompt and seed. */
export function generateWorldDeterministic(req: GenerateRequest): GenerateResult {
  const p = prepare(req);
  if (!p.ok) return p;
  return run(p.prompt, p.seed, p.strategies, interpretPrompt(p.prompt), deterministicGenerator(), []);
}

/** Async generation with an optional interpretation provider and explicit fallback. */
export async function generateWorld(req: AsyncGenerateRequest): Promise<GenerateResult> {
  const p = prepare(req);
  if (!p.ok) return p;
  const resolved = await resolveInterpretation(p.prompt, req.provider ?? null, {
    ...(req.signal ? { signal: req.signal } : {}),
    ...(req.providerTimeoutMs !== undefined ? { timeoutMs: req.providerTimeoutMs } : {}),
  });
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };
  return run(p.prompt, p.seed, p.strategies, resolved.interpretation, resolved.generator, resolved.warnings);
}

/** The preferred candidate of a successful result. */
export function preferredCandidate(result: Extract<GenerateResult, { ok: true }>): Candidate {
  return result.candidates.find((c) => c.strategy === result.comparison.preferred) ?? (result.candidates[0] as Candidate);
}
