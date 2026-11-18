/**
 * World Proposal schema v2 — the only shape the AI World Director accepts.
 *
 * The model describes INTENT (operations, placement, palette names). It never
 * supplies entity IDs, coordinates, colours as raw values, or code. The client
 * translator turns a validated proposal into ordinary WorldEvents, so applied
 * proposals replay deterministically without calling the model again.
 */
import { LUMINOUS_PALETTE, type PaletteName } from '../core/palette';
import { NAME_MAX_LENGTH } from '../core/reducer';
import type { ColorHex, Vec3 } from '../core/types';

export const PROPOSAL_SCHEMA_VERSION = 2;

export const PROPOSAL_LIMITS = {
  /** Raw response text, UTF-8 bytes, checked before JSON parsing. */
  maxRawBytes: 64 * 1024,
  maxOperations: 24,
  /** Copies created by a single `add` operation. */
  maxAddCount: 8,
  /** Entities created by one proposal (sum of all `add` counts). */
  maxAddedPerProposal: 64,
  /** World size after applying a proposal. */
  maxWorldEntities: 200,
  /** Point lights created by proposals stop being added beyond this world total. */
  maxWorldLights: 6,
  maxSummaryLength: 280,
  maxNameLength: NAME_MAX_LENGTH,
  maxTextLength: 120,
  minGlow: 0,
  maxGlow: 10,
  maxMoveSteps: 5,
  /** Validation stops collecting after this many issues. */
  maxReportedIssues: 50,
} as const;

export const ARCHETYPES = [
  'floatingIsland',
  'crystalSpire',
  'crystalCluster',
  'crystalCitadel',
  'arcaneRing',
  'lightOrb',
  'obelisk',
] as const;
export type ProposalArchetype = (typeof ARCHETYPES)[number];

export const PLACEMENTS = ['center', 'inner-ring', 'outer-ring', 'sky', 'on-target', 'near-target'] as const;
export type Placement = (typeof PLACEMENTS)[number];
export const TARGETED_PLACEMENTS: ReadonlySet<Placement> = new Set(['on-target', 'near-target']);

