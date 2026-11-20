/**
 * Parallel Futures panel — pure view state (no DOM). Builds the side-by-side
 * comparison matrix and user-facing wording from the real futures API
 * (`src/core/futures.ts`). Nothing here changes a world.
 */
import { compareWorlds, FUTURE_LIMITS, type FutureErrorCode } from '../core/futures';
import type { FutureCard } from '../core/historyView';
import { pinClosure } from '../core/pins';
import type { EntityId, World } from '../core/types';
import { fieldLabel, formatValue, isHexColour } from './ledgerModel';

export const MAX_FUTURES = FUTURE_LIMITS.maxFutures;

export interface MatrixField {
  readonly field: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly afterColour?: string;
}

export type MatrixChange = 'same' | 'added' | 'removed' | 'changed' | 'derived';

export interface MatrixCell {
  readonly futureId: string;
  readonly change: MatrixChange;
  readonly fields: readonly MatrixField[];
}

export interface MatrixRow {
  readonly id: EntityId;
  readonly name: string;
  /** Present in the original world (false for entities added by a future). */
  readonly inOriginal: boolean;
  readonly pinned: boolean;
  /** Changed by more than one future, in different ways. */
  readonly contested: boolean;
  readonly cells: readonly MatrixCell[];
}

export interface MatrixColumn {
  readonly id: string;
  readonly label: string;
}

export interface ComparisonMatrix {
  readonly columns: readonly MatrixColumn[];
  readonly rows: readonly MatrixRow[];
  /** Number of entities identical in every future (not listed as rows). */
  readonly unchanged: number;
}

/**
 * Rows are every entity that differs from the original in at least one future
 * (directly or through a parent), in original world order, then additions in
 * future order. Each cell shows that future's change with before/after values.
 */
export function comparisonMatrix(original: World, futures: ReadonlyArray<{ readonly id: string; readonly label: string; readonly world: World }>): ComparisonMatrix {
  const pinned = new Set(pinClosure(original).pinned);
  const perFuture = futures.map((f) => {
    const c = compareWorlds(original, f.world);
    const direct = new Map(c.differences.map((d) => [d.id, d]));
    const derived = new Set(c.derived.map((d) => d.id));
    return { f, direct, derived };
  });
  const ids: EntityId[] = [];
  const seen = new Set<EntityId>();
  const consider = (id: EntityId) => {
    if (seen.has(id)) return;
    if (perFuture.some((p) => p.direct.has(id) || p.derived.has(id))) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const id of original.order) consider(id);
  for (const p of perFuture) for (const id of p.f.world.order) consider(id);

  const rows = ids.map((id): MatrixRow => {
    const cells = perFuture.map(({ f, direct, derived }): MatrixCell => {
      const d = direct.get(id);
      if (d) {
        return {
          futureId: f.id,
          change: d.change,
          fields: d.fields
            .filter((field) => field !== 'provenance')
            .map((field) => {
              const get = (w: World) => readField(w, id, field);
              const after = get(f.world);
              return { field, label: fieldLabel(field), before: formatValue(field, get(original), original), after: formatValue(field, after, f.world), ...(isHexColour(after) ? { afterColour: after } : {}) };
            }),
        };
      }
      return { futureId: f.id, change: derived.has(id) ? 'derived' : 'same', fields: [] };
    });
    const signatures = new Set(
      cells
        .filter((c) => c.change !== 'same' && c.change !== 'derived')
        .map((c) => `${c.change}:${c.fields.map((x) => `${x.field}=${x.after}`).join('|')}`),
    );
    const name = original.entities[id]?.name ?? futures.map((f) => f.world.entities[id]?.name).find(Boolean) ?? id;
    return { id, name, inOriginal: Boolean(original.entities[id]), pinned: pinned.has(id), contested: signatures.size > 1, cells };
  });
  return { columns: futures.map((f) => ({ id: f.id, label: f.label })), rows, unchanged: original.order.length - rows.filter((r) => r.inOriginal).length };
}

function readField(world: World, id: EntityId, field: string): unknown {
  const e = world.entities[id];
  if (!e) return undefined;
  const [head, tail] = field.split('.') as [string, string | undefined];
  if (head === 'transform') return e.components.transform[tail as 'position'];
  if (head === 'visual') return e.components.visual?.[tail as 'color'];
  if (head === 'light') return e.components.light;
  return (e as unknown as Record<string, unknown>)[head];
}

// ---------------------------------------------------------------- wording

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** First unused default label: "Future A" … "Future D". */
export function defaultFutureLabel(existing: readonly string[]): string {
  for (const l of LETTERS) if (!existing.includes(`Future ${l}`)) return `Future ${l}`;
  return `Future ${existing.length + 1}`;
}

export function createAvailability(openCount: number): { readonly ok: boolean; readonly reason: string | null } {
  return openCount >= MAX_FUTURES ? { ok: false, reason: `Four futures are open, the maximum. Apply or discard one to create another.` } : { ok: true, reason: null };
}

const FRIENDLY: Partial<Record<FutureErrorCode | string, string>> = {
  LIMIT: 'Limit reached.',
  STALE: 'The real world changed after this future was created.',
  PINNED: 'Pinned objects are protected.',
  REJECTED: 'The change was rejected by the world rules.',
  EMPTY: 'There is nothing to apply yet.',
  CLOSED: 'This future is already closed.',
  UNKNOWN_FUTURE: 'This future no longer exists.',
  UNVERIFIED: 'The world could not be verified for a safe fork.',
  INVALID: 'Invalid input.',
  MALFORMED: 'The change was malformed.',
  SOURCE: 'This future accepts changes from one source only.',
  NOT_APPLICABLE: 'The Director proposal cannot be applied.',
  INVALID_PROPOSAL: 'The Director response did not pass validation.',
  FUTURE_REFUSED: 'The future refused the change.',
  NO_FUTURE: 'This future no longer exists.',
  STALE_FUTURE: 'The future changed while the Director was working.',
  CANCELLED: 'Cancelled.',
  REQUEST_FAILED: 'The Director request failed.',
};

/** "<friendly headline> <specific reason>" for a refusal code. */
export function errorText(code: string, reason: string): string {
  const head = FRIENDLY[code];
  return head && !reason.startsWith(head) ? `${head} ${reason}` : reason;
}

/** One-line summary for a future card. */
export function cardSummary(card: FutureCard): string {
  const c = card.counts;
  const parts = [`${card.steps} step${card.steps === 1 ? '' : 's'}`];
  if (c.changed) parts.push(`${c.changed} changed`);
  if (c.added) parts.push(`${c.added} added`);
  if (c.removed) parts.push(`${c.removed} removed`);
  if (c.derived) parts.push(`${c.derived} derived`);
  return parts.join(' · ');
}
