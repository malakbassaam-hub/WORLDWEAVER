# Integration readiness, 2026-11-21

Prepared by Kiro on `feature/persistence-studio-1121`. Read-only audit of every
branch and worktree. Nothing was merged, rebased or reset, and no Kilo worktree
was modified. **The project is not integrated and not ready for submission.**

## 1. Branch state (remote verified with `git ls-remote` on 2026-11-21)

| Branch | Tip | Pushed | Owner | Content |
|---|---|---|---|---|
| `main` | `1e03dff` | yes | — | Licence, steering, preflight only. Protected. |
| `feature/integration-1120` | `96a1422` | yes | Kiro | Baseline: Director, Morph, Ledger, Futures, WebGL recovery |
| `feature/persistence-studio-1121` | this branch | yes | Kiro | Baseline + persistence in the studio |
| `feature/cinematic-webgl-1121` | `f9775f7` | yes | Kilo | Baseline + cinematic renderer, WebGL diagnostics |
| `feature/camera-cinematic-1121` | `f9775f7` + uncommitted | **no** | Kilo | Camera work in progress (WW-035) |
| `feature/camera-cinematic-1121-2` | `1e03dff` | no | Kilo | Empty Kilo worktree under `.kilo/worktrees/` |

Older branches (`phase*`, `release/rc-2026-11-19`, `feature/*-1120`) are all
ancestors of `96a1422` or superseded by it, and are kept for history.

Isolation: both active branches start from `96a1422`. Persistence and cinematic
work share no commits, worktrees or uncommitted files.

## 2. Conflict analysis

| Area | Persistence (`ed99f75` and later) | Cinematic (`f9775f7`) | Result |
|---|---|---|---|
| `src/main.ts` | boot signature, persistence mount, `showNotice`, teardown, `requestReboot`, entry point | WebGL version in stats line; detailed WebGL-unavailable message | **Auto-merges.** `git merge-tree --write-tree ed99f75 f9775f7`: exit 0, tree `17b43cb`. Both sides' lines are present in the merged file. |
| `src/render/**` | untouched | `SceneRenderer.ts`, `archetypes.ts`, `environment.ts` | No overlap |
| `src/ui/styles.css` | `.ww-left` scroll (desktop only), `.ww-persistence` rules | untouched in `f9775f7`; +2 lines (`.ww-viewport-hint`) uncommitted on the camera branch | Uncommitted change applies cleanly to `ed99f75` (`git apply --check`) |
| `src/ui/shell.ts` | untouched | 4 lines uncommitted on the camera branch | Applies cleanly; Kiro-owned file (WW-034) |
| Test configuration | adds `tests/e2e/persistence*.spec.ts`; no config change | none committed | No overlap. Port 5199 is shared by every agent's suite (WW-029). |
| `.gitignore` | `playwright-report/` line | none | No overlap |

Semantic risks that a textual merge cannot show:
- **Renderer lifecycle.** Each Restore or Import creates a new `SceneRenderer`. Kilo's renderer must keep disposal complete (WW-033).
- **Cinematic asset or archetype load time.** A slower renderer start-up delays the post-load notice; already handled by showing notices after the first frame.
- **Stats line.** Kilo's one-off `setStats` text is overwritten by the 500 ms stats timer. Cosmetic; Kilo's decision.

## 3. Persistence and renderer contract, verified

| Requirement | Method | Result |
|---|---|---|
| `dispose()` releases resources | Code review of `f9775f7` `dispose()` (lines 383–407) | PASS, except the context is not force-released (WW-033) |
| Reinitialisation after Restore and Import | `persistence.spec.ts` (7) and `persistence-lifecycle.spec.ts` (2) on `ed99f75` | PASS (SwiftShader) |
| Entirely different entity IDs | Lifecycle test imports the kingdom under `alt-` and `b2-` IDs | PASS: 27 entities, one canvas, citadel pinned and not removable, edits work |
| No callbacks after disposal | Code review: listeners removed, `frame`, `resize` and transitions guarded by `disposed`; lifecycle test hovers and clicks after 4 reboots | PASS, console clean (no stale-renderer errors) |
| Pinned protections kept | Persistence and lifecycle tests | PASS |
| World Morph on a restored world | Lifecycle test: recorded morph, citadel preserved | PASS |
| Causal Ledger after restore | Lifecycle test: ledger rows increase after the morph | PASS |
| Undo after restore | Lifecycle test: one undo returns to the restored state; indicator "All changes saved" | PASS |
| Director after restore | Lifecycle test (morph via the Director) | PASS |
| Parallel Futures after restore | Futures panel remounts with the session (code review) | NOT TESTED in a browser |
| Contract against Kilo's cinematic renderer | Tests ran on `ed99f75`, which has the baseline renderer | NOT TESTED until integration (WW-036) |

## 4. Recommended integration sequence

Every step needs Malak's approval. No step touches `main` until step 7.

1. **Kilo finishes and pushes.** Kilo commits the camera work to its branch, separates the UI-file change (WW-034, WW-035) and pushes. Kilo stops running browser suites.
2. **Create the integration branch** from `feature/persistence-studio-1121`, for example `integration/1121`. This branch already contains `96a1422`, so the first step is a fast-forward.
3. **Merge Kilo's final cinematic branch** (`feature/cinematic-webgl-1121`, or the camera branch if it includes it) with `--no-ff`. Expected: `src/main.ts` auto-merges as shown in section 2. Re-run `git merge-tree` first if Kilo's tip has changed since `f9775f7`.
4. **Apply Kilo's UI-file proposal** (`shell.ts`, `styles.css`) as a separate, Kiro-authored commit after review.
5. **Gates, run sequentially, when no other agent runs a browser suite:**
   1. `npm run typecheck`
   2. `npm test`
   3. `npm run build` plus the bundle secret scan (no `x-goog-api-key`, `generativelanguage`, `AIza…`)
   4. `npx playwright test` (all of `tests/e2e`: director, persistence, persistence-lifecycle, webgl-recovery, performance)
   5. `npx playwright test -c playwright.ui.config.ts` (ledger and futures)