export const DIRECTIONS = ['up', 'down', 'left', 'right', 'forward', 'back'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const PALETTE_NAMES = LUMINOUS_PALETTE.map((p) => p.name) as readonly PaletteName[];

export const OPERATION_TYPES = ['add', 'remove', 'rename', 'recolor', 'glow', 'move', 'show', 'hide'] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/** Entity references are short aliases (e1, e2, …) from the world context, never raw IDs. */
export const REF_PATTERN = /^e[1-9][0-9]{0,3}$/;

// ---------------------------------------------------------------- types

export type ProposalOperation =
  | {
      readonly op: 'add';
      readonly archetype: ProposalArchetype;
      readonly name: string;
      readonly count?: number;
      readonly placement: Placement;
      readonly target?: string;
      readonly palette?: PaletteName;
      readonly glow?: number;
    }
  | { readonly op: 'remove'; readonly target: string }
  | { readonly op: 'rename'; readonly target: string; readonly name: string }
  | { readonly op: 'recolor'; readonly target: string; readonly palette: PaletteName }
  | { readonly op: 'glow'; readonly target: string; readonly glow: number }
  | { readonly op: 'move'; readonly target: string; readonly direction: Direction; readonly steps?: number }
  | { readonly op: 'show'; readonly target: string }
  | { readonly op: 'hide'; readonly target: string };

export interface WorldProposal {
  readonly summary: string;
  readonly worldName?: string;
  readonly biome?: string;
  readonly operations: readonly ProposalOperation[];
}

/** Allowed keys per operation (strict: anything else is rejected). */
export const OPERATION_KEYS: Readonly<Record<OperationType, { required: readonly string[]; optional: readonly string[] }>> = {
  add: { required: ['op', 'archetype', 'name', 'placement'], optional: ['count', 'target', 'palette', 'glow'] },
  remove: { required: ['op', 'target'], optional: [] },
  rename: { required: ['op', 'target', 'name'], optional: [] },
  recolor: { required: ['op', 'target', 'palette'], optional: [] },
  glow: { required: ['op', 'target', 'glow'], optional: [] },
  move: { required: ['op', 'target', 'direction'], optional: ['steps'] },
  show: { required: ['op', 'target'], optional: [] },
  hide: { required: ['op', 'target'], optional: [] },
};

export const PROPOSAL_KEYS = { required: ['summary', 'operations'], optional: ['worldName', 'biome'] } as const;

// ---------------------------------------------------------------- archetype defaults

export interface ArchetypeDefaults {
  readonly kind: string;
  readonly scale: Vec3;
  readonly color: ColorHex;
  readonly emissive: ColorHex;
  readonly emissiveIntensity: number;
  /** Maximum copies of this archetype in one `add` (performance budget). */
  readonly maxCount: number;
  readonly light?: { readonly intensity: number; readonly range: number };
}

/** Mirrors the look of the Crystal Kingdom so AI additions match the scene. */
export const ARCHETYPE_DEFAULTS: Readonly<Record<ProposalArchetype, ArchetypeDefaults>> = {
  floatingIsland: { kind: 'island', scale: [6, 5, 6], color: '#352f5c', emissive: '#24194f', emissiveIntensity: 0.12, maxCount: 3 },
  crystalSpire: { kind: 'crystal', scale: [1, 1, 1], color: '#7fe8ff', emissive: '#2fd4ff', emissiveIntensity: 1.8, maxCount: 8 },
  crystalCluster: { kind: 'crystal', scale: [1.6, 1.8, 1.6], color: '#8cf0ff', emissive: '#30d8ff', emissiveIntensity: 1.6, maxCount: 8 },
  crystalCitadel: { kind: 'structure', scale: [1, 1, 1], color: '#7fe8ff', emissive: '#38d9ff', emissiveIntensity: 2.4, maxCount: 1 },
  arcaneRing: { kind: 'structure', scale: [1, 1, 1], color: '#c9a6ff', emissive: '#a970ff', emissiveIntensity: 3.2, maxCount: 2 },
  lightOrb: { kind: 'light', scale: [0.9, 0.9, 0.9], color: '#5fe6ff', emissive: '#5fe6ff', emissiveIntensity: 4, maxCount: 4, light: { intensity: 90, range: 28 } },
  obelisk: { kind: 'structure', scale: [1, 1, 1], color: '#141226', emissive: '#40e0ff', emissiveIntensity: 1.2, maxCount: 4 },
};

// ---------------------------------------------------------------- Gemini responseSchema

/**
 * Sent to Gemini as `generationConfig.responseSchema` (OpenAPI subset, the same
 * dialect the Phase 1 preflight verified). Gemini cannot express "no extra
 * properties" or per-operation required fields; `validateProposal` enforces
 * those, so this schema only guides generation.
 */
export const PROPOSAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One sentence describing the change.' },
    worldName: { type: 'string' },
    biome: { type: 'string' },
    operations: {
      type: 'array',
      description: `1 to ${PROPOSAL_LIMITS.maxOperations} operations.`,
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: [...OPERATION_TYPES] },
          target: { type: 'string', description: 'Entity ref from the world context, e.g. e7.' },
          name: { type: 'string' },
          archetype: { type: 'string', enum: [...ARCHETYPES] },
          count: { type: 'integer', description: `1 to ${PROPOSAL_LIMITS.maxAddCount}.` },
          placement: { type: 'string', enum: [...PLACEMENTS] },
          palette: { type: 'string', enum: [...PALETTE_NAMES] },
          glow: { type: 'number', description: `${PROPOSAL_LIMITS.minGlow} to ${PROPOSAL_LIMITS.maxGlow}.` },
          direction: { type: 'string', enum: [...DIRECTIONS] },
          steps: { type: 'integer', description: `1 to ${PROPOSAL_LIMITS.maxMoveSteps}.` },
        },
        required: ['op'],
      },
    },
  },
  required: ['summary', 'operations'],
} as const;
