import type { EntityId } from '../core/types';

/**
 * Selection is UI state, not world state: it is never stored in the World,
 * never logged and never affects replay.
 */
export class SelectionModel {
  private current: EntityId | null = null;
  private readonly listeners = new Set<(id: EntityId | null) => void>();

  get(): EntityId | null {
    return this.current;
  }

  set(id: EntityId | null): void {
    if (id === this.current) return;
    this.current = id;
    for (const listener of this.listeners) listener(id);
  }

  subscribe(listener: (id: EntityId | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
