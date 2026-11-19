/**
 * Living Characters — CONTRACT and safety boundary
 * (docs/architecture/LIVING_CHARACTERS.md).
 *
 * A character may SPEAK (a validated reply) and may PROPOSE world changes. A
 * proposal goes through exactly the same strict validator and translator as
 * any Director proposal and is returned for explicit user review. A character
 * can never apply changes, write to the store, or change its own memory
 * without a matching accepted log entry.
 *
 * NOT IMPLEMENTED: the character archetype (Kilo Code), the talk UI, the proxy
 * "character" task, persistence of memory (needs WW-016) and any model calls.
 */
import { fingerprint } from '../core/fingerprint';
import type { CausalLedgerView, LedgerEntry, LedgerEntryId } from '../core/ledger';
import type { LogEntry } from '../core/store';
import type { EntityId, World } from '../core/types';
import { translateProposal, type Translation } from './translate';
import { validateProposal, type ValidationIssue } from './validate';

export const CHARACTER_LIMITS = {
  maxReplyChars: 600,
  maxMemoryChars: 300,
  maxMemoriesInContext: 12,
} as const;

export interface CharacterPersona {
  readonly displayName: string;
  readonly traits: readonly string[];
}

export interface CharacterMemory {
  readonly id: string;
  readonly characterId: EntityId;
  readonly text: string;
  /** World seq of the accepted log entry this memory is about. */
  readonly causedBySeq: number;
}

export interface CharacterState {
  readonly characterId: EntityId;
  readonly persona: CharacterPersona;
  readonly memories: readonly CharacterMemory[];
}

/** Raw, untrusted character turn as it would come from the model. */
export interface RawCharacterTurn {
  readonly reply: unknown;
  readonly proposal?: unknown;
}

export type AdmittedTurn =
  | {
      readonly ok: true;
      readonly reply: string;
      /** For user review only. Never applied by this module. */
      readonly translation: Translation | null;
    }
  | { readonly ok: false; readonly errors: readonly ValidationIssue[] };

const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/;

function cleanText(value: unknown, max: number, path: string, errors: ValidationIssue[]): string | null {
  if (typeof value !== 'string') {
    errors.push({ path, code: 'invalid_type', message: 'Must be text.' });
    return null;
  }
  if (UNSAFE.test(value)) {
    errors.push({ path, code: 'invalid_string', message: 'Contains control or bidirectional-override characters.' });
    return null;
  }
  const text = value.normalize('NFC').trim();
  if (text.length === 0 || text.length > max) {
    errors.push({ path, code: 'out_of_range', message: `Must be 1 to ${max} characters.` });
    return null;
  }
  return text;
}

/** Validates a character turn. A proposal is validated and translated, never applied. */
export function admitCharacterTurn(world: World, turn: RawCharacterTurn): AdmittedTurn {
  const errors: ValidationIssue[] = [];
  const reply = cleanText(turn.reply, CHARACTER_LIMITS.maxReplyChars, 'reply', errors);
  let translation: Translation | null = null;
  if (turn.proposal !== undefined) {
    const v = validateProposal(turn.proposal);
    if (!v.ok) errors.push(...v.errors.map((e) => ({ ...e, path: e.path ? `proposal.${e.path}` : 'proposal' })));
    else translation = translateProposal(world, v.proposal);
  }
  if (errors.length > 0 || reply === null) return { ok: false, errors };
  return { ok: true, reply, translation };
}

/** A memory is admissible only if it refers to an accepted change in the log. */
export function validateMemory(memory: CharacterMemory, log: readonly LogEntry[]): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  cleanText(memory.text, CHARACTER_LIMITS.maxMemoryChars, 'text', errors);
  const grounded = log.some((e) => e.ok && (e.kind === 'event' || e.kind === 'batch') && e.worldSeq === memory.causedBySeq);
  if (!grounded) errors.push({ path: 'causedBySeq', code: 'invalid_ref', message: 'Memory must refer to an accepted change in the session log.' });
  return errors;
}

/** Most recent memories that fit the prompt context, newest last (ties broken by ID, so the order is deterministic). */
export function memoriesForContext(state: CharacterState, ledger?: Pick<CausalLedgerView, 'entries' | 'inEffect'>): CharacterMemory[] {
  const usable = ledger ? groundMemories(state, ledger).filter((g) => g.status === 'grounded').map((g) => g.memory) : [...state.memories];
  return usable.sort((a, b) => a.causedBySeq - b.causedBySeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(-CHARACTER_LIMITS.maxMemoriesInContext);
}

// ---------------------------------------------------------------- Causal Ledger, Futures and Morph compatibility

/**
 * How a memory relates to the recorded history:
 * - grounded: it refers to an applied change that is still in effect;
 * - undone:   the change was applied and later undone (or its redo was discarded);
 *             the character must not treat it as current fact;
 * - unknown:  no applied change entry ends at that seq (never valid).
 */
export interface GroundedMemory {
  readonly memory: CharacterMemory;
  readonly status: 'grounded' | 'undone' | 'unknown';
  readonly entryId: LedgerEntryId | null;
}

export function groundMemories(state: CharacterState, ledger: Pick<CausalLedgerView, 'entries' | 'inEffect'>): GroundedMemory[] {
  const live = new Set(ledger.inEffect);
  const bySeq = new Map<number, LedgerEntry>();
  for (const e of ledger.entries) if (e.accepted && (e.kind === 'event' || e.kind === 'batch')) bySeq.set(e.seqAfter, e);
  return state.memories.map((memory) => {
    const entry = bySeq.get(memory.causedBySeq);
    if (!entry) return { memory, status: 'unknown', entryId: null };
    return { memory, status: live.has(entry.index) ? 'grounded' : 'undone', entryId: entry.id };
  });
}

/**
 * Memories a character keeps inside a Parallel Future that was forked at
 * `baseSeq`: only grounded memories of changes made before the fork. Changes
 * made in the original world after the fork did not happen in that future.
 */
export function memoriesForFuture(state: CharacterState, ledger: Pick<CausalLedgerView, 'entries' | 'inEffect'>, baseSeq: number): CharacterMemory[] {
  return groundMemories(state, ledger)
    .filter((g) => g.status === 'grounded' && g.memory.causedBySeq <= baseSeq)
    .map((g) => g.memory);
}

/** Stable memory ID from its character, cause and text (same input, same ID). */
export function memoryId(characterId: EntityId, causedBySeq: number, text: string): string {
  return `mem-${fingerprint(`${characterId}\n${causedBySeq}\n${text.normalize('NFC').trim()}`)}`;
}

/** Entity kind used for characters (product.md §3: type = "character"). */
export const CHARACTER_KIND = 'character';

/**
 * Characters that a World Morph could restyle or move: every unpinned
 * character. The UI should warn before a morph; pinning a character protects
 * it under the approved WW-031 policy, like any other entity.
 */
export function charactersExposedToMorph(world: World): EntityId[] {
  return world.order.filter((id) => world.entities[id]?.kind === CHARACTER_KIND && !world.entities[id]?.pinned);
}
