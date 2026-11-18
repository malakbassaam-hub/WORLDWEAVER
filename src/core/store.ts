import { applyEvent, applyEvents, type ApplyResult } from './reducer';
import type { EntityId, EventSource, World, WorldEvent } from './types';

/** Describes a batch: a group of events applied as one atomic, undoable step. */
export interface BatchMeta {
  /** Human-readable summary shown in the timeline. */
  readonly label: string;
  /** Every event in the batch must have this source. */
  readonly source: EventSource;
  /** Free-form string details (e.g. proposal key, mode, model). Never secrets or prompt text. */
  readonly details?: Readonly<Record<string, string>>;
}

/**
 * Append-only record of everything dispatched to the store, including
 * rejected events, batches and undo/redo operations.
 *
 * The log is the complete, replayable record of a session:
 * `replayLog(initial, log)` reproduces the live state exactly (see replay.ts).
 * It is the foundation the Causal Ledger (PLANNED) will build on; it is not
 * itself tamper-evident and does not yet record causal links.
 */
export interface LogEntry {
  readonly index: number;
  readonly kind: 'event' | 'batch' | 'undo' | 'redo';
  /** Set for kind 'event'. */
  readonly event: WorldEvent | null;
  /** Set for kind 'batch' (applied or rejected). */
  readonly events?: readonly WorldEvent[];
  readonly meta?: BatchMeta;
  readonly ok: boolean;
  readonly reason?: string;
  /** World seq after this entry was processed. */
  readonly worldSeq: number;
  /** Entity most relevant to this entry, if any. */
  readonly entityId: EntityId | null;
  readonly summary: string;
}

export type StoreListener = (world: World, log: readonly LogEntry[]) => void;

export interface WorldStoreOptions {
  /** Maximum undo depth. Older snapshots are discarded. */
  readonly historyLimit?: number;
}

export type BatchResult =
  | { readonly ok: true; readonly world: World }
  | { readonly ok: false; readonly world: World; readonly reason: string; readonly index: number | null };

/** Upper bound on events in one batch (a proposal adds at most 64 entities). */
export const MAX_BATCH_EVENTS = 1000;

/**
 * Holds the current world, an undo/redo snapshot history, and the event log.
 * Snapshots are cheap because the reducer shares unchanged entity objects.
 *
 * Sequencing rules:
 * - `World.seq` is a monotonic state counter. Every accepted event (including
 *   each event inside an accepted batch) and every undo/redo consumes one seq.
 *   A batch is one undo step regardless of how many events it contains.
 * - Undo/redo move through snapshot history; they are recorded in the log as
 *   their own entries and never synthesise events.
 * - Entity provenance always describes the change whose result is currently
 *   in effect: undo restores the earlier provenance with the earlier state.
 */
export class WorldStore {
  private present: World;
  private past: World[] = [];
  private future: World[] = [];
  private log: LogEntry[] = [];
  private readonly listeners = new Set<StoreListener>();
  private readonly historyLimit: number;

  constructor(initial: World, options: WorldStoreOptions = {}) {
    this.present = initial;
    this.historyLimit = Math.max(1, options.historyLimit ?? 200);
  }

  getState(): World {
    return this.present;
  }

  getLog(): readonly LogEntry[] {
    return this.log;
  }

  getHistoryLimit(): number {
    return this.historyLimit;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  dispatch(event: WorldEvent): ApplyResult {
    const before = this.present;
    const result = applyEvent(before, event);
    if (result.ok) this.commit(result.world);
    this.append({
      kind: 'event',
      event,
      ok: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
      entityId: entityIdOf(event),
      summary: describeEvent(event, before),
    });
    this.emit();
    return result;
  }

  /**
   * Applies events as ONE atomic step: all succeed or the world is unchanged.
   * A successful batch creates exactly one undo step and one log entry.
   */
  dispatchBatch(events: readonly WorldEvent[], meta: BatchMeta): BatchResult {
    const before = this.present;
    const reject = (reason: string, index: number | null): BatchResult => {
      this.append({
        kind: 'batch',
        event: null,
        events: [...events],
        meta,
        ok: false,
        reason,
        entityId: firstEntityId(events),
        summary: meta.label,
      });
      this.emit();
      return { ok: false, world: before, reason, index };
    };

    if (events.length === 0) return reject('A batch must contain at least one event.', null);
    if (events.length > MAX_BATCH_EVENTS) return reject(`A batch may contain at most ${MAX_BATCH_EVENTS} events.`, null);
    const foreign = events.findIndex((e) => e.source !== meta.source);
    if (foreign >= 0) return reject(`Event ${foreign + 1} has source "${events[foreign]?.source}", expected "${meta.source}".`, foreign);

    const result = applyEvents(before, events);
    if (!result.ok) return reject(`Event ${result.index + 1} of ${events.length} rejected: ${result.reason}`, result.index);

    // Each event keeps its own seq (provenance stamps refer to them), exactly
    // as in a dry-run preview; the batch is still ONE undo step.
    this.commit(result.world);
    this.append({
      kind: 'batch',
      event: null,
      events: [...events],
      meta,
      ok: true,
      entityId: firstEntityId(events),
      summary: meta.label,
    });
    this.emit();
    return { ok: true, world: this.present };
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.present);
    // Keep seq monotonic so every state the user sees has a unique seq.
    this.present = { ...previous, seq: this.present.seq + 1 };
    this.append({ kind: 'undo', event: null, ok: true, entityId: null, summary: 'Undo' });
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.present);
    this.present = { ...next, seq: this.present.seq + 1 };
    this.append({ kind: 'redo', event: null, ok: true, entityId: null, summary: 'Redo' });
    this.emit();
    return true;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(next: World): void {
    this.past.push(this.present);
    if (this.past.length > this.historyLimit) this.past.shift();
    this.future = [];
    this.present = next;
  }

  private append(entry: Omit<LogEntry, 'index' | 'worldSeq'>): void {
    this.log.push({ ...entry, index: this.log.length, worldSeq: this.present.seq });
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.present, this.log);
  }
}

function entityIdOf(event: WorldEvent): EntityId {
  return event.type === 'entity/added' ? event.entity.id : event.id;
}

function firstEntityId(events: readonly WorldEvent[]): EntityId | null {
  const first = events[0];
  return first ? entityIdOf(first) : null;
}

export function describeEvent(event: WorldEvent, world: World): string {
  const nameOf = (id: EntityId) => world.entities[id]?.name ?? id;
  switch (event.type) {
    case 'entity/added':
      return `Added ${event.entity.name}`;
    case 'entity/removed':
      return `Removed ${nameOf(event.id)}`;
    case 'entity/renamed':
      return `Renamed to ${event.name.trim()}`;
    case 'entity/transformed':
      return `Moved ${nameOf(event.id)}`;
    case 'entity/visualChanged': {
      const keys = Object.keys(event.patch);
      const what = keys.includes('visible')
        ? event.patch.visible
          ? 'Shown'
          : 'Hidden'
        : keys.includes('emissiveIntensity')
          ? 'Glow'
          : 'Recoloured';
      return `${what} ${nameOf(event.id)}`;
    }
    case 'entity/pinnedChanged':
      return `${event.pinned ? 'Pinned' : 'Unpinned'} ${nameOf(event.id)}`;
  }
}
