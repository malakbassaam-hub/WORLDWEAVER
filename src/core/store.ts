import { applyEvent, type ApplyResult } from './reducer';
import type { EntityId, World, WorldEvent } from './types';

/**
 * Append-only record of everything dispatched to the store, including
 * rejected events and undo/redo operations.
 *
 * This is the foundation the Causal Ledger (PLANNED) will build on; it is not
 * itself tamper-evident and does not yet record causal links.
 */
export interface LogEntry {
  readonly index: number;
  readonly kind: 'event' | 'undo' | 'redo';
  readonly event: WorldEvent | null;
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

/**
 * Holds the current world, an undo/redo snapshot history, and the event log.
 * Snapshots are cheap because the reducer shares unchanged entity objects.
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

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  dispatch(event: WorldEvent): ApplyResult {
    const before = this.present;
    const result = applyEvent(before, event);
    if (result.ok) {
      this.past.push(this.present);
      if (this.past.length > this.historyLimit) this.past.shift();
      this.future = [];
      this.present = result.world;
    }
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

  private append(entry: Omit<LogEntry, 'index' | 'worldSeq'>): void {
    this.log.push({ ...entry, index: this.log.length, worldSeq: this.present.seq });
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.present, this.log);
  }
}

function entityIdOf(event: WorldEvent): EntityId | null {
  return event.type === 'entity/added' ? event.entity.id : event.id;
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
