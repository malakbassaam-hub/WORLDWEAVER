/**
 * Deterministic WorldBlueprint validation.
 *
 * Every check is a pure function of the blueprint. Each problem is reported as
 * a Diagnostic with a stable code, a category, a severity and the element ids
 * involved, so the Studio can explain exactly why a candidate is weaker.
 * Validation never throws for a structurally valid blueprint (see serialize.ts
 * for structural parsing of untrusted input).
 */
import { FOREST_MIN_CLUSTERS, LIMITS, STRUCTURE_DEFS, materialFor, speciesById, weatherFitsBiome } from './catalog';
import { compositionMetrics, sightClear, type CompositionMetrics } from './composition';
import { MIN_FALL_DROP } from './builder';
import { DisjointSet, dist2, distToPolyline, isFiniteVec, polylineLength, segmentIntersection, xz } from './geometry';
import { distanceToWater, heightAt, insideLake, riverXZ, ringMeanHeight, slopeAt, WATER_EPS } from './terrain';
import {
  BLUEPRINT_SCHEMA,
  BLUEPRINT_VERSION,
  allElements,
  type BlueprintElement,
  type ConceptId,
  type Requirement,
  type Structure,
  type Vec2,
  type Vec3,
  type WorldBlueprint,
} from './types';

export type Severity = 'error' | 'warning' | 'info';
export type CheckCategory = 'integrity' | 'terrain' | 'water' | 'placement' | 'connectivity' | 'consistency' | 'requirements' | 'composition';
export const CATEGORIES: readonly CheckCategory[] = ['integrity', 'terrain', 'water', 'placement', 'connectivity', 'consistency', 'requirements', 'composition'];

export interface Diagnostic {
  readonly code: string;
  readonly category: CheckCategory;
  readonly severity: Severity;
  readonly message: string;
  readonly elementIds: readonly string[];
}

export interface RequirementResult {
  readonly requirementId: string;
  readonly concept: ConceptId;
  readonly negated: boolean;
  readonly requested: number;
  readonly found: number;
  readonly satisfied: boolean;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly requirements: readonly RequirementResult[];
  readonly metrics: CompositionMetrics;
  readonly counts: Readonly<Record<Severity, number>>;
}

const ID_PATTERN = /^wg:[a-z0-9][a-z0-9-]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** Maximum spacing between consecutive river points before the river is considered broken. */
export const RIVER_MAX_GAP = 12;
export const RIVER_DEEP_CUT = 8;
export const RIVER_MIN_LENGTH = 30;
export const PATH_MAX_GRADE = 0.6;

export function validateBlueprint(bp: WorldBlueprint): ValidationReport {
  const out: Diagnostic[] = [];
  const add = (category: CheckCategory, severity: Severity, code: string, message: string, elementIds: readonly string[] = []) =>
    out.push({ code, category, severity, message, elementIds });

  checkIntegrity(bp, add);
  checkTerrain(bp, add);
  checkWater(bp, add);
  checkPlacement(bp, add);
  checkConnectivity(bp, add);
  checkConsistency(bp, add);
  const requirements = checkRequirements(bp, add);
  const metrics = checkComposition(bp, add);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of out) counts[d.severity]++;
  return { valid: counts.error === 0, diagnostics: out, requirements, metrics, counts };
}

type Add = (category: CheckCategory, severity: Severity, code: string, message: string, elementIds?: readonly string[]) => void;

// ---------------------------------------------------------------------------
// Integrity: ids, references, transforms
// ---------------------------------------------------------------------------

