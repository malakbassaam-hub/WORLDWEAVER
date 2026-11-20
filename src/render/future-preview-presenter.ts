/**
 * Future preview presenter adapter.
 *
 * Bridges Kiro's `FuturePreviewPresenter` contract (src/core/presentation.ts)
 * to Kilo's SceneRenderer renderer-side preview API (src/render/SceneRenderer.ts,
 * src/render/future-preview.ts).
 *
 * The adapter converts the presentation-level FuturePreview (kind: 'future-preview')
 * into the renderer-level FuturePreview (kind: 'future') understood by
 * SceneRenderer.previewFuture/cancelFuture. It never mutates a World or
 * dispatches events; all world changes stay in the store until Apply.
 */
import type { FuturePreview as PresentationFuturePreview } from '../core/presentation';
import type { FuturePreview as RendererFuturePreview } from './future-preview';
import { SceneRenderer } from './SceneRenderer';

/** Maximum transition duration for a future preview (WW-031 D-WM-4, 1200 ms). */
const MAX_FUTURE_PREVIEW_MS = 1200;

/**
 * Converts a presentation FuturePreview into a renderer FuturePreview.
 * The renderer only needs baseline, future, changed and pinned positions;
 * futureId, label, added, removed, derived and stale are UI concerns.
 */
function toRendererPreview(p: PresentationFuturePreview): RendererFuturePreview {
  return {
    kind: 'future',
    baseline: p.base,
    future: p.preview,
    changed: p.changed,
    pinned: p.pinned,
    maxDurationMs: MAX_FUTURE_PREVIEW_MS,
  };
}

/**
 * SceneRenderer-backed FuturePreviewPresenter.
 *
 *   show(preview): syncs the future world into the viewport (always correct),
   *   then animates changed non-pinned entities from baseline to future over
   *   at most 1200 ms. Instant under reduced motion or performance mode.
   *   Pinned entities are never animated.
   * clear(): restores the canonical baseline world immediately.
 */
export class SceneRendererFuturePreviewPresenter {
  constructor(private readonly renderer: SceneRenderer) {}

  /** Display a future in the viewport without mutating the canonical world. */
  show(preview: PresentationFuturePreview): void {
    void this.renderer.previewFuture(toRendererPreview(preview));
  }

  /** Stop any preview and restore the live world exactly. */
  clear(): void {
    this.renderer.cancelFuture();
  }
}