6. **Manual approval by Malak:** the visual checklist in section 5 on a real GPU.
7. **Propose** the integration branch for `main` through a pull request. Malak decides.

Why persistence goes first: it is finished and browser-tested, and it changes the
session lifecycle in `main.ts` more than the cinematic branch does. Kilo's two
small `main.ts` changes then merge on top with the least risk, and the full
suite verifies the combined result once.

Fallback if step 3 conflicts (for example, after more Kilo `main.ts` changes):
Kiro resolves `main.ts` (single owner); Kilo resolves `src/render/**`; nobody
resolves in the other's worktree.

## 5. Final acceptance checklist (integrated studio)

**A** = automated test exists (SwiftShader, recorded mode). **M** = manual
approval by Malak on a real GPU. **–** = no check exists yet. "Last result" is
the most recent run on any integration-line commit; all must be re-run on the
integration branch.

| Area | Check | Type | Test or method | Last result |
|---|---|---|---|---|
| AI Director | Create preview, Apply, one undo step, redo | A | `director.spec.ts` "create: preview first…" | PASS on `ed99f75` |
| AI Director | Discard, cancel, duplicate, keyboard, stale, errors | A | `director.spec.ts` | Previously reported PASS on `96a1422` |
| AI Director | Live Gemini output | M | `npm run test:live` with Malak's key | BLOCKED (WW-025) |
| World Morph | Recorded morph, pinned citadel unchanged, one-undo | A | `director.spec.ts` morph tests; lifecycle test | PASS on `ed99f75` (one morph test + lifecycle) |
| World Morph | Transition looks right | M | Real GPU | NOT TESTED |
| Parallel Futures | Create, preview, compare, apply, discard | A | `tests/ui/ledger-futures.spec.ts` | Previously reported PASS on `96a1422` |
| Parallel Futures | 3D preview looks right and cancels cleanly | M | Real GPU | NOT TESTED |
| Causal Ledger | Entries, inspection, tamper detection | A | `ledger-futures.spec.ts`; unit tests | Unit PASS today; browser previously reported |
| Save / Restore | Save, reload, Restore, pins, fresh history | A | `persistence.spec.ts` | PASS on `ed99f75` |
| Export / Import | Round trip, confirmation, bad-file refusal, quota | A | `persistence.spec.ts` | PASS on `ed99f75` |
| Session reboot | Repeated imports, new IDs, one canvas | A | `persistence-lifecycle.spec.ts` | PASS on `ed99f75` (4 reboots; 20: WW-033) |
| Camera | Orbit, pan, zoom, focus (F), reset (Home), intro flight | A partial / M | `director.spec.ts` uses Reset view; orbit by user report | Orbit previously confirmed by the user; others NOT TESTED in the suite |
| Selection | Viewport click, hierarchy click, hover label, Escape | A | `director.spec.ts` "existing editor…" | PASS on `ed99f75` |
| Inspector | Rename, position, rotation, palette, glow, visibility, pin | A partial | Rename and swatch tested; others manual | Partial |
| Pinned entities | Cannot remove; Director and Morph cannot change | A | director, persistence, lifecycle specs | PASS on `ed99f75` |
| Undo / redo | Buttons, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | A partial | Buttons tested; shortcuts by code review | Partial |
| WebGL recovery | Loss and restore, selection and edits kept, repeated cycles | A | `webgl-recovery.spec.ts` (10) | Previously reported PASS on `96a1422`; NOT TESTED with the cinematic renderer |
| WebGL unavailable | Fallback message, panels and saves still work | A | – | NOT TESTED (WW-002) |
| Responsive UI | 390×844 Director usable | A | `director.spec.ts` responsive | PASS on `ed99f75` |
| Responsive UI | 1920×1080, 1366×768, 1180×800, 860×800; persistence at narrow widths | M / – | WW-015, WW-038 | NOT TESTED |
| Performance | FPS, draw calls, triangles in both quality modes | M | Real GPU, `docs/REAL_GPU_VERIFICATION.md` | BLOCKED (WW-009) |
| Performance | SwiftShader smoke budget | A | `performance.spec.ts` | Previously reported PASS; not a GPU measure |
| Visual quality | Cinematic Crystal Kingdom approved | M | Malak on a real GPU | BLOCKED (WebGL2 hardware access) |
| Console health | No errors or shader warnings | A | Every spec asserts it | PASS on `ed99f75` |
| Production build | `npm run build` clean, no secrets in bundle | A | Build + string scan | PASS on `ed99f75` (JS 796.58 kB, 210.89 kB gzip) |
| Security | Key server-side only; client calls only `/api/director*` | A | `src/director/safety.test.ts`, `src/persistence/safety.test.ts` | PASS today (unit suite) |

Automated results use software WebGL. They prove behaviour, not frame rate or
appearance. Visual quality and performance need Malak's manual approval.

## 6. Before today's closeout

1. Kilo: commit and push the camera and cinematic work (WW-035) and hand over the UI-file change (WW-034).
2. Malak: approve creating `integration/1121` (section 4, step 2).
3. Kiro: run the step 5 gates once Kilo's suites have stopped (WW-036), then record the results here.
4. Deferred past today unless time allows: WW-033 (20-reboot test), WW-037, WW-038, real-GPU checks (WW-009), live Gemini (WW-025).
