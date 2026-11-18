/**
 * Extension contracts for PLANNED WORLDWEAVER systems.
 *
 * NOTHING in this file is implemented in Phase 1. These interfaces exist so
 * that future work plugs into the event-driven core instead of bypassing it.
 * Every future system must change the world ONLY by producing WorldEvents
 * that pass through the reducer, so replay, undo and provenance stay valid.
 */
import type { EntityId, World, WorldEvent } from './types';

/**
 * PLANNED (Phase 2): AI World Director backed by Gemini structured output.
 * Must run behind a server-side proxy; the API key never reaches the client.
 * Proposals are reviewed before being dispatched with source = 'director'.
 */
export interface WorldPlanner {
  propose(request: {
    readonly prompt: string;
    readonly world: World;
    /** Entities that must be preserved unchanged (World Morph). */
    readonly pinned: readonly EntityId[];
  }): Promise<PlanProposal>;
}

export interface PlanProposal {
  readonly summary: string;
  readonly events: readonly WorldEvent[];
  /** Model, prompt hash, timestamps: feeds the Causal Ledger. */
  readonly provenance: Readonly<Record<string, string>>;
}

/** PLANNED: World Morph. Transforms unpinned entities only. */
export interface WorldMorph {
  morph(world: World, instruction: string): Promise<readonly WorldEvent[]>;
}

/** PLANNED: Living Characters with persistent memory. */
export interface CharacterMemoryStore {
  recall(characterId: EntityId, limit: number): Promise<readonly string[]>;
  remember(characterId: EntityId, memory: string, causedBySeq: number): Promise<void>;
}

/** PLANNED: Parallel Futures. Branches share an ancestor snapshot. */
export interface BranchManager {
  fork(fromSeq: number, label: string): Promise<string>;
  list(): Promise<ReadonlyArray<{ readonly id: string; readonly label: string; readonly fromSeq: number }>>;
}

/** PLANNED: Causal Ledger. Tamper-evident, append-only, causally linked. */
export interface CausalLedger {
  append(entry: { readonly event: WorldEvent; readonly causes: readonly number[] }): Promise<number>;
  explain(entityId: EntityId): Promise<readonly string[]>;
}

/** PLANNED: Deterministic physics / simulation step, driven by seeds. */
export interface SimulationSystem {
  step(world: World, dtFixed: number, seed: number): readonly WorldEvent[];
}
