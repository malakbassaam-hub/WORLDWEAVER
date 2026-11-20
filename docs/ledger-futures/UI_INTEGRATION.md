# Causal Ledger and Parallel Futures UI — Integration Contract

From Kiro, 2026-11-20. Branch `feature/ledger-futures-ui-1120` (from
`release/rc-2026-11-19` at `0bbb16e`). The panels are built and tested; they
are **not mounted in the studio yet**, because that needs `src/main.ts`
(shared, Kilo Code). Kiro did not modify `src/main.ts`, `src/ui/shell.ts`,
`src/ui/director.ts`, `src/ui/styles.css`, `src/render/**`,
`playwright.config.ts`, `package.json`, the lockfile or `.gitignore`.

## 1. What exists

| File | Role |
|---|---|
| `src/ui/ledgerFutures.ts` | **Adapter: the only function the studio needs** (`mountLedgerFutures`) |
| `src/ui/ledgerPanel.ts`, `src/ui/futuresPanel.ts` | DOM panels (textContent only; no innerHTML of data) |
| `src/ui/ledgerModel.ts`, `src/ui/futuresModel.ts` | Pure view state (unit-tested in Node) |
| `src/ui/ledger-futures.css` | Panel styles; imported by the panels themselves, prefixed `ww-ledger-`, `ww-futures-`, `ww-lf-` |
| `src/director/futureRequest.ts` | Director request inside a future: same proxy, same validator, stale-future guard |
| `ledger-futures-demo.html`, `src/demo/*` | Recorded demo page (dev server only; not in the production build) |
| `playwright.ui.config.ts`, `tests/ui/ledger-futures.spec.ts` | Panel browser tests on the demo page (separate from the shared suite) |

## 2. Mounting (in `src/main.ts`)

```ts
import { mountLedgerFutures } from './ui/ledgerFutures';

const lf = mountLedgerFutures({
  store,
  initial: genesis,                                   // the world passed to new WorldStore(...)
  request: (body, signal) => requestProposal(body, { signal }),   // omit to hide the Director prompt
  morphEnabled: MORPH_ENABLED,                        // same flag as the Director (see audit finding F1)
  presenter: null,                                    // renderer FuturePreviewPresenter, once implemented (§5)
  notify: (message, tone) => shell.toast(message, tone),
  focusEntity: (id) => { actions.select(id); actions.focus(id); },
  reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  onError: (e) => console.error(e),
});
```

**Order matters:** call `mountLedgerFutures` **after** `new WorldStore(...)`
and before any further dispatch. It replays the existing log once to prime
the ledger, then records live.

### Placement (Kilo's choice; suggestion)

- Ledger: a "History" drawer above or instead of the current
  `TimelinePanel` in `shell.bottom`, or a tab in `shell.right`. The panel
  scrolls internally; give its container a bounded height
  (`max-height: 40vh` works).
- Futures: `shell.right` below the inspector, or a full-width overlay opened
  from the topbar ("Futures"). The comparison table scrolls horizontally on
  narrow screens.
- The existing timeline can stay; it reads the same store log.

### Renderer callbacks

```ts
onContextLost:     () => { /* existing code */; lf.onContextLost(); },     // clears any preview (P2)
onContextRestored: () => { /* existing code */; lf.onContextRestored(); }, // re-shows the preview (P3)
```

### Teardown (HMR and boot teardown)

```ts
lf.dispose(); // unsubscribes, aborts Director requests, clears preview, discards futures; idempotent
```

## 3. Data flow and guarantees

- **Store subscription:** the adapter subscribes once. On every store emit it
  refreshes the ledger (live recorder, no replay) and the futures panel, and
  closes any preview (rule P2), including after undo and redo.
- **The adapter never dispatches.** The only path that changes the world is
  the user pressing **Apply**, which calls `FuturesManager.commit()`. That is
  one `dispatchBatch` (one undo step), recorded in the ledger as a `Future`
  entry. Ctrl+Z after Apply reverses the whole future.
- **Preview never changes the world.** Preview calls `presenter.show()`. With
  `presenter: null` the panel says that the viewport preview is not connected,
  and the comparison table is the preview.
- **Director requests in a future** go through `request`. That is
  `requestProposal`, the same `/api/director` endpoint as the Director panel.
  The proxy rule "one running request; a newer one supersedes it (409)"
  applies across both panels; the futures panel shows the proxy's message.
  If the future changes while a request runs, the response is discarded
  (`STALE_FUTURE`).
- **Errors:** refusals (`STALE`, `PINNED`, `LIMIT`, …) are shown in the
  card, announced in a polite live region, and passed to `notify`. Rendering
  exceptions go to `onError` and show the panel's error state; they never
  reach the store.

## 4. Undo and redo

- Topbar undo/redo (store) and the ledger stay in sync automatically.
- Each future has its own **Undo step** and **Redo step** (future-local
  history; the real world is untouched).
- Any store change, including undo and redo, makes open futures **stale**.
  The card shows **Rebase**, and Apply is disabled with the reason.

## 5. Renderer preview (Kilo, `src/render/**`, optional for the demo)

Implement `FuturePreviewPresenter` from `src/core/presentation.ts` and pass it
as `presenter`. The rules P1 to P6 are in
[UI_RENDERER_HANDOFF.md](UI_RENDERER_HANDOFF.md) §5. Until then, `presenter:
null` is correct and honest; the UI states that the viewport preview is not
connected.

## 6. Accessibility and motion (implemented)

- Ledger: a list of disclosure buttons with roving focus. Arrow Up and Down,
  Page Up and Down, Home and End move; Enter or Space opens and closes;
  Escape closes. `aria-expanded` and `aria-controls` are set, details are
  regions. Filters are toggle buttons (`aria-pressed`). New entries are
  announced politely.
- Futures: labelled cards (`aria-labelledby`); Preview is a toggle button;
  errors use `role="alert"`; the comparison is a real `<table>` with
  `scope`d headers and a caption; Ctrl+Enter sends a Director prompt, Escape
  cancels it.
- AI-written labels are quoted and marked "AI-written label · not a verified
  fact".
- Reduced motion: the studio's global rule plus panel-level `transition:
  none`; smooth scrolling is disabled when `reducedMotion()` is true.

## 7. Browser tests

- **Panels on the demo page:** `npx playwright test --config playwright.ui.config.ts`
  (port 5299, recorded mode, empty key, one worker). 10 of 10 pass.
- **Inside the studio:** PENDING. They need the `src/main.ts` wiring. The
  cases to add to the shared suite after wiring:
  1. The History panel shows a new entry after an inspector edit; Ctrl+Z
     marks it Undone.
  2. A Director Create in the studio appears as a Director batch with its
     actions.
  3. A future created, previewed and applied gives one Future entry, and
     Ctrl+Z restores the world.
  4. Context loss while previewing gives a preview again after restore (once
     a presenter exists).
  5. The studio console stays clean with both panels mounted.