function checkIntegrity(bp: WorldBlueprint, add: Add): void {
  if (bp.schema !== BLUEPRINT_SCHEMA || bp.version !== BLUEPRINT_VERSION) {
    add('integrity', 'error', 'VERSION', `Unsupported blueprint ${String(bp.schema)} v${String(bp.version)}.`);
  }
  const elements = allElements(bp);
  const ids = new Set<string>();
  for (const e of elements) {
    if (!ID_PATTERN.test(e.id)) add('integrity', 'error', 'ID_FORMAT', `Id "${e.id}" does not match ${ID_PATTERN}.`, [e.id]);
    if (ids.has(e.id)) add('integrity', 'error', 'ID_DUPLICATE', `Id "${e.id}" is used more than once.`, [e.id]);
    ids.add(e.id);
    if (e.name.trim().length === 0) add('integrity', 'error', 'NAME_EMPTY', `Element ${e.id} has an empty name.`, [e.id]);
    const t = e.transform;
    if (!isFiniteVec(t.position) || !isFiniteVec(t.rotation) || !isFiniteVec(t.scale) || t.scale.some((s) => s <= 0)) {
      add('integrity', 'error', 'TRANSFORM_INVALID', `Element ${e.id} has a non-finite transform or non-positive scale.`, [e.id]);
    } else if (Math.abs(t.position[0]) > bp.space.extent || Math.abs(t.position[2]) > bp.space.extent) {
      add('integrity', 'error', 'OUT_OF_BOUNDS', `Element ${e.id} lies outside the world extent ${bp.space.extent}.`, [e.id]);
    }
    if (e.provenance.strategy !== bp.identity.strategy) {
      add('integrity', 'error', 'PROVENANCE_STRATEGY', `Element ${e.id} claims strategy "${e.provenance.strategy}".`, [e.id]);
    }
  }
  const auxIds = [
    ...bp.composition.focalPoints.map((f) => f.id),
    ...bp.composition.cameraPaths.map((c) => c.id),
    ...bp.composition.sightlines.map((s) => s.id),
    ...bp.motion.map((m) => m.id),
    ...bp.atmosphere.lighting.accentLights.map((l) => l.id),
  ];
  const aux = new Set<string>();
  for (const id of auxIds) {
    if (aux.has(id)) add('integrity', 'error', 'ID_DUPLICATE', `Descriptor id "${id}" is used more than once.`, [id]);
    aux.add(id);
  }
  for (const line of [...bp.water.rivers, ...bp.paths]) {
    if (!line.points.every((p) => isFiniteVec(p))) add('integrity', 'error', 'POINTS_INVALID', `${line.id} has non-finite points.`, [line.id]);
  }

  const reqIds = new Set(bp.requirements.map((r) => r.id));
  const ref = (from: string, to: string | null, what: string) => {
    if (to !== null && !ids.has(to)) add('integrity', 'error', 'REF_MISSING', `${from}: ${what} "${to}" does not exist.`, [from]);
  };
  for (const e of elements) {
    for (const r of e.provenance.requirementIds) {
      if (!reqIds.has(r)) add('integrity', 'error', 'REF_MISSING', `${e.id}: requirement "${r}" does not exist.`, [e.id]);
    }
  }
  for (const r of bp.relations) {
    ref(`relation ${r.type}`, r.from, 'from');
    ref(`relation ${r.type}`, r.to, 'to');
  }
  for (const w of bp.water.waterfalls) ref(w.id, w.riverId, 'river');
  for (const r of bp.water.rivers) if (r.mouth.type === 'lake') ref(r.id, r.mouth.lakeId, 'mouth lake');
  for (const s of bp.structures) ref(s.id, s.settlementId, 'settlement');
  for (const s of bp.settlements) for (const id of s.structureIds) ref(s.id, id, 'structure');
  for (const p of bp.paths) {
    ref(p.id, p.fromId, 'from');
    ref(p.id, p.toId, 'to');
  }
  for (const b of bp.bridges) {
    ref(b.id, b.pathId, 'path');
    ref(b.id, b.overId, 'crossing');
  }
  for (const c of bp.characters) ref(c.id, c.homeId, 'home');
  for (const i of bp.interactables) ref(i.id, i.targetId, 'target');
  for (const f of bp.composition.focalPoints) ref(f.id, f.targetId, 'focal target');
  for (const s of bp.composition.sightlines) ref(s.id, s.toId, 'sightline target');
  for (const l of bp.atmosphere.lighting.accentLights) ref(l.id, l.attachedTo, 'light anchor');

  if (bp.structures.length > LIMITS.structures + 2) add('integrity', 'warning', 'BUDGET', `${bp.structures.length} structures exceed the budget of ${LIMITS.structures}.`);
  if (bp.vegetation.length > LIMITS.vegetation) add('integrity', 'warning', 'BUDGET', `${bp.vegetation.length} vegetation clusters exceed the budget of ${LIMITS.vegetation}.`);
}

