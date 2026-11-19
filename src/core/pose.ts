/**
 * World-space pose and effective visibility of entities, computed from world
 * data only (no three.js), using the same rules as the renderer:
 *
 * - Position and rotation are relative to the parent and ARE inherited.
 * - Scale applies to the entity's own body and is NOT inherited
 *   (see `Transform.scale` in types.ts and `SceneRenderer.applyEntity`).
 * - Rotation is Euler XYZ in radians, matching three.js `Euler` order 'XYZ'.
 * - An entity is visible only if it and every ancestor are visible
 *   (children are attached under their parent's root in the renderer).
 */
import type { EntityId, Vec3, World } from './types';

/** Row-major 3×3 rotation matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export interface WorldPose {
  readonly position: Vec3;
  readonly rotation: Mat3;
  /** The entity's own scale (not inherited). */
  readonly scale: Vec3;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Same matrix as three.js `Matrix4.makeRotationFromEuler` for order 'XYZ'. */
export function rotationFromEulerXYZ(e: Vec3): Mat3 {
  const a = Math.cos(e[0]);
  const b = Math.sin(e[0]);
  const c = Math.cos(e[1]);
  const d = Math.sin(e[1]);
  const f0 = Math.cos(e[2]);
  const f1 = Math.sin(e[2]);
  const ae = a * f0;
  const af = a * f1;
  const be = b * f0;
  const bf = b * f1;
  return [c * f0, -c * f1, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}

export function multiplyMat3(m: Mat3, n: Mat3): Mat3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = m[i * 3]! * n[j]! + m[i * 3 + 1]! * n[3 + j]! + m[i * 3 + 2]! * n[6 + j]!;
    }
  }
  return r as unknown as Mat3;
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Chain from the root down to `id` (inclusive). Stops at missing parents and cycles. */
export function ancestry(world: World, id: EntityId): EntityId[] {
  const chain: EntityId[] = [];
  const seen = new Set<string>();
  for (let cur: EntityId | null = id; cur && world.entities[cur] && !seen.has(cur); cur = world.entities[cur]?.parentId ?? null) {
    seen.add(cur);
    chain.push(cur);
  }
  return chain.reverse();
}

/** World pose, or null if the entity does not exist. */
export function worldPose(world: World, id: EntityId): WorldPose | null {
  const entity = world.entities[id];
  if (!entity) return null;
  let position: Vec3 = [0, 0, 0];
  let rotation: Mat3 = IDENTITY;
  for (const step of ancestry(world, id)) {
    const t = world.entities[step]!.components.transform;
    const offset = applyMat3(rotation, t.position);
    position = [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]];
    rotation = multiplyMat3(rotation, rotationFromEulerXYZ(t.rotation));
  }
  return { position, rotation, scale: entity.components.transform.scale };
}

export function effectiveVisible(world: World, id: EntityId): boolean {
  if (!world.entities[id]) return false;
  return ancestry(world, id).every((step) => world.entities[step]?.components.visual?.visible ?? true);
}

export function posesEqual(a: WorldPose, b: WorldPose, tolerance = 1e-9): boolean {
  const close = (x: readonly number[], y: readonly number[]) => x.every((v, i) => Math.abs(v - y[i]!) <= tolerance);
  return close(a.position, b.position) && close(a.rotation, b.rotation) && close(a.scale, b.scale);
}
