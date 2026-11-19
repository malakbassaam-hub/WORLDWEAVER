/**
 * View models for the Causal Ledger timeline and the Parallel Futures panel
 * (UI contract, docs/ledger-futures/UI_RENDERER_HANDOFF.md).
 *
 * Pure functions from domain state to plain, serialisable data. No DOM, no
 * three.js. The studio UI renders these; it never derives causality itself.
 * Not wired into the studio yet (`src/main.ts` and `src/ui/shell.ts` are
 * shared files; see the handoff document).
 */
import type { FutureComparison, FuturesComparison, FuturesManager, FutureId } from './futures';
import type { CausalLedgerView, DerivedConsequence, LedgerEntry, LedgerEntryId } from './ledger';
import { WorldStore, type LogEntry } from './store';
import type { EntityId, World } from './types';
import { checkLogEntryShape } from './wellformed';

// ---------------------------------------------------------------- timeline

export type TimelineBadge = 'User' | 'System' | 'Director' | 'Morph' | 'Future' | 'Undo' | 'Redo' | 'Rejected' | 'Malformed';

export interface TimelineItem {
  readonly entryId: LedgerEntryId;
  readonly index: number;
  readonly badge: TimelineBadge;
  readonly label: string;
  /** 'model' labels must be shown as model text (e.g. quoted, not as a fact). */
  readonly labelOrigin: LedgerEntry['summaryOrigin'];
  readonly mode: 'live' | 'recorded' | null;
  readonly status: LedgerEntry['status'];
  /** For change entries: whether the change is currently in effect. Null for undo/redo/rejected. */
  readonly inEffect: boolean | null;
  /** For undo/redo: the entry it reverses or re-applies. */
  readonly target: LedgerEntryId | null;
  readonly counts: { readonly added: number; readonly removed: number; readonly changed: number; readonly derived: number };
  readonly reason: string | null;
  readonly issues: number;
}

function badgeOf(e: LedgerEntry): TimelineBadge {
  if (e.status === 'malformed') return 'Malformed';
  if (e.status === 'rejected') return 'Rejected';
  switch (e.cause.type) {
    case 'undo':
      return 'Undo';
    case 'redo':
      return 'Redo';
    case 'future':
      return 'Future';
    case 'proposal':
      return e.cause.kind === 'morph' ? 'Morph' : 'Director';
    case 'event':
    case 'batch':
      return e.cause.source === 'system' ? 'System' : e.cause.source === 'director' ? 'Director' : 'User';
    default:
      return 'Malformed';
  }
}

/** One item per ledger entry, oldest first. */
export function timelineItems(view: CausalLedgerView): TimelineItem[] {
  const live = new Set(view.inEffect);
  return view.entries.map((e) => {
    const mode = e.cause.type === 'proposal' && (e.cause.mode === 'live' || e.cause.mode === 'recorded') ? e.cause.mode : null;
    const target = e.cause.type === 'undo' ? e.cause.reversesId : e.cause.type === 'redo' ? e.cause.reappliesId : null;
    return {
      entryId: e.id,
      index: e.index,
      badge: badgeOf(e),
      label: e.summary,
      labelOrigin: e.summaryOrigin,
      mode,
      status: e.status,
      inEffect: e.accepted && (e.kind === 'event' || e.kind === 'batch') ? live.has(e.index) : null,
      target,
      counts: { added: e.effects.added.length, removed: e.effects.removed.length, changed: e.effects.changed.length, derived: e.consequences.length },
      reason: e.reason ?? (e.status === 'malformed' ? (e.issues[0] ?? 'Malformed entry') : null),
      issues: e.issues.length,
    };
  });
}

// ---------------------------------------------------------------- inspection

export interface FieldValueChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface EntityInspection {
  readonly id: EntityId;
  readonly name: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly fields: readonly FieldValueChange[];
}

export interface EntryInspection {
  readonly entry: LedgerEntry;
  /** Worlds around the entry, materialised by replay (for before/after rendering). */
  readonly before: World;
  readonly after: World;
  /** OBSERVED changes with values. */
  readonly entities: readonly EntityInspection[];
  /** DERIVED consequences, with names; show separately from observed changes. */
  readonly derived: ReadonlyArray<DerivedConsequence & { readonly name: string; readonly viaName: string }>;
}

