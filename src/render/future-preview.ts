import type { EntityId, World } from '../core/types';

/**
 * Parallel Futures renderer preview contract.
 *
 * A FuturePreview describes an alternative world state to show in the
 * renderer without mutating the canonical world. The renderer syncs the
 * future state (so it is always correct) and optionally animates changed,
 * non-pinned entities from the baseline to the future positions.
 *
 * Rules (mirroring World Transition):
 *   - World state is the truth: sync(future) runs first and stays correct
 *     with or without a transition.
 *   - Pinned entities are never animated.
 *   - Instant under prefers-reduced-motion or Performance quality mode.
 *   - Presentation only: never mutates World or dispatches events.
 *   - cancelFuture() snaps to the baseline world immediately.
 *   - No GPU resources survive the preview; dispose() cleans up.
 */
export interface FuturePreview {
  readonly kind: 'future';
  /** Canonical world state before the preview (what cancelFuture restores). */
  readonly baseline: World;
  /** Alternative world state to preview. */
  readonly future: World;
  /** Entity IDs whose transform or visibility differs between baseline and future. */
  readonly changed: readonly EntityId[];
  /** Entity IDs that must not be animated during the preview. */
  readonly pinned: readonly EntityId[];
  /** Maximum transition duration in milliseconds (1200). */
  readonly maxDurationMs: number;
}

/** Result of previewFuture: whether a preview is active and its future world. */
export interface FuturePreviewState {
  readonly active: boolean;
  readonly future: World | null;
}
