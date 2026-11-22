/**
 * Connectivity helpers shared by both planners: land routing, river crossings,
 * bridges and a minimum spanning tree. Strategies decide WHICH nodes to join
 * and in what order; these helpers only do geometry.
 */
import type { BlueprintBuilder } from './builder';
import { dist2, distToPolyline, segmentHitsCircle, segmentIntersection, xz } from './geometry';
import { heightAt, riverXZ } from './terrain';
import type { Bridge, Lake, PathWay, River, Vec2 } from './types';

/** True when any sample along ab is open sea. */
function crossesSea(b: BlueprintBuilder, a: Vec2, c: Vec2): boolean {
  const steps = Math.max(2, Math.ceil(dist2(a, c) / 3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (heightAt(b.terrain, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t) < b.terrain.seaLevel + 0.4) return true;
  }
  return false;
}

export interface Obstacle {
  readonly center: Vec2;
  /** Radius to keep clear, clearance included. */
  readonly radius: number;
}

/** Circles a path between two places must go around: lakes, plus buildings that are not its endpoints. */
export function obstaclesFor(b: BlueprintBuilder, endpointIds: readonly string[], lakeClearance = 4): Obstacle[] {
  return [
    ...b.lakes.map((l: Lake) => ({ center: l.center, radius: l.radius + lakeClearance })),
    ...b.structures
      .filter((s) => !endpointIds.includes(s.id) && !(s.settlementId !== null && endpointIds.includes(s.settlementId)))
      .map((s) => ({ center: xz(s.transform.position), radius: s.footprintRadius + 1.5 })),
  ];
}

/** Detour around obstacles: insert a waypoint beside the obstacle on the cheaper side. */
function detour(a: Vec2, c: Vec2, obstacles: readonly Obstacle[]): Vec2[] {
  let line: Vec2[] = [a, c];
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const next: Vec2[] = [line[0] as Vec2];
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i] as Vec2;
      const q = line[i + 1] as Vec2;
      // Ignore obstacles that contain an endpoint of this segment (we are leaving or arriving there).
      const hit = obstacles.find((o) => segmentHitsCircle(p, q, o.center, o.radius) && dist2(p, o.center) > o.radius && dist2(q, o.center) > o.radius);
      if (hit) {
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const r = hit.radius + 2;
        const left: Vec2 = [hit.center[0] + nx * r, hit.center[1] + nz * r];
        const right: Vec2 = [hit.center[0] - nx * r, hit.center[1] - nz * r];
        // A waypoint inside another obstacle would be ignored on the next pass
        // (it contains a segment endpoint), so it costs extra here.
        const inside = (w: Vec2) => (obstacles.some((o) => o !== hit && dist2(w, o.center) < o.radius) ? 1000 : 0);
        const costL = dist2(p, left) + dist2(left, q) + inside(left);
        const costR = dist2(p, right) + dist2(right, q) + inside(right);
        next.push(costL <= costR ? left : right);
        changed = true;
      }
      next.push(q);
    }
    line = next;
    if (!changed) break;
  }
  return line;
}

/**
 * Route between two land points. Obstacles (by default every lake) are
 * bypassed; open sea is avoided by pulling the midpoint toward the world
 * centre until the segment is dry.
 */
export function routeOnLand(b: BlueprintBuilder, a: Vec2, c: Vec2, obstacles: readonly Obstacle[] = obstaclesFor(b, []), depth = 0): Vec2[] {
  const base = detour(a, c, obstacles);
  const out: Vec2[] = [base[0] as Vec2];
  for (let i = 0; i + 1 < base.length; i++) {
    const p = base[i] as Vec2;
    const q = base[i + 1] as Vec2;
    if (depth < 4 && crossesSea(b, p, q)) {
      const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const pulled: Vec2 = [mid[0] * 0.55, mid[1] * 0.55];
      const left = routeOnLand(b, p, pulled, obstacles, depth + 1);
      const right = routeOnLand(b, pulled, q, obstacles, depth + 1);
      out.push(...left.slice(1), ...right.slice(1));
    } else out.push(q);
  }
  return out;
}

export interface RouteQuality {
  readonly wet: boolean;
  readonly maxGrade: number;
  readonly length: number;
}

/** Wetness (open sea or lake), steepest grade and length of a ground route. */
export function routeQuality(b: BlueprintBuilder, line: readonly Vec2[]): RouteQuality {
  let wet = false;
  let maxGrade = 0;
  let length = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Vec2;
    const c = line[i + 1] as Vec2;
    const run = dist2(a, c);
    length += run;
    const steps = Math.max(1, Math.ceil(run / 4));
    let prevH = heightAt(b.terrain, a[0], a[1]);
    for (let k = 1; k <= steps; k++) {
      const x = a[0] + ((c[0] - a[0]) * k) / steps;
      const z = a[1] + ((c[1] - a[1]) * k) / steps;
      const h = heightAt(b.terrain, x, z);
      if (h < b.terrain.seaLevel + 0.4 || b.lakes.some((l) => dist2([x, z], l.center) < l.radius)) wet = true;
      maxGrade = Math.max(maxGrade, Math.abs(h - prevH) / (run / steps));
      prevH = h;
    }
  }
  return { wet, maxGrade, length };
}