// ---------------------------------------------------------------------------
// Terrain compatibility
// ---------------------------------------------------------------------------

function checkTerrain(bp: WorldBlueprint, add: Add): void {
  const { terrain } = bp;
  const lakes = bp.water.lakes;
  for (const s of bp.structures) {
    const [x, y, z] = s.transform.position;
    const ground = heightAt(terrain, x, z);
    if (ground < terrain.seaLevel + 0.5 || insideLake(lakes, x, z, s.footprintRadius * 0.5)) {
      add('terrain', 'error', 'STRUCTURE_UNDERWATER', `${s.name} (${s.id}) stands in water.`, [s.id]);
    }
    const def = STRUCTURE_DEFS[s.structureKind];
    const slope = slopeAt(terrain, x, z, Math.max(1, s.footprintRadius * 0.5));
    if (slope > def.slopeMax) add('terrain', 'error', 'STRUCTURE_SLOPE', `${s.name} sits on slope ${slope.toFixed(2)} (max ${def.slopeMax}).`, [s.id]);
    if (Math.abs(y - ground) > 0.5) add('terrain', 'error', 'STRUCTURE_FLOATING', `${s.name} is ${(y - ground).toFixed(2)} units off the ground.`, [s.id]);
  }
  if (terrain.islandRadius === null) {
    // Without a planned sea, the ground should not dip below sea level outside lakes.
    const n = 24;
    let wet = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = (-0.95 + (1.9 * i) / (n - 1)) * bp.space.extent;
        const z = (-0.95 + (1.9 * j) / (n - 1)) * bp.space.extent;
        if (heightAt(terrain, x, z) < terrain.seaLevel && !insideLake(lakes, x, z, 3)) wet++;
      }
    }
    if (wet > 0) add('terrain', 'warning', 'UNPLANNED_WATER', `${wet} of ${n * n} terrain samples fall below sea level although no sea was planned.`);
  }
  for (const v of bp.vegetation) {
    const sp = speciesById(v.speciesId);
    const [x, , z] = v.transform.position;
    const ground = heightAt(terrain, x, z);
    if (ground < terrain.seaLevel + 0.3 || insideLake(lakes, x, z, 0)) {
      add('terrain', 'error', 'VEGETATION_UNDERWATER', `${v.name} (${v.id}) is planted in water.`, [v.id]);
      continue;
    }
    if (!sp) continue;
    if (slopeAt(terrain, x, z, 2) > sp.slopeMax + 0.05) add('terrain', 'warning', 'VEGETATION_SLOPE', `${v.name} grows on ground steeper than ${sp.id} tolerates.`, [v.id]);
    if (ground - terrain.seaLevel > sp.maxAltitude) add('terrain', 'warning', 'VEGETATION_ALTITUDE', `${v.name} grows above the altitude ${sp.id} tolerates.`, [v.id]);
  }
}

// ---------------------------------------------------------------------------
// Water: rivers, waterfalls, lakes
// ---------------------------------------------------------------------------

