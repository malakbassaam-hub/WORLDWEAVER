import type {
  Entity,
  EntityDraft,
  EntityId,
  EventSource,
  Transform,
  Vec3,
  VisualComponent,
  World,
  WorldEvent,
} from './types';

/**
 * Pure world reducer. Given the same world and event it always returns the
 * same result, which is what makes deterministic replay possible.
 *
 * Invalid events are rejected with a reason and leave the world untouched;
 * the reducer never throws for bad input.
 */
export type ApplyResult =
  | { readonly ok: true; readonly world: World }
  | { readonly ok: false; readonly world: World; readonly reason: string };

export const NAME_MAX_LENGTH = 80;
export const EMISSIVE_MAX = 20;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function createEmptyWorld(init: {
  id: string;
  name: string;
  biome: string;
  seed: number;
}): World {
  return {
    schemaVersion: 1,
    id: init.id,
    name: init.name,
    biome: init.biome,
    seed: init.seed >>> 0,
    seq: 0,
    entities: {},
    order: [],
  };
}

export function getEntity(world: World, id: EntityId): Entity | undefined {
  return world.entities[id];
}

export function childrenOf(world: World, id: EntityId | null): EntityId[] {
  return world.order.filter((childId) => world.entities[childId]?.parentId === id);
}

export function applyEvent(world: World, event: WorldEvent): ApplyResult {
  const reject = (reason: string): ApplyResult => ({ ok: false, world, reason });
  const seq = world.seq + 1;

  switch (event.type) {
    case 'entity/added': {
      const draft = event.entity;
      if (world.entities[draft.id]) return reject(`Entity id already exists: ${draft.id}`);
      const problem = validateDraft(draft);
      if (problem) return reject(problem);
      if (draft.parentId !== null && !world.entities[draft.parentId]) {
        return reject(`Parent entity not found: ${draft.parentId}`);
      }
      const entity: Entity = {
        ...draft,
        name: draft.name.trim(),
        tags: [...draft.tags],
        provenance: stamp(event.source, seq, seq),
      };
      return {
        ok: true,
        world: {
          ...world,
          seq,
          entities: { ...world.entities, [entity.id]: entity },
          order: [...world.order, entity.id],
        },
      };
    }

    case 'entity/removed': {
      const target = world.entities[event.id];
      if (!target) return reject(`Entity not found: ${event.id}`);
      if (target.pinned) return reject(`"${target.name}" is pinned and cannot be removed.`);
      if (childrenOf(world, target.id).length > 0) {
        return reject(`"${target.name}" has child entities. Remove them first.`);
      }
      const rest: Record<string, Entity> = { ...world.entities };
      delete rest[target.id];
      return {
        ok: true,
        world: { ...world, seq, entities: rest, order: world.order.filter((id) => id !== target.id) },
      };
    }

    case 'entity/renamed': {
      const name = event.name.trim();
      const problem = validateName(name);
      if (problem) return reject(problem);
      return updateEntity(world, event.id, seq, event.source, (e) =>
        e.name === name ? null : { ...e, name },
      );
    }

    case 'entity/transformed': {
      return updateEntity(world, event.id, seq, event.source, (e) => {
        const current = e.components.transform;
        const next: Transform = { ...current, ...event.transform };
        const problem = validateTransform(next);
        if (problem) return problem;
        if (sameVec(next.position, current.position) && sameVec(next.rotation, current.rotation) && sameVec(next.scale, current.scale)) {
          return null;
        }
        return { ...e, components: { ...e.components, transform: next } };
      });
    }

    case 'entity/visualChanged': {
      return updateEntity(world, event.id, seq, event.source, (e) => {
        const visual = e.components.visual;
        if (!visual) return `"${e.name}" has no visual component.`;
        const next: VisualComponent = { ...visual, ...event.patch, archetype: visual.archetype };
        const problem = validateVisual(next);
        if (problem) return problem;
        if (
          next.color.toLowerCase() === visual.color.toLowerCase() &&
          next.emissive.toLowerCase() === visual.emissive.toLowerCase() &&
          next.emissiveIntensity === visual.emissiveIntensity &&
          next.visible === visual.visible
        ) {
          return null;
        }
        return { ...e, components: { ...e.components, visual: next } };
      });
    }

    case 'entity/pinnedChanged': {
      return updateEntity(world, event.id, seq, event.source, (e) =>
        e.pinned === event.pinned ? null : { ...e, pinned: event.pinned },
      );
    }

    default: {
      const unknown: never = event;
      return reject(`Unknown event type: ${(unknown as { type: string }).type}`);
    }
  }
}

