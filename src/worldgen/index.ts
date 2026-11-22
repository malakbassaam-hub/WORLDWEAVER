/**
 * WorldGen public API. Studio and renderer code should import from here only.
 * See docs/worldgen/WORLDGEN_API.md.
 */
export * from './types';
export { generateWorld, generateWorldDeterministic, planCandidate, preferredCandidate, defaultSeed, DEFAULT_EXTENT } from './generate';
export type { AsyncGenerateRequest, Candidate, CandidateFailure, GenerateErrorCode, GenerateRequest, GenerateResult } from './generate';
export { checkPrompt, interpretPrompt, parseInterpretation, PROMPT_MAX_LENGTH } from './interpret';
export type { Interpretation } from './interpret';
export { expandRequirements } from './constraints';
export type { PlanSpec } from './constraints';
export { validateBlueprint, countConcept, CATEGORIES } from './validate';
export type { CheckCategory, Diagnostic, RequirementResult, Severity, ValidationReport } from './validate';
export { scoreBlueprint, compareCandidates, candidateDiversity, CATEGORY_WEIGHTS } from './score';
export type { CandidateScore, CategoryScore, Comparison, DiversityReport } from './score';
export { compositionMetrics, projectToScreen } from './composition';
export type { CompositionMetrics } from './composition';
export {
  resolveInterpretation,
  buildInterpretationRequest,
  deterministicGenerator,
  INTERPRETATION_RESPONSE_SCHEMA,
  DETERMINISTIC_NOTE,
  DEFAULT_PROVIDER_TIMEOUT_MS,
} from './provider';
export type { InterpretationProvider, InterpretationRequest, ResolveOutcome } from './provider';
export { serializeBlueprint, parseBlueprint, blueprintFingerprint, checkBlueprintShape, isWellFormedBlueprint, upgradeBlueprint, MAX_BLUEPRINT_BYTES } from './serialize';
export type { BlueprintParse, SerializeResult } from './serialize';
export { blueprintToEvents, blueprintToWorld, sampleHeightfield } from './adapter';
export type { AdapterOptions, AdaptResult, ArchetypeMode, Heightfield } from './adapter';
export { heightAt, slopeAt, riverXZ } from './terrain';
