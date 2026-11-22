/**
 * Siting rules shared by both planners and mirrored by the validator.
 * `siteOk` answers "may a structure of this kind stand here?" (hard rules).
 * `sitingScore` answers "how good is this spot?" (soft preference, 0..1).
 */
import type { StructureDef } from './catalog';
import { clamp, dist2, distToPolyline } from './geometry';
import { distanceToWater, heightAt, insideLake, riverXZ, ringMeanHeight, slopeAt } from './terrain';
import type { Lake, River, Terrain, Vec2 } from './types';

export interface Footprint {
  readonly id: string;
  readonly center: Vec2;
  readonly radius: number;
}

export class Occupancy {
  private readonly items: Footprint[] = [];
  add(f: Footprint): void {
    this.items.push(f);
  }
  all(): readonly Footprint[] {
    return this.items;
  }
  collides(center: Vec2, radius: number, margin = 1.5, ignoreId?: string): boolean {
    return this.items.some((f) => f.id !== ignoreId && dist2(center, f.center) < f.radius + radius + margin);
  }
}

export interface World2D {
  readonly terrain: Terrain;
  readonly lakes: readonly Lake[];
  readonly rivers: readonly River[];
  readonly extent: number;
}

export const EDGE_MARGIN = 0.85;
export const RIVER_CLEARANCE = 1.5;

/** Hard siting rules. Everything here is also re-checked by the validator. */
export function siteOk(w: World2D, p: Vec2, def: Pick<StructureDef, 'footprint' | 'slopeMax'>, occ: Occupancy, margin = 1.5): boolean {
  if (Math.abs(p[0]) > w.extent * EDGE_MARGIN || Math.abs(p[1]) > w.extent * EDGE_MARGIN) return false;
  const h = heightAt(w.terrain, p[0], p[1]);
  if (h < w.terrain.seaLevel + 0.8) return false;
  if (insideLake(w.lakes, p[0], p[1], def.footprint + 2)) return false;
  // Ground under the whole footprint must be dry, not just its centre.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    if (heightAt(w.terrain, p[0] + Math.cos(a) * def.footprint, p[1] + Math.sin(a) * def.footprint) < w.terrain.seaLevel + 0.2) return false;
  }
  if (slopeAt(w.terrain, p[0], p[1], Math.max(1, def.footprint * 0.5)) > def.slopeMax * 0.9) return false;
  for (const river of w.rivers) {
    if (distToPolyline(p, riverXZ(river)) < river.width / 2 + def.footprint + RIVER_CLEARANCE) return false;
  }
  return !occ.collides(p, def.footprint, margin);
}

export function sitingScore(w: World2D, p: Vec2, def: StructureDef): number {
  const h = heightAt(w.terrain, p[0], p[1]);
  switch (def.need) {
    case 'coast': {
      const d = distanceToWater(w.terrain, w.lakes, p[0], p[1], 60, 3);
      const max = def.maxWaterDistance ?? 28;
      if (!Number.isFinite(d) || d > max * 0.9) return 0;
      // Prefer a clifftop close to the water but not in it.
      return clamp(1 - d / max, 0, 1) * 0.7 + clamp((h - w.terrain.seaLevel) / 12, 0, 1) * 0.3;
    }
    case 'high': {
      const prominence = h - ringMeanHeight(w.terrain, p[0], p[1], 25);
      return clamp(prominence / 8, 0, 1) * 0.7 + clamp(1 - slopeAt(w.terrain, p[0], p[1], 2) / def.slopeMax, 0, 1) * 0.3;
    }
    case 'flat':
      return clamp(1 - slopeAt(w.terrain, p[0], p[1], 2) / def.slopeMax, 0, 1);
    default:
      return 0.5;
  }
}

/** Mean slope over a disc, used for settlement flatness. */
export function meanSlope(terrain: Terrain, c: Vec2, radius: number): number {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    sum += slopeAt(terrain, c[0] + Math.cos(a) * radius * 0.7, c[1] + Math.sin(a) * radius * 0.7, 2);
    n++;
  }
  sum += slopeAt(terrain, c[0], c[1], 2);
  n++;
  return sum / n;
}
