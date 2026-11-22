/**
 * Composition geometry: sightlines, camera paths and framing metrics.
 * These are geometric descriptors of a layout. They say nothing about how a
 * renderer will look; visual quality is NOT verified by this module.
 */
import { clamp, dist2, round3 } from './geometry';
import { heightAt } from './terrain';
import type { CameraKeyframe, CameraPath, Composition, Structure, Terrain, Vec2, Vec3, WorldBlueprint } from './types';

export const DEFAULT_FOV_DEG = 45;
export const ASPECT = 16 / 9;
export const TAN_HALF = Math.tan((DEFAULT_FOV_DEG * Math.PI) / 360);
/** Horizontal angle from the frame centre to a vertical thirds line. */
export const THIRDS_ANGLE = Math.atan((TAN_HALF * ASPECT) / 3);

/**
 * Look-at point that puts `heroTop` on the right (side 1) or left (side -1)
 * vertical thirds line and roughly on the upper horizontal third.
 */
export function thirdsLookAt(camera: Vec3, heroTop: Vec3, side: 1 | -1): Vec3 {
  const heroAngle = Math.atan2(heroTop[2] - camera[2], heroTop[0] - camera[0]);
  const viewAngle = heroAngle - side * THIRDS_ANGLE;
  const depth = Math.hypot(heroTop[0] - camera[0], heroTop[2] - camera[2]) * Math.cos(THIRDS_ANGLE);
  return [
    round3(camera[0] + Math.cos(viewAngle) * depth),
    round3(heroTop[1] - (depth * TAN_HALF) / 3),
    round3(camera[2] + Math.sin(viewAngle) * depth),
  ];
}

export interface SightResult {
  readonly clear: boolean;
  readonly blockedBy: string | null;
}

/**
 * Is the straight line from `from` to the top of `target` unobstructed by terrain
 * or by another structure? The last few units before the target are ignored so
 * the target's own base does not count as an obstacle.
 */
export function sightClear(
  terrain: Terrain,
  structures: readonly Structure[],
  from: Vec3,
  to: Vec3,
  ignoreIds: readonly string[],
): SightResult {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const steps = Math.max(8, Math.ceil(length / 3));
  const cutoff = Math.min(8, length * 0.15);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (length * (1 - t) < cutoff) break;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    const z = from[2] + (to[2] - from[2]) * t;
    if (heightAt(terrain, x, z) + 0.3 > y) return { clear: false, blockedBy: 'terrain' };
    for (const s of structures) {
      if (ignoreIds.includes(s.id)) continue;
      const base = s.transform.position[1];
      if (dist2([x, z], [s.transform.position[0], s.transform.position[2]]) < s.footprintRadius && y < base + s.height) {
        return { clear: false, blockedBy: s.id };
      }
    }
  }
  return { clear: true, blockedBy: null };
}

export function dollyPath(id: string, kind: CameraPath['kind'], from: Vec3, to: Vec3, lookAt: Vec3, durationSec: number, keys = 4): CameraPath {
  const keyframes: CameraKeyframe[] = [];
  for (let i = 0; i < keys; i++) {
    const t = keys === 1 ? 0 : i / (keys - 1);
    keyframes.push({
      t: round3(t * durationSec),
      position: [round3(from[0] + (to[0] - from[0]) * t), round3(from[1] + (to[1] - from[1]) * t), round3(from[2] + (to[2] - from[2]) * t)],
      lookAt,
      fovDeg: DEFAULT_FOV_DEG,
    });
  }
  return { id, kind, durationSec, keyframes };
}

export function orbitPath(id: string, center: Vec3, radius: number, height: number, durationSec: number, startAngle = 0, keys = 8): CameraPath {
  const keyframes: CameraKeyframe[] = [];
  for (let i = 0; i < keys; i++) {
    const a = startAngle + (i / keys) * Math.PI * 2;
    keyframes.push({
      t: round3((i / keys) * durationSec),
      position: [round3(center[0] + Math.cos(a) * radius), round3(center[1] + height), round3(center[2] + Math.sin(a) * radius)],
      lookAt: center,
      fovDeg: DEFAULT_FOV_DEG,
    });
  }
  return { id, kind: 'orbit', durationSec, keyframes };
}

