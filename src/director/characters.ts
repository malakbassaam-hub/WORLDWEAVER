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

/** Most recent memories that fit the prompt context, newest last. */
export function memoriesForContext(state: CharacterState): CharacterMemory[] {
  return [...state.memories].sort((a, b) => a.causedBySeq - b.causedBySeq).slice(-CHARACTER_LIMITS.maxMemoriesInContext);
}
