/**
 * Causal Ledger — REFERENCE PROJECTION (docs/architecture/CAUSAL_LEDGER.md).
 *
 * Derives ledger entries from the existing store log by replaying it. This is
 * NOT the production ledger: it is not persisted, not tamper-evident (no hash
 * chain yet) and has no UI. It exists to pin down the contract that World
 * Morph and later features must satisfy, and to test it.
 *
 * Causality is limited to RECORDED facts only:
 * - a user/system event is caused by its source;
 * - a Director batch is caused by its proposal (key, kind, mode, request id);
 * - an undo is caused by the user and reverses one specific earlier entry;
 * - a redo re-applies one specific earlier entry.
 * Effects are computed exactly by comparing the world before and after each
 * entry. Nothing is inferred (no "X happened because of Y" beyond this).
 */
import type { LogEntry } from './store';
import { WorldStore } from './store';
import type { EntityId, EventSource, World } from './types';

export type LedgerCause =
  | { readonly type: 'event'; readonly source: EventSource }
  | {
      readonly type: 'proposal';
      readonly source: EventSource;
      readonly proposalKey: string;
      readonly kind: string;
      readonly mode: string;
      readonly requestId?: string;
      readonly recordingId?: string;
    }
  | { readonly type: 'undo'; readonly reverses: number }
  | { readonly type: 'redo'; readonly reapplies: number };

export interface LedgerEffects {
  readonly added: readonly EntityId[];
  readonly removed: readonly EntityId[];
  readonly changed: readonly EntityId[];
}

export interface LedgerEntry {
  /** Index of the source log entry. */
  readonly index: number;
  readonly accepted: boolean;
  readonly summary: string;
  readonly seqBefore: number;
  readonly seqAfter: number;
  readonly cause: LedgerCause;
  /** Empty for rejected entries. */
  readonly effects: LedgerEffects;
}

const NONE: LedgerEffects = Object.freeze({ added: [], removed: [], changed: [] });

export function diffWorlds(before: World, after: World): LedgerEffects {
  const added: EntityId[] = [];
  const removed: EntityId[] = [];
  const changed: EntityId[] = [];
  for (const id of after.order) {
    const b = before.entities[id];
    if (!b) added.push(id);
    else if (b !== after.entities[id] && JSON.stringify(b) !== JSON.stringify(after.entities[id])) changed.push(id);
  }
  for (const id of before.order) if (!after.entities[id]) removed.push(id);
  return { added, removed, changed };
}

/**
 * Replays `log` from `initial` and derives one ledger entry per log entry.
 * Undo/redo targets are tracked with the same history rules as WorldStore.
 */
export function deriveLedgerEntries(initial: World, log: readonly LogEntry[], options: { historyLimit?: number } = {}): LedgerEntry[] {
  const store = new WorldStore(initial, options);
  const limit = store.getHistoryLimit();
  const past: number[] = []; // log indices of applied changes, mirrors the undo stack
  const future: number[] = [];
  const entries: LedgerEntry[] = [];

  log.forEach((entry, index) => {
    const before = store.getState();
    let ok = false;
    let cause: LedgerCause;
    switch (entry.kind) {
      case 'event':
        ok = entry.event ? store.dispatch(entry.event).ok : false;
        cause = { type: 'event', source: entry.event?.source ?? 'user' };
        break;
      case 'batch': {
        ok = entry.events && entry.meta ? store.dispatchBatch(entry.events, entry.meta).ok : false;
        const d = entry.meta?.details ?? {};
        cause = {
          type: 'proposal',
          source: entry.meta?.source ?? 'director',
          proposalKey: d.proposalKey ?? '',
          kind: d.kind ?? 'unspecified',
          mode: d.mode ?? 'unknown',
          ...(d.requestId ? { requestId: d.requestId } : {}),
          ...(d.recordingId ? { recordingId: d.recordingId } : {}),
        };
        break;
      }
      case 'undo': {
        const target = past.at(-1) ?? -1;
        ok = store.undo();
        cause = { type: 'undo', reverses: ok ? target : -1 };
        break;
      }
      case 'redo': {
        const target = future.at(-1) ?? -1;
        ok = store.redo();
        cause = { type: 'redo', reapplies: ok ? target : -1 };
        break;
      }
    }
    if (ok) {
      if (entry.kind === 'event' || entry.kind === 'batch') {
        past.push(index);
        if (past.length > limit) past.shift();
        future.length = 0;
      } else if (entry.kind === 'undo') {
        future.push(past.pop()!);
      } else {
        past.push(future.pop()!);
      }
    }
    const after = store.getState();
    entries.push({
      index,
      accepted: ok,
      summary: entry.summary,
      seqBefore: before.seq,
      seqAfter: after.seq,
      cause,
      effects: ok ? diffWorlds(before, after) : NONE,
    });
  });
  return entries;
}

/** Accepted entries whose effects touched `id`, oldest first. Recorded facts only. */
export function explainEntity(entries: readonly LedgerEntry[], id: EntityId): LedgerEntry[] {
  return entries.filter((e) => e.accepted && (e.effects.added.includes(id) || e.effects.removed.includes(id) || e.effects.changed.includes(id)));
}
