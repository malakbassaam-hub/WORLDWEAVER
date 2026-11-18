/**
 * World context for the model: a compact, deterministic summary in which
 * entities are referred to by short refs (e1, e2, …) instead of internal IDs.
 * The translator resolves refs with the same function, so a ref in a proposal
 * always means the entity it meant when the context was built.
 */
import { LUMINOUS_PALETTE } from '../core/palette';
import type { EntityId, World } from '../core/types';

export interface ContextEntity {
  readonly ref: string;
  readonly name: string;
  readonly kind: string;
  readonly archetype: string | null;
  /** Palette name if the entity uses an exact palette look, otherwise "custom". */
  readonly palette: string;
  readonly visible: boolean;
  readonly pinned: boolean;
  readonly parentRef: string | null;
}

export interface WorldContext {
  readonly worldName: string;
  readonly biome: string;
  readonly entityCount: number;
  readonly entities: readonly ContextEntity[];
  /** ref → EntityId. Not sent to the model. */
  readonly refs: ReadonlyMap<string, EntityId>;
}

/** Refs follow `world.order`, so they are stable for a given world state. */
export function buildWorldContext(world: World): WorldContext {
  const refs = new Map<string, EntityId>();
  const refOf = new Map<EntityId, string>();
  world.order.forEach((id, index) => {
    const ref = `e${index + 1}`;
    refs.set(ref, id);
    refOf.set(id, ref);
  });
  const entities: ContextEntity[] = [];
  for (const id of world.order) {
    const e = world.entities[id];
    if (!e) continue;
    const visual = e.components.visual;
    const look = visual
      ? LUMINOUS_PALETTE.find((p) => p.color === visual.color.toLowerCase() && p.emissive === visual.emissive.toLowerCase())
      : undefined;
    entities.push({
      ref: refOf.get(id) ?? '',
      name: e.name,
      kind: e.kind,
      archetype: visual?.archetype ?? null,
      palette: look?.name ?? 'custom',
      visible: visual?.visible ?? true,
      pinned: e.pinned,
      parentRef: e.parentId ? (refOf.get(e.parentId) ?? null) : null,
    });
  }
  return { worldName: world.name, biome: world.biome, entityCount: world.order.length, entities, refs };
}
