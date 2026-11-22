/**
 * Analytic terrain and water queries over a Terrain description.
 * Height is a pure function of (terrain, x, z), so the planners, the validator
 * and any future renderer all agree on the same ground without a heightmap.
 */
import { clamp, dist2, distToPolyline, round3, xz } from './geometry';
import type { Lake, River, Terrain, Vec2, Vec3, WorldBlueprint } from './types';

export const ISLAND_FALL = 28;
export const WATER_EPS = 0.05;

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function heightAt(terrain: Terrain, x: number, z: number): number {
  let h = terrain.baseHeight;
  if (terrain.tilt) h += terrain.tilt.gradient * (x * Math.cos(terrain.tilt.angle) + z * Math.sin(terrain.tilt.angle));
  for (const r of terrain.regions) {
    const dx = x - r.center[0];
    const dz = z - r.center[1];
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    const u = (dx * c + dz * s) / r.aspect;
    const v = -dx * s + dz * c;
    const d = Math.hypot(u, v) / r.radius;
    h += r.amplitude * Math.exp(-Math.pow(d, r.sharpness));
  }
  if (terrain.islandRadius !== null) {
    const rr = Math.hypot(x, z) / terrain.islandRadius;
    h -= smoothstep((rr - 0.62) / 0.38) * (terrain.baseHeight + ISLAND_FALL);
  }
  return h;
}

export function slopeAt(terrain: Terrain, x: number, z: number, step = 1): number {
  const gx = (heightAt(terrain, x + step, z) - heightAt(terrain, x - step, z)) / (2 * step);
  const gz = (heightAt(terrain, x, z + step) - heightAt(terrain, x, z - step)) / (2 * step);
  return Math.hypot(gx, gz);
}

export function insideLake(lakes: readonly Lake[], x: number, z: number, margin = 0): Lake | null {
  for (const lake of lakes) if (dist2([x, z], lake.center) < lake.radius + margin) return lake;
  return null;
}

/** True when the ground at (x, z) is open water (sea or lake), with an optional margin around lakes. */
export function isWaterAt(terrain: Terrain, lakes: readonly Lake[], x: number, z: number, margin = 0): boolean {
  return heightAt(terrain, x, z) < terrain.seaLevel + WATER_EPS || insideLake(lakes, x, z, margin) !== null;
}

/**
 * Distance from (x, z) to the nearest open water (sea shoreline or lake edge),
 * searched on 16 rays out to `maxR`. Returns Infinity when none is found.
 */
export function distanceToWater(terrain: Terrain, lakes: readonly Lake[], x: number, z: number, maxR = 70, step = 3): number {
  if (isWaterAt(terrain, lakes, x, z)) return 0;
  let best = Infinity;
  for (const lake of lakes) best = Math.min(best, Math.max(0, dist2([x, z], lake.center) - lake.radius));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    for (let r = step; r <= Math.min(maxR, best); r += step) {
      if (heightAt(terrain, x + cx * r, z + cz * r) < terrain.seaLevel + WATER_EPS) {
        best = Math.min(best, r);
        break;
      }
    }
  }
  return best;
}

/** Water surface a lake at `center` gets: just below the ground there, never below sea level. */
export function lakeSurfaceFor(terrain: Terrain, center: Vec2): number {
  return Math.max(terrain.seaLevel + 0.6, heightAt(terrain, center[0], center[1]) - 1);
}

/**
 * Would a lake of `radius` at `center` be contained? The ground just outside
 * the shore (1.15 x radius, where the validator looks) must stand at least
 * `margin` above the water surface on every side.
 */
export function rimHolds(terrain: Terrain, center: Vec2, radius: number, margin = 0.3): boolean {
  const surface = lakeSurfaceFor(terrain, center);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    if (heightAt(terrain, center[0] + Math.cos(a) * radius * 1.15, center[1] + Math.sin(a) * radius * 1.15) < surface + margin) return false;
  }
  return true;
}

/** Mean ground height on a ring, used to judge whether a spot stands above its surroundings. */
export function ringMeanHeight(terrain: Terrain, x: number, z: number, radius: number, samples = 8): number {
  let sum = 0;
  for (let k = 0; k < samples; k++) {
    const a = (k / samples) * Math.PI * 2;
    sum += heightAt(terrain, x + Math.cos(a) * radius, z + Math.sin(a) * radius);
  }
  return sum / samples;
}

/**
 * Water surface profile for a river whose horizontal path is fixed.
 * The surface never rises going downstream, stays at or below bed level
 * `bed` under the ground, and never goes below `endLevel` (sea or lake surface).
 */
export function profileRiver(terrain: Terrain, path: readonly Vec2[], endLevel: number, bed = 0.4): Vec3[] {
  const out: Vec3[] = [];
  let prev = Infinity;
  path.forEach((p, i) => {
    let y = Math.min(prev, heightAt(terrain, p[0], p[1]) - bed);
    y = Math.max(y, endLevel);
    if (i === path.length - 1) y = endLevel;
    y = round3(y);
    prev = y;
    out.push([p[0], y, p[1]]);
  });
  return out;
}

export function riverXZ(river: River): Vec2[] {
  return river.points.map(xz);
}

/** Distance from a ground point to the nearest river centre line, and which river. */
export function nearestRiver(rivers: readonly River[], x: number, z: number): { river: River; distance: number } | null {
  let best: { river: River; distance: number } | null = null;
  for (const river of rivers) {
    const d = distToPolyline([x, z], riverXZ(river));
    if (!best || d < best.distance) best = { river, distance: d };
  }
  return best;
}

export function groundY(bp: Pick<WorldBlueprint, 'terrain'>, x: number, z: number): number {
  return round3(heightAt(bp.terrain, x, z));
}