/**
 * Screen-space position of a world point seen from a keyframe, as normalised
 * device coordinates in [-1, 1] (x right, y up), or null when behind the camera.
 */
export function projectToScreen(key: CameraKeyframe, p: Vec3, aspect = ASPECT): Vec2 | null {
  const fwd = norm(sub(key.lookAt, key.position));
  const worldUp: Vec3 = [0, 1, 0];
  const right = norm(cross(fwd, worldUp));
  const up = cross(right, fwd);
  const d = sub(p, key.position);
  const depth = dot(d, fwd);
  if (depth <= 0.01) return null;
  const tanHalf = Math.tan((key.fovDeg * Math.PI) / 360);
  return [dot(d, right) / depth / (tanHalf * aspect), dot(d, up) / depth / tanHalf];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export interface CompositionMetrics {
  /** Hero visible inside the frame at the first establishing keyframe (|ndc| < 0.9). */
  readonly heroInFrame: boolean;
  /** 0..1, how close the hero sits to a rule-of-thirds line intersection. */
  readonly thirds: number;
  /** 0..1, fraction of depth layers (foreground, mid, background) that contain scene elements. */
  readonly layers: number;
  readonly sightlineClear: boolean;
  readonly heroId: string | null;
}

/** Measures framing of the hero from the first establishing camera keyframe. */
export function compositionMetrics(bp: WorldBlueprint): CompositionMetrics {
  const comp: Composition = bp.composition;
  const heroFocal = comp.focalPoints.find((f) => f.role === 'hero');
  const hero = heroFocal ? bp.structures.find((s) => s.id === heroFocal.targetId) : undefined;
  const cam = comp.cameraPaths.find((c) => c.kind === 'establishing' || c.kind === 'dolly') ?? comp.cameraPaths[0];
  const key = cam?.keyframes[0];
  if (!hero || !key) return { heroInFrame: false, thirds: 0, layers: 0, sightlineClear: false, heroId: hero?.id ?? null };

  const top: Vec3 = [hero.transform.position[0], hero.transform.position[1] + hero.height * 0.6, hero.transform.position[2]];
  const ndc = projectToScreen(key, top);
  const inFrame = !!ndc && Math.abs(ndc[0]) < 0.9 && Math.abs(ndc[1]) < 0.9;

  let thirds = 0;
  if (ndc && inFrame) {
    // Thirds lines sit at +-1/3 of the half-extent in NDC.
    const dx = Math.abs(Math.abs(ndc[0]) - 1 / 3);
    const dy = Math.abs(Math.abs(ndc[1]) - 1 / 3);
    thirds = clamp(1 - (dx + dy) / 0.8, 0, 1);
  }

  const forward: Vec3 = norm(sub(key.lookAt, key.position));
  const bands = [0, 0, 0];
  const probes: Vec3[] = [
    ...bp.structures.map((s) => s.transform.position),
    ...bp.vegetation.map((v) => v.transform.position),
    ...bp.terrain.regions.filter((r) => r.regionKind === 'ridge' || r.regionKind === 'mountain').map((r) => r.transform.position),
  ];
  const heroDepth = Math.max(1, dot(sub(top, key.position), forward));
  for (const p of probes) {
    const depth = dot(sub(p, key.position), forward);
    if (depth <= 0) continue;
    const band = depth < heroDepth * 0.6 ? 0 : depth <= heroDepth * 1.25 ? 1 : 2;
    bands[band] = (bands[band] ?? 0) + 1;
  }
  const layers = bands.filter((n) => n > 0).length / 3;

  const sight = sightClear(bp.terrain, bp.structures, key.position, top, [hero.id]);
  return { heroInFrame: inFrame, thirds: round3(thirds), layers: round3(layers), sightlineClear: sight.clear, heroId: hero.id };
}
