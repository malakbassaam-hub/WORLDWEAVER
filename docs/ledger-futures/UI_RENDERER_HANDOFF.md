# Causal Ledger and Parallel Futures — UI and Renderer Handoff

From Kiro, 2026-11-19. Branch `phase4/ledger-futures`. All types below are in
`src/core/` and are pure (no DOM, no three.js). Kiro did not modify
`src/main.ts`, `src/ui/shell.ts`, `src/render/**`, `playwright.config.ts`,
`package.json`, `package-lock.json` or `.gitignore`.

**Domain logic is implemented and tested. The UI and the renderer preview are
not.**

## 1. Merge order (needs Malak's approval)

1. The Phase 2 + WebGL integration branch is green (WW-030).
2. Merge `phase3/world-morph`, then `phase4/ledger-futures` (it contains
   phase 3). A trial merge of this branch into `phase1.5/integration-qa`
   (`bcf39c1`) had no conflicts and passed type check, 364 unit tests and the
   build.
3. Kilo is integrating World Morph in `phase1.5/morph-integration`. If that
   branch already contains `phase3/world-morph`, merging `phase4` adds only
   the commits after `b9f3741`. Check with
   `git merge-tree --write-tree <branch> origin/phase4/ledger-futures`.

## 2. Studio wiring (`src/main.ts`, shared file)

```ts
import { createLedgerRecorder } from './core/ledger';
import { createFuturesManager } from './core/futures';
import { timelineItems, futureCardsOf, inspectEntry } from './core/historyView';
import { buildFuturePreview } from './core/presentation';
import { proposeInFuture } from './director/futures';

const initial = buildCrystalKingdom();          // the world the store started from
const store = new WorldStore(initial);
const ledger = createLedgerRecorder(initial, store);   // live, no replay per change
const futures = createFuturesManager(store, initial);

let previewing: string | null = null;
store.subscribe(() => {
  if (previewing) { renderer?.clearFuturePreview(); previewing = null; } // rule P2
  ui.timeline.render(timelineItems(ledger.view()));
  ui.futures.render(futureCardsOf(futures));
});
// On context restore: if (previewing) renderer.showFuturePreview(buildFuturePreview(futures, previewing)!)
// On dispose/HMR: ledger.dispose(); futures.dispose(); renderer?.clearFuturePreview();
```

The existing timeline reads `store.getLog()`. It can switch to
`timelineItems()` when the ledger UI is built. The two must not be shown side
by side with different numbering.

## 3. Causal Ledger UI

### Data: `TimelineItem` (`timelineItems(view)`)

| Field | Use |
|---|---|
| `entryId`, `index` | Stable key; show `#index` |
| `badge` | `User`, `System`, `Director`, `Morph`, `Future`, `Undo`, `Redo`, `Rejected`, `Malformed` |
| `label`, `labelOrigin` | If `labelOrigin === 'model'`, show the label as model text (for example in quotes with a "Director said" style), never as a statement of fact |
| `mode` | `recorded` must show the existing "Recorded" badge |
| `inEffect` | `false` = undone: dim the row and mark it "Undone" |
| `target` | For undo/redo: link to the reversed or re-applied entry |
| `counts` | Added, removed, changed; `derived` separately ("also moved 6 child objects") |
| `reason`, `issues` | Rejected or malformed reason; issues > 0 shows a warning icon |

### Event inspection: `inspectEntry(initial, store.getLog(), view, index)`

Returns `before` and `after` worlds (for a before/after viewport), the
`entities` that changed with `{ field, before, after }` values, and the
`derived` consequences with names. **Show observed changes and derived
consequences in separate sections.** Label the derived section "Changed
through a parent (derived)".

### Entity history

`traceEntity(ledger.view(), entityId)` lists `direct` and `derived` steps,
each with `inEffect`. In the inspector: "History of <name>".

### States

