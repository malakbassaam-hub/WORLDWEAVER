import type { WorldStore } from '../core/store';
import type { EntityId, VisualComponent, WorldEventBody } from '../core/types';
import type { SelectionModel } from './selection';

/**
 * The single surface UI panels use to act. Panels never touch the store or
 * renderer directly, which keeps them swappable by a separate UI effort.
 */
export interface StudioActions {
  readonly store: WorldStore;
  readonly selection: SelectionModel;
  /** Dispatches a user edit. Returns false (and shows the reason) if rejected. */
  edit(event: WorldEventBody): boolean;
  undo(): void;
  redo(): void;
  select(id: EntityId | null): void;
  focus(id: EntityId): void;
  resetCamera(): void;
  preview(id: EntityId, visual: VisualComponent): void;
  revertPreview(id: EntityId): void;
  notify(message: string, tone?: 'info' | 'warn'): void;
  /** Collapse/expand a panel. */
  togglePanel?(side: 'left' | 'right' | 'bottom'): void;
}
