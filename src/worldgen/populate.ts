/**
 * Shared population primitives: settlements, vegetation clusters, characters.
 * Strategies choose WHERE to call these and with what anchors; the ecological
 * and siting rules applied here are the same ones the validator re-checks.
 */
import type { Rng } from '../core/random';
import type { BlueprintBuilder } from './builder';
import { LIMITS, STRUCTURE_DEFS, speciesForBiome, type SpeciesDef } from './catalog';
import { dist2, distToPolyline, round3 } from './geometry';
import { Occupancy, meanSlope, siteOk, type World2D } from './placement';
import { bestRoute, findRiverCrossings, obstaclesFor, routeQuality } from './routing';
import { distanceToWater, heightAt, insideLake, riverXZ, slopeAt } from './terrain';
import type { Settlement, Structure, Vec2, VegetationCluster } from './types';

const world2d = (b: BlueprintBuilder) => ({ terrain: b.terrainView, lakes: b.lakes, rivers: b.rivers, extent: b.ctx.extent });

/** Is open ground (not sea, lake or river) at p? */
export function isDry(b: BlueprintBuilder, p: Vec2, margin = 0.5): boolean {
  if (heightAt(b.terrain, p[0], p[1]) < b.terrain.seaLevel + 0.3) return false;
  if (insideLake(b.lakes, p[0], p[1], margin)) return false;
  for (const r of b.rivers) if (distToPolyline(p, riverXZ(r)) < r.width / 2 + margin) return false;
  return true;
}

/** Ring of houses around `center`. Returns null when not even one house fits. */
export function placeSettlement(
  b: BlueprintBuilder,
  rng: Rng,
  occ: Occupancy,
  center: Vec2,
  houses: number,
  requirementIds: readonly string[],
  rationale: string,
): Settlement | null {
  const def = STRUCTURE_DEFS.house;
  const radius = 7 + houses * 1.4;
  const settlementId = b.newId('settlement');
  const placed: string[] = [];
  const base = rng.range(0, Math.PI * 2);
  for (let i = 0; i < houses; i++) {
    let done = false;
    for (let attempt = 0; attempt < 14 && !done; attempt++) {
      const a = base + (i / houses) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const r = radius * rng.range(0.45, 0.95) + attempt * 0.6;
      const p: Vec2 = [round3(center[0] + Math.cos(a) * r), round3(center[1] + Math.sin(a) * r)];
      if (!siteOk(world2d(b), p, def, occ, 1)) continue;
      const house = b.addStructure({
        kind: 'house',
        at: p,
        yaw: a + Math.PI,
        settlementId,
        requirementIds,
        rationale: 'House placed on flat, dry ground inside its settlement ring.',
      });
      occ.add({ id: house.id, center: p, radius: def.footprint });
      placed.push(house.id);
      done = true;
    }
  }
  if (placed.length === 0) return null;
  return b.addSettlement({ id: settlementId, center, radius, structureIds: placed, requirementIds, rationale });
}

/** How suitable is `p` for a settlement: dry, flat, close to water. Higher is better. */
export function settlementScore(b: BlueprintBuilder, p: Vec2): number {
  if (!isDry(b, p, 3)) return -1;
  const slope = meanSlope(b.terrainView, p, 9);
  if (slope > 0.3) return -1;
  const water = distanceToWater(b.terrainView, b.lakes, p[0], p[1], 60, 3);
  const nearRiver = b.rivers.length ? Math.min(...b.rivers.map((r) => distToPolyline(p, riverXZ(r)))) : Infinity;
  const d = Math.min(water, nearRiver);
  return (1 - slope / 0.3) * 0.5 + (Number.isFinite(d) ? Math.max(0, 1 - d / 45) : 0) * 0.5;
}