function checkWater(bp: WorldBlueprint, add: Add): void {
  const { terrain } = bp;
  const lakes = bp.water.lakes;
  const E = bp.space.extent;
  for (const r of bp.water.rivers) {
    if (r.points.length < 3) {
      add('water', 'error', 'RIVER_TOO_SHORT', `${r.name} has fewer than 3 points.`, [r.id]);
      continue;
    }
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i] as Vec3;
      const b = r.points[i + 1] as Vec3;
      const gap = dist2(xz(a), xz(b));
      if (gap > RIVER_MAX_GAP) add('water', 'error', 'RIVER_GAP', `${r.name} has a ${gap.toFixed(1)}-unit gap between points ${i} and ${i + 1}.`, [r.id]);
      if (b[1] > a[1] + 1e-6) add('water', 'error', 'RIVER_UPHILL', `${r.name} flows uphill between points ${i} and ${i + 1}.`, [r.id]);
    }
    let deepest = 0;
    r.points.forEach((p, i) => {
      if (i === r.points.length - 1) return;
      const ground = heightAt(terrain, p[0], p[2]);
      const inWater = ground < terrain.seaLevel + WATER_EPS || insideLake(lakes, p[0], p[2], 0) !== null;
      if (!inWater && p[1] > ground + 0.05) add('water', 'error', 'RIVER_ABOVE_GROUND', `${r.name} floats ${(p[1] - ground).toFixed(2)} above the ground at point ${i}.`, [r.id]);
      deepest = Math.max(deepest, ground - p[1]);
      if (i > 0) {
        const lake = insideLake(lakes, p[0], p[2], 0);
        if (lake && !(r.mouth.type === 'lake' && r.mouth.lakeId === lake.id)) add('water', 'warning', 'RIVER_THROUGH_LAKE', `${r.name} passes through ${lake.name} without ending there.`, [r.id, lake.id]);
      }
    });
    const length = polylineLength(riverXZ(r));
    if (length < RIVER_MIN_LENGTH) add('water', 'warning', 'RIVER_SHORT', `${r.name} is only ${length.toFixed(0)} units long (a stub).`, [r.id]);
    if (deepest > RIVER_DEEP_CUT) add('water', 'warning', 'RIVER_DEEP_CUT', `${r.name} runs ${deepest.toFixed(1)} units below the ground (a gorge the terrain does not show).`, [r.id]);

    const last = r.points[r.points.length - 1] as Vec3;
    if (r.mouth.type === 'sea') {
      if (heightAt(terrain, last[0], last[2]) > terrain.seaLevel + 0.5 || Math.abs(last[1] - terrain.seaLevel) > 0.05) {
        add('water', 'error', 'RIVER_MOUTH', `${r.name} is said to reach the sea but its last point is not at sea level over water.`, [r.id]);
      }
    } else if (r.mouth.type === 'lake') {
      const lakeId = r.mouth.lakeId;
      const lake = lakes.find((l) => l.id === lakeId);
      if (lake && (dist2(xz(last), lake.center) > lake.radius + 1 || Math.abs(last[1] - lake.surfaceY) > 0.05)) {
        add('water', 'error', 'RIVER_MOUTH', `${r.name} is said to end in ${lake.name} but does not reach its surface.`, [r.id, lake.id]);
      }
    } else if (Math.abs(last[0]) < E * 0.8 && Math.abs(last[2]) < E * 0.8) {
      add('water', 'error', 'RIVER_MOUTH', `${r.name} ends inland with no lake or sea to drain into.`, [r.id]);
    }
    const line = riverXZ(r);
    for (const s of bp.structures) {
      if (distToPolyline(xz(s.transform.position), line) < r.width / 2 + s.footprintRadius) {
        add('water', 'error', 'RIVER_THROUGH_STRUCTURE', `${r.name} runs through ${s.name}.`, [r.id, s.id]);
      }
    }
  }

  for (const w of bp.water.waterfalls) {
    const r = bp.water.rivers.find((x) => x.id === w.riverId);
    if (!r) continue;
    const a = r.points[w.segmentIndex];
    const b = r.points[w.segmentIndex + 1];
    if (!a || !b) {
      add('water', 'error', 'WATERFALL_SEGMENT', `${w.name} points at a segment that does not exist.`, [w.id, r.id]);
      continue;
    }
    const drop = a[1] - b[1];
    if (Math.abs(drop - w.drop) > 0.01) add('water', 'error', 'WATERFALL_SEGMENT', `${w.name} claims a ${w.drop} drop; the river drops ${drop.toFixed(3)} there.`, [w.id]);
    if (drop < MIN_FALL_DROP) add('water', 'error', 'WATERFALL_NO_DROP', `${w.name} drops only ${drop.toFixed(2)} units (minimum ${MIN_FALL_DROP}).`, [w.id]);
  }

  lakes.forEach((lake, i) => {
    const ground = heightAt(terrain, lake.center[0], lake.center[1]);
    if (ground >= lake.surfaceY) add('water', 'error', 'LAKE_DRY', `${lake.name}: the lake bed is above the water surface.`, [lake.id]);
    let spill = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (heightAt(terrain, lake.center[0] + Math.cos(a) * lake.radius * 1.15, lake.center[1] + Math.sin(a) * lake.radius * 1.15) < lake.surfaceY - 0.2) spill++;
    }
    if (spill > 0) add('water', 'warning', 'LAKE_SPILL', `${lake.name}: the bank is lower than the water on ${spill} of 8 sides.`, [lake.id]);
    for (const other of lakes.slice(i + 1)) {
      if (dist2(lake.center, other.center) < lake.radius + other.radius) add('water', 'error', 'LAKE_OVERLAP', `${lake.name} overlaps ${other.name}.`, [lake.id, other.id]);
    }
  });
}

