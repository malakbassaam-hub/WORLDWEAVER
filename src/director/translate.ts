/**
 * Deterministic translation of a validated WorldProposal into WorldEvents.
 *
 * - IDs and positions are computed locally from a hash of the proposal plus the
 *   world's seed and seq. The model never supplies IDs or coordinates.
 * - Each operation is dry-run through the real reducer on a preview world and
 *   is accepted or rejected as a unit, so the returned events always apply
 *   cleanly in order: replay(world, events) === preview.
 * - Proposal text is only ever used as data (names, notes). Nothing is evaluated.
 */
import { LUMINOUS_PALETTE } from '../core/palette';
import { applyEvent } from '../core/reducer';
import { createIdFactory, createRng, hashString, type Rng } from '../core/random';
import type { Entity, EntityDraft, EntityId, Vec3, World, WorldEvent } from '../core/types';
import { buildWorldContext, type WorldContext } from './context';
import {
  ARCHETYPE_DEFAULTS,
  PROPOSAL_LIMITS as L,
  type Direction,
  type Placement,
  type ProposalOperation,
  type WorldProposal,
} from './schema';

/** World units moved per `move` step. */
export const MOVE_STEP = 2;
const NOTE_MAX = 200;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const DIRECTION_VECTORS: Readonly<Record<Direction, Vec3>> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  forward: [0, 0, -1],
  back: [0, 0, 1],
};

/** Machine-readable tag for pin-protection rejections (other rejections have none). */
export type RejectionRule = 'pinned' | 'pinned-ancestor' | 'pinned-parent';

export interface GuardRejection {
  readonly reason: string;
  readonly rule?: RejectionRule;
}

/**
 * Optional extra check per operation, run after the operation's events are
 * built and before they are dry-run. Returning a rejection rejects the whole
 * operation. `preview` is the world BEFORE this operation (earlier accepted
 * operations already applied).
 */
export type OperationGuard = (input: {
  readonly op: ProposalOperation;
  readonly index: number;
  readonly events: readonly WorldEvent[];
  readonly preview: World;
}) => GuardRejection | null;

export interface TranslateOptions {
  readonly guard?: OperationGuard;
}

export interface OperationOutcome {
  readonly index: number;
  readonly op: ProposalOperation['op'];
  readonly status: 'accepted' | 'rejected';
  readonly reason?: string;
  readonly rule?: RejectionRule;
  readonly eventCount: number;
  /** Entities created or targeted by this operation. */
  readonly entityIds: readonly EntityId[];
}

export interface Translation {
  /** Deterministic key for this proposal applied to this world state. */
  readonly proposalKey: string;
  /** `world.seq` the translation was computed against (stale-preview guard). */
  readonly baseSeq: number;
  /**
   * True only if EVERY operation was accepted. Proposals are all-or-nothing:
   * a proposal with any rejected operation cannot be applied.
   */
  readonly applicable: boolean;
  /** Events of accepted operations, in order. All have source 'director'. */
  readonly events: readonly WorldEvent[];
  readonly outcomes: readonly OperationOutcome[];
  readonly accepted: number;
  readonly rejected: number;
  /** The world after applying `events` (dry-run; nothing was dispatched). */
  readonly preview: World;
  /** Display-only fields; there is no world/renamed event yet. */
  readonly display: { readonly summary: string; readonly worldName?: string; readonly biome?: string };
}

export function translateProposal(world: World, proposal: WorldProposal, options: TranslateOptions = {}): Translation {
  const context = buildWorldContext(world);
  const key = proposalKey(world, proposal);
  const nextId = createIdFactory(`ai-${key}`);
  const note = clipText(`director ${key}: ${proposal.summary}`, NOTE_MAX);
  const events: WorldEvent[] = [];
  const outcomes: OperationOutcome[] = [];
  let preview = world;

  proposal.operations.forEach((op, index) => {
    const rng = createRng((hashString(`${key}:${index}`) ^ world.seed) >>> 0);
    const built = buildOperation(op, { preview, context, rng, nextId, note });
    if ('reason' in built) {
      outcomes.push({ index, op: op.op, status: 'rejected', reason: built.reason, ...(built.rule ? { rule: built.rule } : {}), eventCount: 0, entityIds: [] });
      return;
    }
    const guarded = options.guard?.({ op, index, events: built.events, preview }) ?? null;
    if (guarded) {
      outcomes.push({ index, op: op.op, status: 'rejected', reason: guarded.reason, ...(guarded.rule ? { rule: guarded.rule } : {}), eventCount: 0, entityIds: [] });
      return;
    }
    // Changes that would not alter anything are rejected so history stays clean.
    if (built.events.length > 0 && built.events.every((event) => isNoOp(preview, event))) {
      outcomes.push({ index, op: op.op, status: 'rejected', reason: 'No change.', eventCount: 0, entityIds: [] });
      return;
    }
    // Dry-run the whole operation; accept it only if every event applies.
    let simulated = preview;
    for (const event of built.events) {
      const result = applyEvent(simulated, event);
      if (!result.ok) {
        outcomes.push({ index, op: op.op, status: 'rejected', reason: result.reason, eventCount: 0, entityIds: [] });
        return;
      }
      simulated = result.world;
    }
    preview = simulated;
    events.push(...built.events);
    outcomes.push({ index, op: op.op, status: 'accepted', eventCount: built.events.length, entityIds: built.entityIds });
  });

  const accepted = outcomes.filter((o) => o.status === 'accepted').length;
  return {
    proposalKey: key,
    baseSeq: world.seq,
    applicable: accepted === outcomes.length && events.length > 0,
    events,
    outcomes,
    accepted,
    rejected: outcomes.length - accepted,
    preview,
    display: {
      summary: proposal.summary,
      ...(proposal.worldName ? { worldName: proposal.worldName } : {}),
      ...(proposal.biome ? { biome: proposal.biome } : {}),
    },
  };
}