export function speciesFitsAt(b: BlueprintBuilder, sp: SpeciesDef, p: Vec2): boolean {
  const h = heightAt(b.terrain, p[0], p[1]);
  if (h < b.terrain.seaLevel + 0.5 || h - b.terrain.seaLevel > sp.maxAltitude) return false;
  if (slopeAt(b.terrain, p[0], p[1], 2) > sp.slopeMax) return false;
  if (sp.waterWithin !== null && distanceToWater(b.terrainView, b.lakes, p[0], p[1], sp.waterWithin + 2, 2) > sp.waterWithin) {
    const nearRiver = b.rivers.length ? Math.min(...b.rivers.map((r) => distToPolyline(p, riverXZ(r)))) : Infinity;
    if (nearRiver > sp.waterWithin) return false;
  }
  return true;
}

/**
 * Plants one cluster if the ground suits the species and nothing is in the way.
 * `keepClear` lets a strategy veto locations (for example a camera sightline).
 */
export function tryPlant(
  b: BlueprintBuilder,
  occ: Occupancy,
  sp: SpeciesDef,
  center: Vec2,
  radius: number,
  requirementIds: readonly string[],
  rationale: string,
  keepClear?: (p: Vec2, r: number) => boolean,
): VegetationCluster | null {
  if (b.vegetation.length >= LIMITS.vegetation) return null;
  if (Math.abs(center[0]) > b.ctx.extent * 0.92 || Math.abs(center[1]) > b.ctx.extent * 0.92) return null;
  if (!sp.biomes.includes(b.ctx.interp.biome)) return null;
  if (!speciesFitsAt(b, sp, center)) return null;
  const ring: Vec2[] = [center];
  for (let k = 0; k < 4; k++) ring.push([center[0] + Math.cos((k / 4) * Math.PI * 2) * radius * 0.8, center[1] + Math.sin((k / 4) * Math.PI * 2) * radius * 0.8]);
  if (!ring.every((p) => isDry(b, p, 0.8))) return null;
  if (occ.collides(center, radius * 0.5, 0.5)) return null;
  if (keepClear && keepClear(center, radius)) return null;
  const ecosystem = sp.kind === 'tree' ? 'woodland' : sp.kind === 'flower' ? 'meadow' : sp.id === 'reed-bed' ? 'wetland' : sp.kind === 'cactus' || sp.id === 'dune-scrub' ? 'arid-scrub' : 'understory';
  return b.addVegetation({
    speciesId: sp.id,
    labels: sp.labels,
    vegetationKind: sp.kind,
    ecosystem,
    center,
    radius,
    count: Math.round(radius * radius * 0.9),
    requirementIds,
    rationale,
  });
}

/** Species list in a stable preference order for the biome, optionally filtered by kind. */
export function speciesPool(b: BlueprintBuilder, kinds?: readonly SpeciesDef['kind'][]): SpeciesDef[] {
  return speciesForBiome(b.ctx.interp.biome).filter((s) => (kinds ? kinds.includes(s.kind) : true));
}

/** Deterministic target number of vegetation clusters for a PlanSpec. */
export function vegetationBudget(b: BlueprintBuilder): number {
  const s = b.ctx.spec;
  return Math.min(LIMITS.vegetation, 6 + (s.forest ? 6 : 0) + (s.trees ? 3 : 0) + (s.flowers ? 3 : 0));
}

/**
 * Ground points beside existing water: 8 around each lake shore (4 and 9 units
 * out) and both banks of every third river point. Deterministic order.
 */
export function waterSideSpots(b: BlueprintBuilder): Vec2[] {
  const out: Vec2[] = [];
  for (const lake of b.lakes) {
    for (const gap of [4, 9]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        out.push([round3(lake.center[0] + Math.cos(a) * (lake.radius + gap)), round3(lake.center[1] + Math.sin(a) * (lake.radius + gap))]);
      }
    }
  }
  for (const river of b.rivers) {
    const line = riverXZ(river);
    for (let i = 1; i + 1 < line.length; i += 3) {
      const p = line[i] as Vec2;
      const q = line[i + 1] as Vec2;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nx = -(q[1] - p[1]) / len;
      const nz = (q[0] - p[0]) / len;
      for (const s of [1, -1]) out.push([round3(p[0] + nx * s * (river.width + 5)), round3(p[1] + nz * s * (river.width + 5))]);
    }
  }
  return out;
}

