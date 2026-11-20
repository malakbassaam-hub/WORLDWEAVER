# Kilo Code → Kiro Integration Handoff: Renderer Preview API

Branch: `feature/renderer-futures-1120`
Commit: delivered on this branch (see `git log --oneline -1`)

This document specifies the renderer-side preview contract that Kilo Code
provides for Kiro's Parallel Futures UI (`src/ui/futures.ts`, Kiro-owned).
Kilo owns `src/render/**`. Kiro does not edit these files.

## 1. FuturePreview contract

File: `src/render/future-preview.ts` (new, Kilo-owned)

```ts
export interface FuturePreview {
  readonly kind: 'future';
  readonly baseline: World;        // canonical world before preview
  readonly future: World;          // alternative world to preview
  readonly changed: readonly EntityId[]; // entities differing baseline→future
  readonly pinned: readonly EntityId[];  // never animated
  readonly maxDurationMs: number;  // 1200 (WW-031 D-WM-4)
}
```

`changed` should be computed by the caller (Kiro's futures domain) as the set
of entity IDs whose transform, visual, or visibility differs between
`baseline` and `future`. `pinned` comes from `pinClosure(baseline).pinned`.

## 2. SceneRenderer API

File: `src/render/SceneRenderer.ts` (Kilo-owned)

### `previewFuture(preview: FuturePreview): Promise<void>`

Shows a Parallel Future in the renderer **without mutating the canonical
world**.

Behaviour:
1. `sync(preview.future)` runs first — the future state is always correct,
   with or without a transition.
2. If `prefers-reduced-motion` or Performance quality mode: instant, no
   animation.
3. Otherwise: animates changed, non-pinned entities from baseline positions
   to future positions using an ease-in-out-cubic over `maxDurationMs`
   (max 1200 ms).
4. Pinned entities are never animated.
5. Presentation only: never mutates `World`, never dispatches events.

### `cancelFuture(): void`

Stops a future preview at once and restores the canonical baseline world
exactly. Called on:
- user Cancel
- new edit / new preview
- WebGL context loss
- `dispose()`

After `cancelFuture()`, the frame matches `baseline`.

### `futurePreviewActive(): boolean`

Returns `true` while a future preview is active (tweens running or baseline
stored).

## 3. Integration wiring (Kiro's responsibility)

In `src/main.ts` (or wherever Kiro composes the futures UI):

```ts
import { SceneRenderer } from './render/SceneRenderer';
import type { FuturePreview } from './render/future-preview';

// Create the renderer once.
const renderer = new SceneRenderer(shell.viewport, callbacks, genesis.seed);

// To preview a future:
const preview: FuturePreview = {
  kind: 'future',
  baseline: currentWorld,
  future: alternativeWorld,
  changed: changedEntityIds,   // computed by Kiro's futures domain
  pinned: pinClosure(currentWorld).pinned,
  maxDurationMs: 1200,
};
await renderer.previewFuture(preview);

// To cancel / restore canonical:
renderer.cancelFuture();
```

## 4. Cancellation contract

| Trigger | Action |
|---|---|
| User clicks Cancel | `cancelFuture()` → snap to baseline |
| New edit starts | `cancelFuture()` → snap to baseline |
| New future preview | `cancelFuture()` → then `previewFuture(next)` |
| WebGL context lost | `cancelFuture()` (called by `rebuildResources()`) |
| Page dispose / unload | `cancelFuture()` (called by `dispose()`) |

## 5. WebGL recovery

`SceneRenderer.rebuildResources()` (called on `webglcontextrestored`) calls
`cancelTransition()` and `cancelFuture()`, then re-syncs `lastWorld`. Any
active future preview is cancelled and the canonical world is restored. The
future UI should re-submit its preview request after recovery.

## 6. Reduced motion / performance mode

Both `previewFuture` and `playTransition` (World Morph) are instant when:
- `window.matchMedia('(prefers-reduced-motion: reduce)').matches` is true, or
- `renderer.getQuality() === 'performance'`

No animation runs; `sync(future)` applies immediately.

## 7. No GPU resource leaks

- All tween state is cleared on completion, cancellation, or dispose.
- No new three.js materials, geometries, or textures are created during a
  preview. Only existing entity bindings are re-positioned.
- `dispose()` calls `cancelFuture()` and cleans up all renderer resources.

## 8. Browser test scenarios (Kilo-owned, `tests/e2e/`)

Existing e2e coverage that validates the renderer preview contract:

| Test | File | What it validates |
|---|---|---|
| WebGL context-loss recovery | `webgl-recovery.spec.ts` | `cancelFuture()` + `cancelTransition()` on context loss; viewport restores; selection/edits survive |
| Repeated loss/restore cycles | `webgl-recovery.spec.ts` | Recovery reliability across 3+ cycles |
| Performance modes | `performance.spec.ts` | Cinematic ↔ Performance toggle; no fallback |
| Morph transition | `director.spec.ts` (World Morph) | Same transition pattern as `previewFuture`: ≤1200 ms, pinned not animated |

There are no dedicated `tests/browser/**` renderer tests yet; the existing
`tests/e2e/` suite provides coverage.

## 9. Files requiring integration

| File | Change | Owner |
|---|---|---|
| `src/render/future-preview.ts` | New — FuturePreview interface | Kilo (done) |
| `src/render/SceneRenderer.ts` | Added `previewFuture`, `cancelFuture`, `futurePreviewActive` | Kilo (done) |
| `src/main.ts` | Wire `renderer.previewFuture`/`cancelFuture` to Kiro's futures UI | Kiro (pending) |
| `src/ui/futures.ts` | Kiro's futures UI component (not created yet) | Kiro (pending) |

## 10. What Kilo does NOT provide

- Kiro's Futures UI component (`src/ui/futures.ts`)
- Future domain logic (branching, comparison, rebase)
- Future persistence or snapshot storage
- Any changes to `src/core/**`, `src/director/**`, `src/ui/shell.ts`, or
  `playwright.config.ts`
