/**
 * Requirement expansion: turns an Interpretation into a PlanSpec, the list of
 * things a world must (and must not) contain, including implications such as
 * "a waterfall needs a river". Both planners read the same PlanSpec so they
 * answer the same brief. They differ in HOW they satisfy it, not in what.
 */
import { DEFAULT_HERO, LIMITS, STRUCTURE_CONCEPTS } from './catalog';
import type { Interpretation } from './interpret';
import type { BiomeId, ConceptId, PlanConstraint, Requirement, StructureKind } from './types';

export interface StructureOrder {
  readonly kind: StructureKind;
  readonly count: number;
  readonly requirementId: string | null;
}

export interface PlanSpec {
  readonly biome: BiomeId;
  readonly rivers: number;
  readonly waterfalls: number;
  readonly lakes: number;
  /** The world needs open sea (island or coast). */
  readonly sea: boolean;
  /** Some open water must exist (lighthouse). Satisfied by sea or lake. */
  readonly needsWater: boolean;
  readonly mountains: number;
  readonly hills: number;
  readonly valleys: number;
  readonly cliffs: number;
  readonly structures: readonly StructureOrder[];
  readonly settlements: number;
  readonly houses: number;
  readonly bridges: number;
  readonly roads: boolean;
  readonly forest: boolean;
  readonly trees: boolean;
  readonly flowers: boolean;
  readonly characters: number;
  readonly hero: StructureKind;
  readonly heroDefaulted: boolean;
  readonly heroRequirementId: string | null;
  readonly constraints: readonly PlanConstraint[];
  readonly conflicts: readonly string[];
}

const HERO_PRIORITY: readonly StructureKind[] = ['lighthouse', 'castle', 'temple', 'tower', 'windmill', 'ruins'];

export function expandRequirements(interp: Interpretation): PlanSpec {
  const wanted = new Map<ConceptId, Requirement>();
  const absent = new Set<ConceptId>();
  for (const r of interp.requirements) {
    if (r.negated) absent.add(r.concept);
    else wanted.set(r.concept, r);
  }
  const count = (c: ConceptId): number => wanted.get(c)?.count ?? 0;
  const has = (c: ConceptId): boolean => wanted.has(c);

  const constraints: PlanConstraint[] = [];
  const conflicts: string[] = [];
  const addConstraint = (kind: string, subject: string, detail: string, implied: boolean) =>
    constraints.push({ id: `c${constraints.length + 1}`, kind, subject, detail, implied });

  for (const r of interp.requirements) {
    if (r.negated) addConstraint('forbid', r.concept, `The prompt asks for no ${r.concept}.`, false);
    else addConstraint('require', r.concept, `The prompt asks for ${r.count} x ${r.concept}.`, false);
  }

  let rivers = Math.min(count('river'), LIMITS.rivers);
  let waterfalls = Math.min(count('waterfall'), 2);
  let lakes = Math.min(count('lake'), LIMITS.lakes);
  let sea = has('sea') || has('island') || interp.biome === 'coastal';
  let needsWater = false;
  const bridgesWanted = count('bridge');

  // Implications.
  if (has('lighthouse')) {
    needsWater = true;
    addConstraint('imply', 'lighthouse', 'A lighthouse must stand near open water.', true);
    if (absent.has('sea') && absent.has('lake') && !has('river')) conflicts.push('lighthouse needs water but sea and lake are both excluded');
  }
  if (waterfalls > 0) {
    if (absent.has('river')) {
      conflicts.push('waterfall requested but river is excluded; a waterfall needs a river');
      waterfalls = 0;
    } else if (rivers === 0) {
      rivers = 1;
      addConstraint('imply', 'waterfall', 'A waterfall needs a river to fall from.', true);
    }
    addConstraint('imply', 'waterfall', 'A waterfall needs a drop in the terrain (cliff or steep mountainside).', true);
  }
  if (bridgesWanted > 0) {
    if (absent.has('river') && lakes === 0) conflicts.push('bridge requested but there is no river or lake to cross');
    else if (rivers === 0 && lakes === 0) {
      rivers = 1;
      addConstraint('imply', 'bridge', 'A bridge needs something to cross; a river was added.', true);
    }
  }
  if (has('village') || has('house') || has('character')) {
    addConstraint('imply', 'settlement', 'Settlements prefer flat ground near water.', true);
  }
  if (has('castle')) addConstraint('imply', 'castle', 'A castle prefers high, level ground.', true);

  // Default river for worlds that would otherwise have no water feature at all.
  if (rivers === 0 && lakes === 0 && !sea && !needsWater && !absent.has('river') && interp.biome !== 'desert') {
    rivers = 1;
    addConstraint('default', 'river', 'The prompt named no water; one river is added so the world has a flow line.', true);
  }
  if (needsWater && !sea && lakes === 0 && !absent.has('sea')) {
    sea = true;
    addConstraint('imply', 'sea', 'Open sea satisfies the lighthouse water need.', true);
  }
  if (absent.has('sea')) sea = false;
  if (absent.has('river')) rivers = 0;
  if (absent.has('lake')) lakes = 0;

  // Structures.
  const structures: StructureOrder[] = [];
  for (const [concept, kind] of STRUCTURE_CONCEPTS) {
    if (absent.has(concept)) continue;
    const req = wanted.get(concept);
    if (req) structures.push({ kind, count: req.count, requirementId: req.id });
  }

  // Hero landmark.
  let hero: StructureKind | null = null;
  let heroRequirementId: string | null = null;
  for (const kind of HERO_PRIORITY) {
    const order = structures.find((s) => s.kind === kind);
    if (order) {
      hero = kind;
      heroRequirementId = order.requirementId;
      break;
    }
  }
  let heroDefaulted = false;
  if (!hero) {
    const fallback = DEFAULT_HERO[interp.biome];
    const fallbackConcept = STRUCTURE_CONCEPTS.find(([, k]) => k === fallback)?.[0];
    hero = fallbackConcept && absent.has(fallbackConcept) ? 'monument' : fallback;
    heroDefaulted = true;
    addConstraint('default', hero, 'The prompt named no landmark; a default hero landmark is chosen for the biome.', true);
  }

  const settlementWanted = has('village') && !absent.has('village');
  const houseCount = absent.has('house') ? 0 : Math.min(count('house'), LIMITS.housesPerSettlement);

  return {
    biome: interp.biome,
    rivers,
    waterfalls,
    lakes,
    sea,
    needsWater,
    mountains: absent.has('mountain') ? 0 : count('mountain'),
    hills: absent.has('hill') ? 0 : count('hill'),
    valleys: absent.has('valley') ? 0 : count('valley'),
    cliffs: Math.max(absent.has('cliff') ? 0 : count('cliff'), waterfalls > 0 ? 1 : 0),
    structures,
    settlements: settlementWanted ? Math.min(count('village'), 2) : houseCount > 0 || has('character') ? 1 : 0,
    houses: houseCount,
    bridges: bridgesWanted,
    roads: has('road') || bridgesWanted > 0 || has('village') || structures.length > 0 || has('house'),
    forest: has('forest'),
    trees: has('tree'),
    flowers: has('flowers'),
    characters: Math.min(count('character'), LIMITS.characters),
    hero,
    heroDefaulted,
    heroRequirementId,
    constraints,
    conflicts,
  };
}