// ---------------------------------------------------------------------------
// Placement: collisions and siting rules
// ---------------------------------------------------------------------------

function checkPlacement(bp: WorldBlueprint, add: Add): void {
  const s = bp.structures;
  for (let i = 0; i < s.length; i++) {
    const a = s[i] as Structure;
    for (let j = i + 1; j < s.length; j++) {
      const b = s[j] as Structure;
      const d = dist2(xz(a.transform.position), xz(b.transform.position));
      if (d < a.footprintRadius + b.footprintRadius) add('placement', 'error', 'COLLISION', `${a.name} and ${b.name} overlap (${d.toFixed(1)} apart).`, [a.id, b.id]);
    }
    for (const lake of bp.water.lakes) {
      if (dist2(xz(a.transform.position), lake.center) < lake.radius + a.footprintRadius) add('placement', 'error', 'COLLISION_LAKE', `${a.name} overlaps ${lake.name}.`, [a.id, lake.id]);
    }
    const def = STRUCTURE_DEFS[a.structureKind];
    const [x, , z] = a.transform.position;
    if (def.maxWaterDistance !== null) {
      const d = distanceToWater(bp.terrain, bp.water.lakes, x, z, def.maxWaterDistance + 6, 2);
      if (d > def.maxWaterDistance) add('placement', 'error', 'LANDMARK_SITE', `${a.name} is ${Number.isFinite(d) ? d.toFixed(0) : 'far'} units from open water (max ${def.maxWaterDistance}).`, [a.id]);
    }
    if (def.need === 'high' && heightAt(bp.terrain, x, z) < ringMeanHeight(bp.terrain, x, z, 25) - 1) {
      add('placement', 'warning', 'LANDMARK_LOW', `${a.name} stands below its surroundings; it prefers high ground.`, [a.id]);
    }
  }
  for (const st of bp.settlements) {
    for (const id of st.structureIds) {
      const h = s.find((x) => x.id === id);
      if (!h) continue;
      if (h.settlementId !== st.id) add('placement', 'error', 'SETTLEMENT_MEMBERSHIP', `${h.name} is listed by ${st.name} but names another settlement.`, [h.id, st.id]);
      if (dist2(xz(h.transform.position), st.center) > st.radius * 1.6) add('placement', 'warning', 'SETTLEMENT_SPREAD', `${h.name} lies far outside ${st.name}.`, [h.id, st.id]);
    }
    if (st.structureIds.length === 0) add('placement', 'error', 'SETTLEMENT_EMPTY', `${st.name} has no buildings.`, [st.id]);
  }
  for (const c of bp.characters) {
    const [x, , z] = c.transform.position;
    if (heightAt(bp.terrain, x, z) < bp.terrain.seaLevel + 0.2 || insideLake(bp.water.lakes, x, z, 0)) {
      add('placement', 'error', 'CHARACTER_IN_WATER', `${c.name} stands in water.`, [c.id]);
    }
  }
}

// ---------------------------------------------------------------------------
// Connectivity: paths, bridges, reachability
// ---------------------------------------------------------------------------

function reach(bp: WorldBlueprint, id: string, p: Vec2): number {
  const s = bp.structures.find((x) => x.id === id);
  if (s) return dist2(p, xz(s.transform.position)) - (s.footprintRadius + 5);
  const st = bp.settlements.find((x) => x.id === id);
  if (st) return dist2(p, st.center) - (st.radius + 3);
  const path = bp.paths.find((x) => x.id === id);
  if (path) return distToPolyline(p, path.points.map(xz)) - 2;
  return Infinity;
}