/**
 * Chooses among the direct route and four detours through a waypoint beside
 * the midpoint (15 and 30 units either side). Dry beats wet, then a gentler
 * steepest grade, then shorter. With `requireCrossing`, only routes that cross
 * a river are eligible (used when a bridge is the point of the path).
 */
export function bestRoute(b: BlueprintBuilder, a: Vec2, c: Vec2, obstacles: readonly Obstacle[], options: { requireCrossing?: boolean } = {}): Vec2[] {
  const dx = c[0] - a[0];
  const dz = c[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const n: Vec2 = [-dz / len, dx / len];
  const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  const options_: Vec2[][] = [routeOnLand(b, a, c, obstacles)];
  for (const off of [-30, -15, 15, 30]) {
    const w: Vec2 = [mid[0] + n[0] * off, mid[1] + n[1] * off];
    if (obstacles.some((o) => dist2(w, o.center) < o.radius)) continue;
    options_.push([...routeOnLand(b, a, w, obstacles), ...routeOnLand(b, w, c, obstacles).slice(1)]);
  }
  let best: Vec2[] | null = null;
  let bestCost = Infinity;
  for (const line of options_) {
    if (options.requireCrossing && findRiverCrossings(line, b.rivers).length === 0) continue;
    const q = routeQuality(b, line);
    const cost = (q.wet ? 1000 : 0) + Math.min(q.maxGrade, 3) * 100 + q.length * 0.05;
    if (cost < bestCost) {
      bestCost = cost;
      best = line;
    }
  }
  return best ?? (options_[0] as Vec2[]);
}

export interface Crossing {
  readonly river: River;
  readonly point: Vec2;
  /** Direction of the path where it crosses, radians. */
  readonly yaw: number;
  /** Angle between path and river, radians, in (0, PI/2]. */
  readonly angle: number;
}

export function findRiverCrossings(line: readonly Vec2[], rivers: readonly River[]): Crossing[] {
  const found: Crossing[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Vec2;
    const c = line[i + 1] as Vec2;
    for (const river of rivers) {
      const rl = riverXZ(river);
      for (let j = 0; j + 1 < rl.length; j++) {
        const hit = segmentIntersection(a, c, rl[j] as Vec2, rl[j + 1] as Vec2);
        if (!hit) continue;
        const pathYaw = Math.atan2(c[1] - a[1], c[0] - a[0]);
        const rl0 = rl[j] as Vec2;
        const rl1 = rl[j + 1] as Vec2;
        const riverYaw = Math.atan2(rl1[1] - rl0[1], rl1[0] - rl0[0]);
        let d = Math.abs(pathYaw - riverYaw) % Math.PI;
        if (d > Math.PI / 2) d = Math.PI - d;
        found.push({ river, point: hit, yaw: pathYaw, angle: Math.max(d, 0.35) });
      }
    }
  }
  // Collapse crossings that are effectively the same point.
  const unique: Crossing[] = [];
  for (const x of found) {
    if (!unique.some((u) => u.river.id === x.river.id && dist2(u.point, x.point) < 3)) unique.push(x);
  }
  return unique;
}

/** Places a bridge for every river crossing of `path`. */
export function bridgeCrossings(b: BlueprintBuilder, path: PathWay, requirementIds: readonly string[], rationale: string): Bridge[] {
  const line = path.points.map(xz);
  return findRiverCrossings(line, b.rivers).map((x) => {
    const length = Math.max(10, (x.river.width + 1) / Math.sin(x.angle) + 4);
    return b.addBridge({ path, over: x.river, at: x.point, yaw: x.yaw, length, requirementIds, rationale });
  });
}

/** Prim's algorithm over a cost function; returns index pairs. Deterministic ties by index. */
export function minimumSpanningTree(count: number, cost: (i: number, j: number) => number): [number, number][] {
  if (count <= 1) return [];
  const inTree = new Array<boolean>(count).fill(false);
  inTree[0] = true;
  const edges: [number, number][] = [];
  for (let added = 1; added < count; added++) {
    let best: [number, number] | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < count; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < count; j++) {
        if (inTree[j]) continue;
        const c = cost(i, j);
        if (c < bestCost) {
          bestCost = c;
          best = [i, j];
        }
      }
    }
    if (!best) break;
    inTree[best[1]] = true;
    edges.push(best);
  }
  return edges;
}

/** Distance from a path's samples to the nearest river centre line (smallest over samples). */
export function minDistanceToRivers(line: readonly Vec2[], rivers: readonly River[]): number {
  let best = Infinity;
  for (const r of rivers) for (const p of line) best = Math.min(best, distToPolyline(p, riverXZ(r)));
  return best;
}