function fieldValue(world: World, id: EntityId, field: string): unknown {
  const e = world.entities[id];
  if (!e) return undefined;
  const [head, tail] = field.split('.') as [string, string | undefined];
  if (head === 'transform') return e.components.transform[tail as 'position'];
  if (head === 'visual') return e.components.visual?.[tail as 'color'];
  if (head === 'light') return e.components.light;
  return (e as unknown as Record<string, unknown>)[head];
}

/**
 * Before/after detail for one ledger entry. Replays the log up to the entry
 * (one replay per call; cache the result in the UI if needed). Returns null
 * for an index outside the ledger.
 */
export function inspectEntry(initial: World, log: readonly unknown[], view: CausalLedgerView, index: number, options: { historyLimit?: number } = {}): EntryInspection | null {
  const entry = view.entries[index];
  if (!entry) return null;
  const store = new WorldStore(initial, options);
  let before = initial;
  for (let i = 0; i <= index; i++) {
    before = store.getState();
    const raw = log[i];
    if (checkLogEntryShape(raw) !== null) continue;
    const e = raw as LogEntry;
    if (e.kind === 'event') store.dispatch(e.event!);
    else if (e.kind === 'batch') store.dispatchBatch(e.events!, e.meta!);
    else if (e.kind === 'undo') store.undo();
    else store.redo();
  }
  const after = store.getState();
  const nameIn = (id: EntityId) => (after.entities[id] ?? before.entities[id])?.name ?? id;
  return {
    entry,
    before,
    after,
    entities: entry.changes.map((c) => ({
      id: c.id,
      name: nameIn(c.id),
      change: c.change,
      fields: c.fields.map((field) => ({ field, before: fieldValue(before, c.id, field), after: fieldValue(after, c.id, field) })),
    })),
    derived: entry.consequences.map((d) => ({ ...d, name: nameIn(d.id), viaName: nameIn(d.via) })),
  };
}

// ---------------------------------------------------------------- futures panel

export interface FutureCard {
  readonly id: FutureId;
  readonly label: string;
  readonly steps: number;
  readonly counts: { readonly added: number; readonly removed: number; readonly changed: number; readonly derived: number };
  /** Entities this future changes that another open future changes differently. */
  readonly contested: readonly EntityId[];
  readonly stale: boolean;
  readonly fromSnapshot: boolean;
  readonly canCommit: boolean;
  /** Why it cannot be committed (shown next to the disabled button), or null. */
  readonly blockedReason: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

function card(c: FutureComparison, contested: ReadonlySet<EntityId>): FutureCard {
  const f = c.future;
  const blockedReason =
    f.eventCount === 0 ? 'No changes yet.'
    : f.stale ? (f.fromSnapshot ? 'Started from an earlier snapshot. Rebase onto the current world to apply it.' : 'The world changed since this future was created. Rebase or discard it.')
    : c.violations.length > 0 ? c.violations.map((v) => v.message).join(' ')
    : null;
  return {
    id: f.id,
    label: f.label,
    steps: f.steps.length,
    counts: { added: c.comparison.added.length, removed: c.comparison.removed.length, changed: c.comparison.changed.length, derived: c.comparison.derived.length },
    contested: c.comparison.differences.map((d) => d.id).filter((id) => contested.has(id)),
    stale: f.stale,
    fromSnapshot: f.fromSnapshot,
    canCommit: blockedReason === null,
    blockedReason,
    canUndo: f.canUndo,
    canRedo: f.canRedo,
  };
}

/** Cards for every open future, in creation order. */
export function futureCards(all: FuturesComparison): FutureCard[] {
  const contested = new Set(all.contested);
  return all.futures.map((c) => card(c, contested));
}

/** Convenience: cards straight from a manager. */
export function futureCardsOf(manager: FuturesManager): FutureCard[] {
  return futureCards(manager.compareAll());
}