function checkConnectivity(bp: WorldBlueprint, add: Add): void {
  const { terrain } = bp;
  const ds = new DisjointSet();
  for (const p of bp.paths) {
    const line = p.points.map(xz);
    if (line.length < 2) {
      add('connectivity', 'error', 'PATH_TOO_SHORT', `${p.name} has fewer than 2 points.`, [p.id]);
      continue;
    }
    if (reach(bp, p.fromId, line[0] as Vec2) > 0) add('connectivity', 'error', 'PATH_ENDPOINT', `${p.name} does not start at ${p.fromId}.`, [p.id, p.fromId]);
    if (reach(bp, p.toId, line[line.length - 1] as Vec2) > 0) add('connectivity', 'error', 'PATH_ENDPOINT', `${p.name} does not end at ${p.toId}.`, [p.id, p.toId]);
    ds.union(p.id, p.fromId);
    ds.union(p.id, p.toId);

    let wet = false;
    let steep = 0;
    for (let i = 0; i + 1 < line.length && !wet; i++) {
      const a = line[i] as Vec2;
      const b = line[i + 1] as Vec2;
      const steps = Math.max(1, Math.ceil(dist2(a, b) / 2));
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / steps;
        const z = a[1] + ((b[1] - a[1]) * k) / steps;
        if (heightAt(terrain, x, z) < terrain.seaLevel + WATER_EPS || insideLake(bp.water.lakes, x, z, 0)) {
          wet = true;
          break;
        }
      }
      const pa = p.points[i] as Vec3;
      const pb = p.points[i + 1] as Vec3;
      const run = dist2(a, b);
      if (run > 0) steep = Math.max(steep, Math.abs(pb[1] - pa[1]) / run);
    }
    if (wet) add('connectivity', 'error', 'PATH_IN_WATER', `${p.name} runs through open water.`, [p.id]);
    if (steep > PATH_MAX_GRADE) add('connectivity', 'warning', 'PATH_STEEP', `${p.name} has a ${(steep * 100).toFixed(0)}% grade.`, [p.id]);

    // Every river crossing needs a bridge belonging to this path.
    for (const r of bp.water.rivers) {
      const rl = riverXZ(r);
      for (let i = 0; i + 1 < line.length; i++) {
        for (let j = 0; j + 1 < rl.length; j++) {
          const hit = segmentIntersection(line[i] as Vec2, line[i + 1] as Vec2, rl[j] as Vec2, rl[j + 1] as Vec2);
          if (!hit) continue;
          const ok = bp.bridges.some((b) => b.pathId === p.id && b.overId === r.id && dist2(xz(b.transform.position), hit) <= r.width + 4);
          if (!ok) add('connectivity', 'error', 'PATH_RIVER_UNBRIDGED', `${p.name} crosses ${r.name} without a bridge.`, [p.id, r.id]);
        }
      }
    }
    for (const s of bp.structures) {
      if (s.id === p.fromId || s.id === p.toId || s.settlementId === p.fromId || s.settlementId === p.toId) continue;
      if (distToPolyline(xz(s.transform.position), line) < s.footprintRadius * 0.8) add('connectivity', 'warning', 'PATH_THROUGH_STRUCTURE', `${p.name} passes through ${s.name}.`, [p.id, s.id]);
    }
  }

  for (const b of bp.bridges) {
    const path = bp.paths.find((p) => p.id === b.pathId);
    const river = bp.water.rivers.find((r) => r.id === b.overId);
    const at = xz(b.transform.position);
    if (path && distToPolyline(at, path.points.map(xz)) > 1.5) add('connectivity', 'error', 'BRIDGE_OFF_PATH', `${b.name} is not on ${path.name}.`, [b.id, path.id]);
    if (river) {
      if (distToPolyline(at, riverXZ(river)) > river.width / 2 + 2) add('connectivity', 'error', 'BRIDGE_NOT_OVER_WATER', `${b.name} does not span ${river.name}.`, [b.id, river.id]);
      if (b.length < river.width + 1) add('connectivity', 'error', 'BRIDGE_TOO_SHORT', `${b.name} (${b.length}) is shorter than ${river.name} is wide.`, [b.id]);
      const surface = Math.max(...river.points.filter((p) => dist2(xz(p), at) < 8).map((p) => p[1]), -Infinity);
      if (Number.isFinite(surface) && b.deckY < surface + 0.3) add('connectivity', 'error', 'BRIDGE_UNDERWATER', `${b.name} deck is below the water.`, [b.id]);
    } else if (!bp.water.lakes.some((l) => l.id === b.overId)) {
      add('connectivity', 'error', 'BRIDGE_NOT_OVER_WATER', `${b.name} crosses nothing.`, [b.id]);
    }
  }

  const places = [
    ...bp.structures.filter((s) => s.settlementId === null).map((s) => s.id),
    ...bp.settlements.map((s) => s.id),
  ];
  if (places.length >= 2) {
    for (const id of places) ds.add(id);
    const groups = new Map<string, string[]>();
    for (const id of places) {
      const root = ds.find(id);
      groups.set(root, [...(groups.get(root) ?? []), id]);
    }
    if (groups.size > 1) {
      const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
      const stranded = sorted.slice(1).flat();
      add('connectivity', 'error', 'UNREACHABLE', `${stranded.length} place(s) cannot be reached from the main network: ${stranded.join(', ')}.`, stranded);
    }
  }
}