/** Where is a character comfortable standing near `anchor`? Tries a few rings, deterministic. */
export function standNear(b: BlueprintBuilder, rng: Rng, anchor: Vec2, minR: number): Vec2 | null {
  for (let attempt = 0; attempt < 16; attempt++) {
    const a = rng.range(0, Math.PI * 2);
    const r = minR + 1.5 + attempt * 0.5;
    const p: Vec2 = [round3(anchor[0] + Math.cos(a) * r), round3(anchor[1] + Math.sin(a) * r)];
    if (isDry(b, p, 1) && dist2(p, anchor) > minR) return p;
  }
  return null;
}

export interface DesignedCrossing {
  readonly outpost: Structure;
  /** Origin -> near bank -> crossing point -> far bank -> outpost. Crosses the river by construction. */
  readonly line: Vec2[];
}

/**
 * Designs a river crossing from `origin` and creates a waypoint monument on the
 * far bank, so a required bridge has somewhere to lead.
 *
 * A straight route from the origin often cannot cross: if the river runs
 * almost directly away from the origin it spans only a few degrees as seen
 * from there. So the crossing is constructed instead of searched for: pick a
 * flat river reach, cross it perpendicular to the flow at a segment midpoint
 * (a proper crossing, never a grazed bend vertex), then route origin -> near
 * bank and far bank -> outpost on land.
 */
export function farBankOutpost(b: BlueprintBuilder, occ: Occupancy, origin: { id: string; at: Vec2 }, world: () => World2D): DesignedCrossing | null {
  const def = STRUCTURE_DEFS.monument;
  for (const river of b.rivers) {
    const line = riverXZ(river);
    // Flattest reaches first (a mountain torrent has no bank to build on), then nearest.
    const slope = line.map((p) => Math.round(slopeAt(b.terrain, p[0], p[1], 3) * 10));
    const order = line
      .map((_, i) => i)
      .filter((i) => i + 1 < line.length)
      .sort((i, j) => (slope[i] ?? 0) - (slope[j] ?? 0) || dist2(line[i] as Vec2, origin.at) - dist2(line[j] as Vec2, origin.at) || i - j);
    for (const idx of order) {
      const p = line[idx] as Vec2;
      const q = line[idx + 1] as Vec2;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const normal: Vec2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      const m: Vec2 = [round3((p[0] + q[0]) / 2), round3((p[1] + q[1]) / 2)];
      // The near bank is the origin's side of this reach.
      const near = (origin.at[0] - m[0]) * normal[0] + (origin.at[1] - m[1]) * normal[1] >= 0 ? 1 : -1;
      const bank = river.width / 2 + 3;
      const nearBank: Vec2 = [round3(m[0] + normal[0] * near * bank), round3(m[1] + normal[1] * near * bank)];
      const farBank: Vec2 = [round3(m[0] - normal[0] * near * bank), round3(m[1] - normal[1] * near * bank)];
      if (!isDry(b, nearBank, 0.5) || !isDry(b, farBank, 0.5)) continue;
      for (const reach of [10, 14, 20, 28]) {
        const at: Vec2 = [round3(farBank[0] - normal[0] * near * reach), round3(farBank[1] - normal[1] * near * reach)];
        if (!siteOk(world(), at, def, occ, 2)) continue;
        const toBank = bestRoute(b, origin.at, nearBank, obstaclesFor(b, [origin.id]));
        const fromBank = bestRoute(b, farBank, at, obstaclesFor(b, []));
        const route: Vec2[] = [...toBank, m, ...fromBank];
        if (findRiverCrossings(route, b.rivers).length === 0 || routeQuality(b, route).wet) continue;
        const outpost = b.addStructure({
          kind: 'monument',
          at,
          requirementIds: [],
          rationale: 'Far-bank waypoint so the required bridge has somewhere to lead.',
        });
        occ.add({ id: outpost.id, center: at, radius: def.footprint + 2 });
        return { outpost, line: route };
      }
    }
  }
  return null;
}
