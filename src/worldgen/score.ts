/**
 * Explainable scoring and candidate comparison.
 *
 * Scores are a deterministic function of the ValidationReport, so the same
 * blueprint always gets the same score, and every point lost can be traced to
 * a diagnostic or a named composition metric.
 */
import { dist2, distToPolyline, xz } from './geometry';
import { riverXZ } from './terrain';
import { STRATEGIES, type StrategyId, type WorldBlueprint } from './types';
import { CATEGORIES, type CheckCategory, type ValidationReport } from './validate';

export const CATEGORY_WEIGHTS: Readonly<Record<CheckCategory, number>> = {
  integrity: 0.1,
  terrain: 0.12,
  water: 0.14,
  placement: 0.12,
  connectivity: 0.14,
  consistency: 0.08,
  requirements: 0.18,
  composition: 0.12,
};
export const ERROR_PENALTY = 35;
export const WARNING_PENALTY = 8;
/** Below this, two candidates are reported as near-duplicates. */
export const DIVERSITY_FLOOR = 0.15;

export interface CategoryScore {
  readonly category: CheckCategory;
  readonly score: number;
  readonly weight: number;
  readonly errors: number;
  readonly warnings: number;
  readonly summary: string;
}

export interface CandidateScore {
  readonly strategy: StrategyId;
  readonly valid: boolean;
  readonly total: number;
  readonly categories: readonly CategoryScore[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

export function scoreBlueprint(bp: WorldBlueprint, report: ValidationReport): CandidateScore {
  const categories = CATEGORIES.map((category): CategoryScore => {
    const diags = report.diagnostics.filter((d) => d.category === category);
    const errors = diags.filter((d) => d.severity === 'error').length;
    const warnings = diags.filter((d) => d.severity === 'warning').length;
    const penalty = errors * ERROR_PENALTY + warnings * WARNING_PENALTY;
    let score = clamp100(100 - penalty);
    let summary = errors + warnings === 0 ? 'No problems found.' : `${errors} error(s), ${warnings} warning(s).`;
    if (category === 'requirements') {
      const total = report.requirements.length;
      const ok = report.requirements.filter((r) => r.satisfied).length;
      score = total === 0 ? 100 : clamp100((ok / total) * 100);
      summary = total === 0 ? 'The prompt named no checkable elements.' : `${ok} of ${total} prompt requirements satisfied.`;
    }
    if (category === 'composition') {
      const m = report.metrics;
      const base = (m.heroInFrame ? 40 : 0) + m.thirds * 30 + m.layers * 15 + (m.sightlineClear ? 15 : 0);
      score = clamp100(base - errors * ERROR_PENALTY);
      summary = `Hero ${m.heroInFrame ? 'in frame' : 'not in frame'}, thirds ${m.thirds.toFixed(2)}, depth layers ${m.layers.toFixed(2)}, sightline ${m.sightlineClear ? 'clear' : 'blocked'}.`;
    }
    return { category, score: r1(score), weight: CATEGORY_WEIGHTS[category], errors, warnings, summary };
  });
  const total = r1(categories.reduce((sum, c) => sum + c.score * c.weight, 0));
  return { strategy: bp.identity.strategy, valid: report.valid, total, categories };
}

// ---------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------

export interface DiversityReport {
  readonly score: number;
  readonly heroShift: number;
  readonly riverShift: number;
  readonly terrainDifference: number;
  readonly topologyDifference: number;
  readonly nearDuplicate: boolean;
  readonly summary: string;
}

function jaccardDistance(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return 1 - both / (a.size + b.size - both);
}

function heroOf(bp: WorldBlueprint) {
  const id = bp.composition.focalPoints.find((f) => f.role === 'hero')?.targetId;
  return bp.structures.find((s) => s.id === id) ?? bp.structures.find((s) => s.isLandmark) ?? null;
}

/** Symmetric mean distance between two river sets, normalised by a quarter of the extent. */
function riverDistance(a: WorldBlueprint, b: WorldBlueprint): number {
  const ra = a.water.rivers;
  const rb = b.water.rivers;
  if (ra.length === 0 && rb.length === 0) return 0;
  if (ra.length === 0 || rb.length === 0) return 1;
  const oneWay = (x: WorldBlueprint, y: WorldBlueprint) => {
    const lines = y.water.rivers.map(riverXZ);
    const pts = x.water.rivers.flatMap((r) => r.points.map(xz));
    return pts.reduce((s, p) => s + Math.min(...lines.map((l) => distToPolyline(p, l))), 0) / Math.max(pts.length, 1);
  };
  return Math.min(1, (oneWay(a, b) + oneWay(b, a)) / 2 / (a.space.extent * 0.25));
}

function topologySignature(bp: WorldBlueprint): Set<string> {
  const kindOf = (id: string) =>
    bp.structures.find((s) => s.id === id)?.structureKind ?? (bp.settlements.some((s) => s.id === id) ? 'settlement' : bp.paths.some((p) => p.id === id) ? 'path' : 'other');
  return new Set([`basis:${bp.composition.basis}`, ...bp.paths.map((p) => `${p.pathKind}:${[kindOf(p.fromId), kindOf(p.toId)].sort().join('-')}`)]);
}

export function candidateDiversity(a: WorldBlueprint, b: WorldBlueprint): DiversityReport {
  const ha = heroOf(a);
  const hb = heroOf(b);
  const heroShift = ha && hb ? Math.min(1, dist2(xz(ha.transform.position), xz(hb.transform.position)) / (a.space.extent * 0.5)) : 1;
  const riverShift = riverDistance(a, b);
  const terrainDifference = jaccardDistance(new Set(a.terrain.regions.map((r) => r.regionKind)), new Set(b.terrain.regions.map((r) => r.regionKind)));
  const topologyDifference = jaccardDistance(topologySignature(a), topologySignature(b));
  const score = r1((0.35 * heroShift + 0.25 * riverShift + 0.2 * terrainDifference + 0.2 * topologyDifference) * 100) / 100;
  const nearDuplicate = score < DIVERSITY_FLOOR;
  const summary = nearDuplicate
    ? `The candidates are near-duplicates (diversity ${score.toFixed(2)} < ${DIVERSITY_FLOOR}).`
    : `Diversity ${score.toFixed(2)}: hero moved ${(heroShift * 100).toFixed(0)}%, rivers ${(riverShift * 100).toFixed(0)}%, terrain ${(terrainDifference * 100).toFixed(0)}%, network ${(topologyDifference * 100).toFixed(0)}%.`;
  return { score, heroShift: r1(heroShift * 100) / 100, riverShift: r1(riverShift * 100) / 100, terrainDifference: r1(terrainDifference * 100) / 100, topologyDifference: r1(topologyDifference * 100) / 100, nearDuplicate, summary };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface RankedCandidate {
  readonly blueprint: WorldBlueprint;
  readonly report: ValidationReport;
  readonly score: CandidateScore;
}

export interface Comparison {
  readonly preferred: StrategyId | null;
  readonly ranking: readonly { readonly strategy: StrategyId; readonly total: number; readonly valid: boolean }[];
  readonly reasons: readonly string[];
  readonly diversity: DiversityReport | null;
}

export function compareCandidates(candidates: readonly RankedCandidate[]): Comparison {
  if (candidates.length === 0) return { preferred: null, ranking: [], reasons: ['No candidates were produced.'], diversity: null };
  const order = [...candidates].sort(
    (a, b) =>
      Number(b.score.valid) - Number(a.score.valid) ||
      b.score.total - a.score.total ||
      STRATEGIES.indexOf(a.score.strategy) - STRATEGIES.indexOf(b.score.strategy),
  );
  const best = order[0] as RankedCandidate;
  const reasons: string[] = [];
  const runnerUp = order[1];
  if (!runnerUp) reasons.push(`${best.score.strategy} is the only candidate (total ${best.score.total}).`);
  else {
    if (best.score.valid && !runnerUp.score.valid) {
      const first = runnerUp.report.diagnostics.find((d) => d.severity === 'error');
      reasons.push(`${best.score.strategy} is preferred because ${runnerUp.score.strategy} has ${runnerUp.report.counts.error} error(s)${first ? `, e.g. ${first.code}: ${first.message}` : ''}.`);
    } else if (best.score.total === runnerUp.score.total) {
      reasons.push(`The candidates tie at ${best.score.total}; ${best.score.strategy} is listed first by strategy order.`);
    } else {
      reasons.push(`${best.score.strategy} is preferred: total ${best.score.total} vs ${runnerUp.score.total}.`);
    }
    const deltas = best.score.categories
      .map((c) => {
        const other = runnerUp.score.categories.find((x) => x.category === c.category);
        return { c, other, delta: other ? c.score - other.score : 0 };
      })
      .filter((d) => Math.abs(d.delta) >= 3)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    for (const d of deltas.slice(0, 4)) {
      const verb = d.delta > 0 ? 'better' : 'worse';
      reasons.push(`${d.c.category}: ${d.c.score} vs ${d.other?.score ?? 0} (${verb}). ${best.score.strategy}: ${d.c.summary} ${runnerUp.score.strategy}: ${d.other?.summary ?? ''}`.trim());
    }
    if (deltas.length === 0) reasons.push('No category differs by 3 points or more.');
  }
  const diversity = runnerUp ? candidateDiversity(best.blueprint, runnerUp.blueprint) : null;
  if (diversity) reasons.push(diversity.summary);
  return {
    preferred: best.score.strategy,
    ranking: order.map((c) => ({ strategy: c.score.strategy, total: c.score.total, valid: c.score.valid })),
    reasons,
    diversity,
  };
}