// ---------------------------------------------------------------------------
// Theme and biome consistency
// ---------------------------------------------------------------------------

function checkConsistency(bp: WorldBlueprint, add: Add): void {
  const biome = bp.theme.biome;
  for (const v of bp.vegetation) {
    const sp = speciesById(v.speciesId);
    if (!sp) add('consistency', 'error', 'SPECIES_UNKNOWN', `${v.name} uses unknown species "${v.speciesId}".`, [v.id]);
    else if (!sp.biomes.includes(biome)) add('consistency', 'error', 'SPECIES_BIOME', `${sp.id} does not grow in a ${biome} biome.`, [v.id]);
  }
  if (!weatherFitsBiome(bp.atmosphere.weather.kind, biome)) {
    add('consistency', 'warning', 'WEATHER_BIOME', `${bp.atmosphere.weather.kind} weather is unusual in a ${biome} biome.`);
  }
  for (const s of bp.structures) {
    if (s.material !== materialFor(biome)) add('consistency', 'warning', 'MATERIAL_BIOME', `${s.name} uses ${s.material}, not the ${biome} material.`, [s.id]);
  }
  if (bp.theme.palette.length === 0 || !bp.theme.palette.every((c) => HEX.test(c))) add('consistency', 'error', 'PALETTE', 'Palette must contain #rrggbb colours.');
  const l = bp.atmosphere.lighting;
  const nums = [l.sun.azimuthDeg, l.sun.elevationDeg, l.sun.intensity, l.ambient.intensity, l.fogDensity];
  if (!nums.every(Number.isFinite) || l.fogDensity < 0 || l.sun.intensity < 0 || !HEX.test(l.sun.color) || !HEX.test(l.ambient.color)) {
    add('consistency', 'error', 'LIGHTING', 'Lighting has invalid values.');
  }
  if (bp.atmosphere.timeOfDay === 'night' && l.sun.elevationDeg > 0) add('consistency', 'warning', 'LIGHTING_TIME', 'Night scene with the sun above the horizon.');
}

// ---------------------------------------------------------------------------
// Prompt requirements
// ---------------------------------------------------------------------------

export function countConcept(bp: WorldBlueprint, concept: ConceptId): number {
  const kinds = (k: string) => bp.structures.filter((s) => s.structureKind === k).length;
  const regions = (k: string) => bp.terrain.regions.filter((r) => r.regionKind === k).length;
  const veg = (k: string) => bp.vegetation.filter((v) => v.vegetationKind === k).length;
  switch (concept) {
    case 'river':
      return bp.water.rivers.length;
    case 'waterfall':
      return bp.water.waterfalls.length;
    case 'lake':
      return bp.water.lakes.length;
    case 'sea':
    case 'island':
      return bp.terrain.islandRadius !== null ? 1 : 0;
    case 'mountain':
    case 'hill':
    case 'valley':
    case 'cliff':
      return regions(concept);
    case 'lighthouse':
    case 'castle':
    case 'tower':
    case 'temple':
    case 'house':
    case 'ruins':
    case 'windmill':
      return kinds(concept);
    case 'village':
      return bp.settlements.length;
    case 'bridge':
      return bp.bridges.length;
    case 'road':
      return bp.paths.length;
    case 'forest':
    case 'tree':
      return veg('tree');
    case 'flowers':
      return veg('flower');
    case 'character':
      return bp.characters.length;
    case 'temperate':
    case 'desert':
    case 'arctic':
    case 'tropical':
    case 'alpine':
    case 'coastal':
      return bp.theme.biome === concept ? 1 : 0;
    case 'serene':
    case 'mystic':
    case 'ominous':
    case 'ancient':
    case 'vibrant':
      return bp.theme.theme === concept ? 1 : 0;
    case 'dawn':
    case 'day':
    case 'sunset':
    case 'night':
      return bp.atmosphere.timeOfDay === concept ? 1 : 0;
    case 'fog':
    case 'rain':
    case 'snow':
    case 'storm':
      return bp.atmosphere.weather.kind === concept ? 1 : 0;
    default: {
      const unknown: never = concept;
      return unknown;
    }
  }
}

