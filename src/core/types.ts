/**
 * WORLDWEAVER core world model.
 *
 * This module is renderer-agnostic and UI-agnostic. It must never import
 * three.js or touch the DOM. Rendering and UI observe World snapshots and
 * request changes exclusively by dispatching WorldEvents.
 */

/** Stable, opaque entity identifier. Never reused within a world. */
export type EntityId = string & { readonly __brand: 'EntityId' };

export const asEntityId = (value: string): EntityId => value as EntityId;

export type Vec3 = readonly [number, number, number];

/** sRGB hex colour, `#rrggbb`. */
export type ColorHex = `#${string}`;

export interface Transform {
  /** Position relative to the parent entity (or world origin). */
  readonly position: Vec3;
  /** Euler rotation in radians, XYZ order, relative to the parent. */
  readonly rotation: Vec3;
  /**
   * Scale of this entity's own visual body. Scale is intentionally NOT
   * inherited by child entities, so children keep their authored size.
   */
  readonly scale: Vec3;
}

/**
 * Visual description. `archetype` names a procedural recipe that a renderer
 * knows how to build; the core model does not know what it looks like.
 */
export interface VisualComponent {
  readonly archetype: string;
  readonly color: ColorHex;
  readonly emissive: ColorHex;
  readonly emissiveIntensity: number;
  readonly visible: boolean;
}

export interface LightComponent {
  readonly color: ColorHex;
  readonly intensity: number;
  readonly range: number;
}

export interface EntityComponents {
  readonly transform: Transform;
  readonly visual?: VisualComponent;
  readonly light?: LightComponent;
}

/**
 * Who caused a change.
 * - system:   deterministic world generation / engine bootstrap
 * - user:     direct manipulation in the studio
 * - director: RESERVED for the AI World Director (Gemini, PLANNED)
 */
export type EventSource = 'system' | 'user' | 'director';

/** Minimal provenance stamp. Full Causal Ledger provenance is PLANNED. */
export interface Provenance {
  readonly createdBy: EventSource;
  readonly createdAtSeq: number;
  readonly lastModifiedBy: EventSource;
  readonly lastModifiedSeq: number;
}

export interface Entity {
  readonly id: EntityId;
  readonly name: string;
  /** Semantic kind, e.g. "island", "structure", "crystal", "light". */
  readonly kind: string;
  readonly parentId: EntityId | null;
  readonly tags: readonly string[];
  /**
   * Pinned entities are protected. Phase 1 rule: pinned entities cannot be
   * removed. World Morph preservation of pinned entities is PLANNED.
   */
  readonly pinned: boolean;
  readonly components: EntityComponents;
  readonly provenance: Provenance;
}

/** Entity as supplied by an author, before provenance is stamped. */
export type EntityDraft = Omit<Entity, 'provenance'>;

export interface World {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly biome: string;
  /** Seed used by deterministic generators for this world. */
  readonly seed: number;
  /** Monotonic sequence number, incremented by every accepted change. */
  readonly seq: number;
  readonly entities: Readonly<Record<string, Entity>>;
  /** Insertion order. A parent always appears before its children. */
  readonly order: readonly EntityId[];
}

export type WorldEventBody =
  | { readonly type: 'entity/added'; readonly entity: EntityDraft }
  | { readonly type: 'entity/removed'; readonly id: EntityId }
  | { readonly type: 'entity/renamed'; readonly id: EntityId; readonly name: string }
  | {
      readonly type: 'entity/transformed';
      readonly id: EntityId;
      readonly transform: Partial<Transform>;
    }
  | {
      readonly type: 'entity/visualChanged';
      readonly id: EntityId;
      readonly patch: Partial<Omit<VisualComponent, 'archetype'>>;
    }
  | { readonly type: 'entity/pinnedChanged'; readonly id: EntityId; readonly pinned: boolean };

export type WorldEvent = WorldEventBody & {
  readonly source: EventSource;
  /** Optional human-readable reason, e.g. the prompt that caused it. */
  readonly note?: string;
};

export type WorldEventType = WorldEvent['type'];
