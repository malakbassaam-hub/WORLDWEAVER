/** Small deterministic 2D/3D helpers. Pure, no I/O. Ground plane is x/z. */
import type { Vec2, Vec3 } from './types';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const xz = (p: Vec3): Vec2 => [p[0], p[2]];
export const isFiniteVec = (v: readonly number[]): boolean => v.every((n) => Number.isFinite(n));

/** Distance from point p to segment ab, in the ground plane. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const len2 = abx * abx + abz * abz;
  if (len2 === 0) return dist2(p, a);
  const t = clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t));
}

export function distToPolyline(p: Vec2, line: readonly Vec2[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return dist2(p, line[0] as Vec2);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    best = Math.min(best, distToSegment(p, line[i] as Vec2, line[i + 1] as Vec2));
  }
  return best;
}

/** Proper-or-touching intersection of segments ab and cd. Returns the point or null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-9) return null;
  const qp: Vec2 = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

/** Does segment ab pass within `radius` of `center`? */
export function segmentHitsCircle(a: Vec2, b: Vec2, center: Vec2, radius: number): boolean {
  return distToSegment(center, a, b) < radius;
}

export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += dist2(points[i] as Vec2, points[i + 1] as Vec2);
  return total;
}

/** Catmull-Rom spline through control points, resampled so spacing is at most `maxStep`. */
export function smoothCurve(control: readonly Vec2[], maxStep: number): Vec2[] {
  if (control.length < 3) return [...control];
  const out: Vec2[] = [];
  const at = (i: number): Vec2 => control[clamp(i, 0, control.length - 1)] as Vec2;
  for (let i = 0; i + 1 < control.length; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const segLen = dist2(p1, p2);
    const steps = Math.max(1, Math.ceil(segLen / maxStep));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([round3(f(p0[0], p1[0], p2[0], p3[0])), round3(f(p0[1], p1[1], p2[1], p3[1]))]);
    }
  }
  out.push(control[control.length - 1] as Vec2);
  return out;
}

/** Union-find over string ids. */
export class DisjointSet {
  private readonly parent = new Map<string, string>();
  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: string): string {
    this.add(id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    let cur = id;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}