/**
 * Same proposal + same world state → same key. Including `seq` means applying
 * the same proposal again later yields fresh, non-colliding entity IDs.
 */
export function proposalKey(world: World, proposal: WorldProposal): string {
  return `${hashString(canonicalJson(proposal)).toString(36)}-${world.seq.toString(36)}`;
}

/** JSON with sorted object keys, so key order in model output does not matter. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------- operations

interface BuildContext {
  readonly preview: World;
  readonly context: WorldContext;
  readonly rng: Rng;
  readonly nextId: (slug: string) => EntityId;
  readonly note: string;
}

type Built = { readonly events: WorldEvent[]; readonly entityIds: EntityId[] } | { readonly reason: string; readonly rule?: RejectionRule };

function buildOperation(op: ProposalOperation, ctx: BuildContext): Built {
  const base = { source: 'director' as const, note: ctx.note };

  if (op.op === 'add') {
    let target: Entity | undefined;
    if (op.target !== undefined) {
      const resolved = resolveTarget(op.target, ctx, false);
      if ('reason' in resolved) return resolved;
      target = resolved.entity;
    }
    const defaults = ARCHETYPE_DEFAULTS[op.archetype];
    const count = op.count ?? 1;
    if (ctx.preview.order.length + count > L.maxWorldEntities) {
      return { reason: `Adding ${count} would exceed the world limit of ${L.maxWorldEntities} entities.` };
    }
    const look = op.palette ? LUMINOUS_PALETTE.find((p) => p.name === op.palette) : undefined;
    let lights = ctx.preview.order.filter((id) => ctx.preview.entities[id]?.components.light).length;
    const baseAngle = ctx.rng.range(0, Math.PI * 2);
    const events: WorldEvent[] = [];
    const ids: EntityId[] = [];
    for (let i = 0; i < count; i++) {
      const id = freshId(ctx, op.archetype, ids);
      const { parentId, position } = layout(op.placement, ctx.rng, baseAngle, i, count, target);
      const light = defaults.light && lights < L.maxWorldLights ? defaults.light : undefined;
      if (light) lights += 1;
      const color = look?.color ?? defaults.color;
      const emissive = look?.emissive ?? defaults.emissive;
      const draft: EntityDraft = {
        id,
        name: numberedName(op.name, i, count),
        kind: defaults.kind,
        parentId,
        tags: ['director', op.archetype],
        pinned: false,
        components: {
          transform: { position, rotation: [0, round(ctx.rng.range(0, Math.PI * 2)), 0], scale: defaults.scale },
          visual: {
            archetype: op.archetype,
            color,
            emissive,
            emissiveIntensity: op.glow ?? defaults.emissiveIntensity,
            visible: true,
          },
          ...(light ? { light: { color: emissive, intensity: light.intensity, range: light.range } } : {}),
        },
      };
      events.push({ ...base, type: 'entity/added', entity: draft });
      ids.push(id);
    }
    return { events, entityIds: ids };
  }

  const resolved = resolveTarget(op.target, ctx, true);
  if ('reason' in resolved) return resolved;
  const { entity } = resolved;
  const id = entity.id;

  switch (op.op) {
    case 'remove':
      return { events: [{ ...base, type: 'entity/removed', id }], entityIds: [id] };
    case 'rename':
      return { events: [{ ...base, type: 'entity/renamed', id, name: op.name }], entityIds: [id] };
    case 'recolor': {
      const look = LUMINOUS_PALETTE.find((p) => p.name === op.palette);
      if (!look) return { reason: `Unknown palette "${op.palette}".` };
      return { events: [{ ...base, type: 'entity/visualChanged', id, patch: { color: look.color, emissive: look.emissive } }], entityIds: [id] };
    }
    case 'glow':
      return { events: [{ ...base, type: 'entity/visualChanged', id, patch: { emissiveIntensity: op.glow } }], entityIds: [id] };
    case 'show':
    case 'hide':
      return { events: [{ ...base, type: 'entity/visualChanged', id, patch: { visible: op.op === 'show' } }], entityIds: [id] };
    case 'move': {
      const d = DIRECTION_VECTORS[op.direction];
      const k = MOVE_STEP * (op.steps ?? 1);
      const p = entity.components.transform.position;
      const position: Vec3 = [round(p[0] + d[0] * k), round(p[1] + d[1] * k), round(p[2] + d[2] * k)];
      return { events: [{ ...base, type: 'entity/transformed', id, transform: { position } }], entityIds: [id] };
    }
  }
}

/**
 * Resolves a ref against the context built from the ORIGINAL world, then reads
 * the entity's current state from the preview (earlier operations may have
 * changed or removed it). Pinned entities are protected from Director changes.
 */