/**
 * Applies `fn` to an entity. `fn` returns the updated entity, `null` for a
 * no-op (rejected as "no change" so history is not polluted), or a string
 * describing why the change is invalid.
 */
function updateEntity(
  world: World,
  id: EntityId,
  seq: number,
  source: EventSource,
  fn: (entity: Entity) => Entity | string | null,
): ApplyResult {
  const current = world.entities[id];
  if (!current) return { ok: false, world, reason: `Entity not found: ${id}` };
  const result = fn(current);
  if (result === null) return { ok: false, world, reason: 'No change.' };
  if (typeof result === 'string') return { ok: false, world, reason: result };
  const updated: Entity = {
    ...result,
    provenance: { ...current.provenance, lastModifiedBy: source, lastModifiedSeq: seq },
  };
  return { ok: true, world: { ...world, seq, entities: { ...world.entities, [id]: updated } } };
}

function stamp(source: EventSource, createdAtSeq: number, lastModifiedSeq: number) {
  return { createdBy: source, createdAtSeq, lastModifiedBy: source, lastModifiedSeq };
}

function validateName(name: string): string | null {
  if (name.length === 0) return 'Name must not be empty.';
  if (name.length > NAME_MAX_LENGTH) return `Name must be at most ${NAME_MAX_LENGTH} characters.`;
  return null;
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Result of applying a list of events atomically. */
export type ApplyAllResult =
  | { readonly ok: true; readonly world: World }
  | { readonly ok: false; readonly world: World; readonly index: number; readonly reason: string };

/**
 * Applies events in order, all or nothing. On the first rejection the
 * ORIGINAL world is returned unchanged, with the failing index and reason.
 */
export function applyEvents(world: World, events: readonly WorldEvent[]): ApplyAllResult {
  let current = world;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event) return { ok: false, world, index, reason: 'Missing event.' };
    const result = applyEvent(current, event);
    if (!result.ok) return { ok: false, world, index, reason: result.reason };
    current = result.world;
  }
  return { ok: true, world: current };
}

function finiteVec(v: Vec3): boolean {
  return v.length === 3 && v.every((n) => Number.isFinite(n));
}

function validateTransform(t: Transform): string | null {
  if (!finiteVec(t.position)) return 'Position must contain three finite numbers.';
  if (!finiteVec(t.rotation)) return 'Rotation must contain three finite numbers.';
  if (!finiteVec(t.scale) || t.scale.some((s) => s <= 0)) return 'Scale must be positive.';
  return null;
}

function validateVisual(v: VisualComponent): string | null {
  if (!HEX_COLOR.test(v.color)) return `Invalid colour: ${v.color}`;
  if (!HEX_COLOR.test(v.emissive)) return `Invalid emissive colour: ${v.emissive}`;
  if (!Number.isFinite(v.emissiveIntensity) || v.emissiveIntensity < 0 || v.emissiveIntensity > EMISSIVE_MAX) {
    return `Glow intensity must be between 0 and ${EMISSIVE_MAX}.`;
  }
  return null;
}

function validateDraft(d: EntityDraft): string | null {
  const nameProblem = validateName(d.name.trim());
  if (nameProblem) return nameProblem;
  if (d.kind.trim().length === 0) return 'Entity kind must not be empty.';
  const transformProblem = validateTransform(d.components.transform);
  if (transformProblem) return transformProblem;
  if (d.components.visual) return validateVisual(d.components.visual);
  return null;
}
