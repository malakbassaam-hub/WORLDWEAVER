/**
 * Pinned-entity protection shared by World Morph (src/director/morph.ts) and
 * Parallel Futures (futures.ts). Implements the invariant behind the WW-031
 * approved policies: every pinned entity keeps its data (including
 * provenance), its world pose and its effective visibility.
 *
 * No three.js, no DOM.
 */
import { canonical } from './fingerprint';
import { effectiveVisible, posesEqual, worldPose } from './pose';
import type { EntityId, World } from './types';

export interface PinClosure {
  /** Entities with `pinned: true`, in world order. */
  readonly pinned: readonly EntityId[];
  /** Ancestors of pinned entities (excluding pinned entities themselves), in world order. */
  readonly protectedAncestors: readonly EntityId[];
  /** Ancestor → the first pinned descendant it protects (for messages). */
  readonly protects: ReadonlyMap<EntityId, EntityId>;
}

export function pinClosure(world: World): PinClosure {
  const pinned = world.order.filter((id) => world.entities[id]?.pinned);
  const pinnedSet = new Set<EntityId>(pinned);
  const protects = new Map<EntityId, EntityId>();
  for (const id of pinned) {
    const seen = new Set<string>([id]);
    for (let p = world.entities[id]?.parentId ?? null; p && world.entities[p] && !seen.has(p); p = world.entities[p]?.parentId ?? null) {
      seen.add(p);
      if (!pinnedSet.has(p) && !protects.has(p)) protects.set(p, id);
    }
  }
  const protectedAncestors = world.order.filter((id) => protects.has(id));
  return { pinned, protectedAncestors, protects };
}

export interface PinnedViolation {
  readonly id: EntityId;
  readonly kind: 'removed' | 'data' | 'pose' | 'visibility';
  readonly message: string;
}

export function quotedName(world: World, id: EntityId): string {
  return `“${world.entities[id]?.name ?? id}”`;
}

/**
 * Each pinned entity (as of `before`) must keep, in `after`: the same data
 * (including provenance), the same world pose, and the same effective
 * visibility. Returns all violations (empty = invariant holds).
 */
export function checkPinnedInvariant(before: World, after: World, pinned: readonly EntityId[] = pinClosure(before).pinned): PinnedViolation[] {
  const violations: PinnedViolation[] = [];
  for (const id of pinned) {
    const a = before.entities[id];
    const b = after.entities[id];
    if (!a) continue;
    if (!b) {
      violations.push({ id, kind: 'removed', message: `Pinned ${quotedName(before, id)} was removed.` });
      continue;
    }
    if (a !== b && canonical(a) !== canonical(b)) {
      violations.push({ id, kind: 'data', message: `Pinned ${quotedName(before, id)} was changed.` });
    }
    const pa = worldPose(before, id);
    const pb = worldPose(after, id);
    if (pa && pb && !posesEqual(pa, pb)) {
      violations.push({ id, kind: 'pose', message: `Pinned ${quotedName(before, id)} would move in the world.` });
    }
    if (effectiveVisible(before, id) !== effectiveVisible(after, id)) {
      violations.push({ id, kind: 'visibility', message: `Pinned ${quotedName(before, id)} would change visibility.` });
    }
  }
  return violations;
}
