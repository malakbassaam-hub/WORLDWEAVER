# World Morph — Handoff to Kilo Code

From Kiro, 2026-11-18. Branch `phase3/world-morph` (from `phase2/director` at
`3139171`). Nothing here has been merged anywhere. Kiro did not modify
`src/main.ts`, `src/ui/shell.ts`, `src/render/**`, `playwright.config.ts`,
`package.json`, `package-lock.json` or `.gitignore`.

## 1. Merge order (needs Malak's approval)

1. Finish and green the Phase 2 + WebGL integration branch (WW-030).
2. Merge `phase3/world-morph` into that integration branch, or rebase it onto
   it. Expected conflicts: **none in shared files**, because this branch does
   not touch them. It changes Kiro-owned files that Phase 2 also introduced
   (`src/director/*`, `server/director/*`); those exist only on Phase 2 lines,
   so the merge should be clean, but verify with
   `git merge-tree --write-tree <integration> origin/phase3/world-morph`.
3. On the merged branch, run `npm run typecheck`, `npm test` (expect at least
   289 unit tests) and `npm run build`, then the browser suites.

## 2. Integration hooks (shared files, not done by Kiro)

### 2a. Renderer presenter (Kilo, `src/render/**`)

Implement the contract in `src/core/presentation.ts`:

```ts
import type { TransitionPresenter, WorldTransition } from '../core/presentation';

// e.g. on SceneRenderer, or a small adapter object
playTransition(t: WorldTransition): Promise<void>;  // presentation only
cancelTransition(): void;                           // snap to t.after now
```

Rules: `sync(after)` has already run and stays the truth; animate only
`t.changed`, never `t.pinned`; finish within `t.maxDurationMs` (1200 ms);
after `cancelTransition()` the next frame equals `after`; no GPU resources
outlive the transition; `dispose()` during a transition is safe.

### 2b. Studio wiring (`src/main.ts`, after WW-031 approval)

```ts
import { buildMorphTransition, createTransitionCoordinator } from './core/presentation';
import { pinClosure } from './director/morph';

const MORPH_ENABLED = false; // flip only after WW-031 is approved

const director = new DirectorController({
  store,
  request: (body, signal) => requestProposal(body, { signal }),
  health: (signal) => fetchHealth({ signal }),
  morph: { enabled: MORPH_ENABLED },
});

const transitions = createTransitionCoordinator(renderer ? { play: (t) => renderer!.playTransition(t), cancel: () => renderer!.cancelTransition() } : null, {
  reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  performanceMode: () => renderer?.getQuality() === 'performance',
});

let previous = store.getState();
store.subscribe((world, log) => {
  const entry = log.at(-1);
  if (entry?.kind === 'batch' && entry.ok && entry.meta?.details?.kind === 'morph' && entry.events) {
    void transitions.play(buildMorphTransition(previous, world, entry.events, pinClosure(previous).pinned));
  } else {
    transitions.cancel(); // undo, redo, any edit or rejected entry
  }
  previous = world;
});
// also call transitions.cancel() on context loss and in the HMR/dispose teardown
```

The existing `render()` subscriber must keep running first or alongside, so
`renderer.sync(world)` happens regardless of the transition.

### 2c. Server flag for the browser suite (`playwright.config.ts`)

To test World Morph in recorded mode, add `DIRECTOR_MORPH: '1'` to the
`webServer.env` of the browser config. It is off by default everywhere else.

## 3. Browser acceptance tests to add (WM-06)

Run in recorded mode with `DIRECTOR_MORPH=1`, once the Morph task exists in the
UI:

1. Pin an extra entity, run `morph-violet-dusk`, Apply. Pinned entities keep
   name, palette, position and visibility in the inspector; others changed.
2. One Ctrl+Z restores the whole morph; Ctrl+Shift+Z re-applies it.
3. `morph-shift-isle` (prompt "lift the isle"): the preview shows a reason
   naming “Isle of Aurelion” and “Aurelion Citadel”; Apply is disabled; the
   world is unchanged.
4. Cancel during a morph: the late response is ignored.
5. Stale preview after a manual edit → Refresh → Apply.
6. With the renderer transition: the final frame equals the preview; undo
   during the transition snaps correctly.
7. Reduced motion: instant.
8. Console clean; context loss during a transition recovers (WW-001).

## 4. What Kiro still owns and will do next

- Morph task in `src/ui/director.ts` and its styles (after WW-031).
- One live morph case in `tests/live` (the 9th request; after the WW-025 review).
- Register and schedule updates, once the shared documents are not being
  edited elsewhere ([REGISTER_AND_SCHEDULE_DELTA.md](REGISTER_AND_SCHEDULE_DELTA.md)).