| State | Display |
|---|---|
| Empty ledger | "No changes yet." |
| `view.consistent === false` | Banner: "The history has integrity issues" with the list of `view.issues` |
| `verifyLedgerChain(view).ok === false` | Banner: "History record is damaged at entry N" (only relevant once persisted) |
| Model text | Never shown with `innerHTML`; always `textContent` |

## 4. Parallel Futures UI

### Data: `FutureCard` (`futureCardsOf(futures)`)

| Field | Use |
|---|---|
| `label`, `steps`, `counts` | Card summary |
| `contested` | Entities that other futures change differently: mark them in the list |
| `stale`, `fromSnapshot` | Stale warning, "Rebase" button |
| `canCommit`, `blockedReason` | Enable or disable "Apply this future"; show the reason next to it |
| `canUndo`, `canRedo` | Per-future undo and redo buttons |

### Actions

| Action | Call | On failure |
|---|---|---|
| New future | `futures.fork(label, { source: 'director' })` (or `'user'` for hand edits) | Show `reason`; `LIMIT` means four are open |
| Ask the Director inside a future | `proposeInFuture(futures, id, rawProposal, { kind: 'morph' or 'edit', mode })` | Show `reason` (pin rejections name both entities) |
| Hand edit inside a future | `futures.apply(id, events, { label })` | Show `reason` |
| Preview | `renderer.showFuturePreview(buildFuturePreview(futures, id))` | — |
| Back to the real world | `renderer.clearFuturePreview()` (the world was never changed) | — |
| Apply this future | `futures.commit(id)` (one undo step) | `STALE`: offer Rebase; `PINNED`: list violations |
| Rebase | `futures.rebase(id)` | Show reason; the future is unchanged |
| Discard | `futures.discard(id)` | — |

**Preview is not commit.** The UI must make the difference visible: a
persistent "Previewing future: <label>. The real world is unchanged" bar with
"Back to the real world" and "Apply this future" buttons.

## 5. Renderer contract (Kilo, `src/render/**`)

Implement `FuturePreviewPresenter` from `src/core/presentation.ts`:

```ts
showFuturePreview(p: FuturePreview): void;   // display p.preview instead of the live world
clearFuturePreview(): void;                  // show the live world again, exactly
```

Rules:

- **P1. Display only:** never mutate a World or dispatch events.
- **P2. Clear on change:** the studio calls `clear` on commit, discard, any
  store change, undo/redo, context loss and dispose.
- **P3. Context restore:** after a WebGL context restore, the studio calls
  `show` again; do not depend on cached GPU state.
- **P4. Pinned entities** (`p.pinned`) are identical in base and preview; never
  highlight them as changed.
- **P5. Highlights:** `added`, `changed` and `removed` (ghosted) are direct;
  `derived` entities moved only through a parent and should have a weaker
  highlight or none.
- **P6. Disposal:** preview-only GPU resources are released on `clear` and
  `dispose`.

Optional later: side-by-side or split-view comparison, using
`compareWorlds(a, b)` from `src/core/futures.ts`.

## 6. Browser acceptance tests to add (after the UI exists)

1. Fork, Director morph (recorded) inside the future, preview: the real world
   (inspector values) is unchanged; "Back to the real world" restores the view.
2. Two futures: their cards show different counts; the contested entity is
   marked.
3. Apply one future: one timeline entry with the Future badge; one Ctrl+Z
   restores the world; the other card shows the stale warning.
4. Edit the world, then Apply on an old future: refused with the stale message;
   Rebase, then Apply works.
5. Pinned citadel: a future step that moves its island is refused with a reason
   naming both.
6. Timeline: an undone entry is dimmed; the inspector shows observed and
   derived sections separately; model labels are shown as model text.
7. Context loss while previewing: after restore, the preview is shown again;
   console clean.
8. Reduced motion and performance mode: the preview appears instantly.

## 7. What Kiro owns next

- The ledger timeline and futures panel in `src/ui/` (not `shell.ts`), using
  these view models, once Malak approves the UI scope.
- Persistence for ledger and futures, once WW-016 is decided.
- A SHA-256 chain together with persistence.