function needed(r: Requirement): number {
  return r.concept === 'forest' ? FOREST_MIN_CLUSTERS : r.count;
}

function checkRequirements(bp: WorldBlueprint, add: Add): RequirementResult[] {
  return bp.requirements.map((r) => {
    const found = countConcept(bp, r.concept);
    const requested = r.negated ? 0 : needed(r);
    const satisfied = r.negated ? found === 0 : found >= requested;
    if (!satisfied) {
      if (r.negated) add('requirements', 'error', 'REQUIREMENT_FORBIDDEN', `The prompt excluded ${r.concept}, but the world has ${found}.`);
      else if (found === 0) add('requirements', 'error', 'REQUIREMENT_MISSING', `The prompt asked for ${r.concept} ("${r.matchedText}"), but the world has none.`);
      else add('requirements', 'warning', 'REQUIREMENT_PARTIAL', `The prompt asked for ${requested} ${r.concept}; the world has ${found}.`);
    }
    return { requirementId: r.id, concept: r.concept, negated: r.negated, requested, found, satisfied };
  });
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function checkComposition(bp: WorldBlueprint, add: Add): CompositionMetrics {
  const comp = bp.composition;
  const hero = comp.focalPoints.find((f) => f.role === 'hero');
  const heroStructure = hero ? bp.structures.find((s) => s.id === hero.targetId) : undefined;
  if (!hero || !heroStructure) add('composition', 'error', 'NO_HERO', 'The world has no hero focal point on a structure.');
  if (comp.cameraPaths.length === 0 || comp.cameraPaths.some((c) => c.keyframes.length === 0)) add('composition', 'error', 'NO_CAMERA', 'The world has no usable camera path.');
  for (const cam of comp.cameraPaths) {
    let prevT = -Infinity;
    for (const k of cam.keyframes) {
      if (!isFiniteVec(k.position) || !isFiniteVec(k.lookAt) || !Number.isFinite(k.t) || k.fovDeg <= 10 || k.fovDeg >= 120 || k.t < prevT) {
        add('composition', 'error', 'CAMERA_INVALID', `Camera path ${cam.id} has an invalid keyframe.`);
        break;
      }
      prevT = k.t;
    }
  }
  for (const f of comp.focalPoints) {
    if (!(f.weight >= 0 && f.weight <= 1)) add('composition', 'error', 'FOCAL_WEIGHT', `Focal point ${f.id} weight must be within 0..1.`);
  }
  const metrics = compositionMetrics(bp);
  if (heroStructure && comp.cameraPaths.length > 0) {
    if (!metrics.heroInFrame) add('composition', 'warning', 'HERO_OUT_OF_FRAME', `${heroStructure.name} is not inside the opening camera frame.`, [heroStructure.id]);
    if (!metrics.sightlineClear) {
      const key = comp.cameraPaths[0]?.keyframes[0];
      const blocked = key
        ? sightClear(bp.terrain, bp.structures, key.position, [heroStructure.transform.position[0], heroStructure.transform.position[1] + heroStructure.height * 0.6, heroStructure.transform.position[2]], [heroStructure.id]).blockedBy
        : null;
      add('composition', 'warning', 'SIGHTLINE_BLOCKED', `The view of ${heroStructure.name} is blocked by ${blocked ?? 'something'}.`, [heroStructure.id]);
    }
  }
  return metrics;
}

/** Elements whose id is listed in a diagnostic, for UI highlighting. */
export function elementsInDiagnostics(bp: WorldBlueprint, diagnostics: readonly Diagnostic[]): BlueprintElement[] {
  const ids = new Set(diagnostics.flatMap((d) => d.elementIds));
  return allElements(bp).filter((e) => ids.has(e.id));
}