function resolveTarget(ref: string, ctx: BuildContext, mutating: boolean): { readonly entity: Entity } | { readonly reason: string; readonly rule?: RejectionRule } {
  const id = ctx.context.refs.get(ref);
  if (!id) return { reason: `Unknown entity ref "${ref}".` };
  const entity = ctx.preview.entities[id];
  if (!entity) return { reason: `Entity ${ref} no longer exists.` };
  if (mutating && entity.pinned) return { reason: `"${entity.name}" is pinned and protected from Director changes.`, rule: 'pinned' };
  return { entity };
}

/** Next factory ID that is not already used in the world or this operation. */
function freshId(ctx: BuildContext, slug: string, taken: readonly EntityId[]): EntityId {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = ctx.nextId(slug);
    if (!ctx.preview.entities[id] && !taken.includes(id)) return id;
  }
  throw new Error('Could not allocate a unique entity id.');
}

// ---------------------------------------------------------------- layout

interface Placed {
  readonly parentId: EntityId | null;
  readonly position: Vec3;
}

const RINGS: Readonly<Record<Exclude<Placement, 'on-target' | 'near-target'>, { r: [number, number]; y: [number, number] }>> = {
  center: { r: [2, 8], y: [0, 0] },
  'inner-ring': { r: [10, 18], y: [0, 6] },
  'outer-ring': { r: [28, 44], y: [-6, 8] },
  sky: { r: [6, 24], y: [14, 26] },
};

function layout(placement: Placement, rng: Rng, baseAngle: number, i: number, count: number, target: Entity | undefined): Placed {
  const angle = baseAngle + (i / count) * Math.PI * 2 + rng.range(-0.15, 0.15);
  if (placement === 'on-target' && target) {
    const s = target.components.transform.scale;
    const footprint = target.components.visual?.archetype === 'floatingIsland' ? 0.7 * Math.min(s[0], s[2]) : 2;
    const r = count === 1 ? rng.range(0, 0.3) * footprint : rng.range(0.35, 1) * footprint;
    return { parentId: target.id, position: [round(Math.cos(angle) * r), 0, round(Math.sin(angle) * r)] };
  }
  if (placement === 'near-target' && target) {
    const p = target.components.transform.position;
    const r = rng.range(5, 9);
    return { parentId: target.parentId, position: [round(p[0] + Math.cos(angle) * r), round(p[1]), round(p[2] + Math.sin(angle) * r)] };
  }
  const ring = RINGS[placement === 'on-target' || placement === 'near-target' ? 'center' : placement];
  const r = rng.range(ring.r[0], ring.r[1]);
  const y = ring.y[0] === ring.y[1] ? ring.y[0] : rng.range(ring.y[0], ring.y[1]);
  return { parentId: null, position: [round(Math.cos(angle) * r), round(y), round(Math.sin(angle) * r)] };
}

// ---------------------------------------------------------------- helpers

/**
 * True if a visual or transform patch sets only values the entity already has.
 * (The reducer already rejects no-op renames and pin changes itself.)
 */
function isNoOp(world: World, event: WorldEvent): boolean {
  if (event.type === 'entity/visualChanged') {
    const visual = world.entities[event.id]?.components.visual;
    if (!visual) return false;
    return Object.entries(event.patch).every(([key, value]) => visual[key as keyof typeof visual] === value);
  }
  if (event.type === 'entity/transformed') {
    const transform = world.entities[event.id]?.components.transform;
    if (!transform) return false;
    return Object.entries(event.transform).every(([key, value]) => {
      const current = transform[key as keyof typeof transform];
      return Array.isArray(value) && value.every((n, i) => n === current[i]);
    });
  }
  return false;
}

function numberedName(name: string, index: number, count: number): string {
  if (count === 1) return name;
  const suffix = ` ${ROMAN[index] ?? String(index + 1)}`;
  return `${clipText(name, L.maxNameLength - suffix.length).trimEnd()}${suffix}`;
}

/**
 * Truncates to at most `max` UTF-16 code units (the unit the reducer measures)
 * without splitting a surrogate pair.
 */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
