# WORLDWEAVER Issue Register

Permanent record of known defects, deferred improvements and unfinished
requirements. An issue leaves this register only by being marked **DONE** with
verification evidence. Nothing is deleted.

- **Baseline:** Phase 1 commit `3459f26` on `phase1/engine-foundation`
- **Created:** 2026-11-18
- **Schedule:** [DEVELOPMENT_SCHEDULE.md](DEVELOPMENT_SCHEDULE.md)
- **Feature status:** [../.kiro/steering/status.md](../.kiro/steering/status.md)

## Conventions

| Field | Meaning |
|---|---|
| Severity | **Critical**: blocks submission or loses data. **High**: breaks a core path for some users. **Medium**: noticeable defect or missing verification. **Low**: polish or hygiene. |
| Owner | **Kilo Code**: WebGL/rendering implementation, in its separate worktree. **Kiro**: core, UI, tests, docs and config in the main worktree. **Malak**: project-owner decisions, documents and manual tests. |
| Target | Target date, not a completion date. All targets fall within 2026-11-18 to 2026-12-03. |
| Status | **OPEN**: ready to work. **BLOCKED**: cannot start until a named dependency is resolved. **IN PROGRESS**: work underway. **DONE**: acceptance criteria met and evidence recorded. |
| Evidence | **Current**: what is known today. **To close**: proof required before the status can become DONE. |

**Ownership rule:** Kiro does not modify WebGL implementation files
(`src/render/**`). Changes there are made by Kilo Code in its worktree and
reviewed before merging into `phase1/engine-foundation` or a later branch.

## Summary

| ID | Title | Severity | Owner | Target | Status |
|---|---|---|---|---|---|
| WW-001 | WebGL context loss is not recoverable | High | Kilo Code | 2026-11-21 | BLOCKED (WW-020) |
| WW-002 | WebGL-unavailable fallback never verified in a browser | Medium | Kilo Code | 2026-11-21 | BLOCKED (WW-020) |
| WW-003 | Bloom pipeline has no capability check or fallback | High | Kilo Code | 2026-11-21 | BLOCKED (WW-020) |
| WW-004 | No renderer regression tests | Medium | Kilo Code | 2026-11-24 | BLOCKED (WW-020) |
| WW-005 | Visual preview can leak into the viewport | Medium | Kiro | 2026-11-20 | OPEN |
| WW-006 | Rejected events trigger full redundant re-renders | Low | Kiro | 2026-11-20 | OPEN |
| WW-007 | Undo/redo sequence semantics are undefined for replay and provenance | Medium | Kiro | 2026-11-24 | DONE |
| WW-008 | Entity names truncated in the hierarchy | Low | Kiro | 2026-11-22 | OPEN |
| WW-009 | Performance on real GPU hardware not tested | Medium | Malak | 2026-11-26 | OPEN |
| WW-010 | Browser end-to-end tests not committed | Medium | Kiro | 2026-11-24 | DONE |
| WW-011 | Console and shadow-warning check not re-run after fix | Low | Kiro | 2026-11-20 | DONE |
| WW-012 | Development-only picomatch advisory | Low | Kiro | 2026-11-30 | DONE |
| WW-013 | Bundle is a single 664 kB chunk | Low | Kiro | 2026-11-30 | OPEN |
| WW-014 | Draw-call count is high | Medium | Kilo Code | 2026-11-26 | BLOCKED (WW-020) |
| WW-015 | Responsive layouts not verified | Medium | Kiro | 2026-11-26 | OPEN |
| WW-016 | World state is in memory only | Medium | Kiro | 2026-11-28 | IN PROGRESS (verified on branch; closes on integration) |
| WW-017 | Phase 1 not verified against Master Plan v1.2 | High | Malak | 2026-11-24 | BLOCKED (document) |
| WW-018 | Phase 1.5 visual improvement list not available | Medium | Malak | 2026-11-24 | BLOCKED (list) |
| WW-019 | Citadel close-up glow washes out detail | Low | Kilo Code | 2026-11-26 | BLOCKED (WW-020) |
| WW-020 | Kilo Code worktree is on the pre-Phase-1 commit | High | Kilo Code | 2026-11-19 | IN PROGRESS |
| WW-021 | Phase 2 start and proxy runtime not approved | Critical | Malak | 2026-11-19 | DONE |
| WW-022 | Submission and deployment format undecided | High | Malak | 2026-11-24 | BLOCKED (decision) |
| WW-023 | Flagship feature requirements need Master Plan v1.2 | High | Malak | 2026-11-24 | BLOCKED (WW-017) |
| WW-024 | Preflight script sends the API key in the URL query | Medium | Kiro | 2026-11-21 | OPEN |
| WW-025 | Gemini output schema v2 not tested against the live model | Medium | Kiro | 2026-11-21 | BLOCKED (live key) |
| WW-026 | Gemini quota and availability risk for the live demo | Medium | Kiro | 2026-11-25 | IN PROGRESS |
| WW-027 | Reducer accepts no-op visual and transform changes | Low | Kiro | 2026-11-23 | DONE |
| WW-028 | Vite config loader warns about extensionless imports | Low | Kiro | 2026-12-01 | OPEN |
| WW-029 | Browser suite is slow and contends with other agents on a shared machine | Low | Kiro | 2026-11-25 | OPEN |
| WW-030 | Phase 2 and WebGL branches not integration-tested | High | Kiro | 2026-11-21 | IN PROGRESS (superseded path; see 2026-11-21 audit) |
| WW-031 | World Morph design defaults need confirmation | Medium | Malak | 2026-11-22 | OPEN (D-WM-4 only) |
| WW-032 | WebGL branch .gitignore has UTF-16 lines | Medium | Kilo Code | 2026-11-20 | DONE (integration line) |
| WW-033 | Renderer dispose does not release the WebGL context immediately | Medium | Kilo Code (probe); Kiro (studio context, mitigated) | 2026-11-23 | IN PROGRESS (studio context fixed; probe contexts open) |
| WW-034 | Kilo's in-progress camera work edits Kiro-owned UI files | Low | Kilo Code / Kiro | 2026-11-22 | OPEN |
| WW-035 | Kilo's camera work is uncommitted and unpushed | Medium | Kilo Code | 2026-11-21 | OPEN |
| WW-036 | Full browser suite not run on the integrated tree | High | Kiro | 2026-11-22 | OPEN |
| WW-037 | Session-reboot fallback path is untested | Low | Kiro | 2026-11-24 | DONE |
| WW-038 | Persistence panel not checked at narrow widths | Low | Kiro | 2026-11-24 | DONE |
| WW-039 | Agent terminal intermittently corrupts commands | Low | Malak (tooling) | 2026-11-22 | OPEN |
| WW-040 | Restore and Import discarded open futures without asking | Medium | Kiro | 2026-11-21 | DONE |

**Totals:** 40 issues. Critical 1, High 8, Medium 18, Low 13. OPEN 14, BLOCKED 11, IN PROGRESS 5, DONE 10.

IDs WW-033 to WW-040 were allocated by Kiro on 2026-11-21. Before this, no branch, remote ref or worktree file used WW-033 to WW-039 (`git grep` across all refs; file search across all `WORLDWEAVER*` worktrees). New issues from any agent start at WW-041.

---

## Issues

### WW-001 — WebGL context loss is not recoverable

| Field | Value |
|---|---|
| Severity | High |
| Owner | Kilo Code (separate worktree) |
| Target | 2026-11-21 |
| Status | BLOCKED by WW-020 |

**Description.** On `webglcontextlost` the renderer stops its frame loop
(`SceneRenderer.ts:455`, `:520–523`), and `main.ts` calls
`shell.showFallback()`, which calls `viewport.replaceChildren()`
(`shell.ts:119–120`). That removes the canvas from the page. `onContextRestored`
only clears the flag (`SceneRenderer.ts:526–527`), so even a successful restore
cannot bring the viewport back without a page reload.

**Acceptance criteria.**
- Forcing loss with `WEBGL_lose_context.loseContext()` shows a non-destructive notice and keeps the canvas in the page.
- After `restoreContext()`, rendering resumes without a reload and the scene matches the current world state (same entities, colours, selection).
- If the context is not restored, the notice offers a reload action. World state stays in memory until reload.
- No uncaught errors in the console during loss or restore.

**Verification evidence.**
- Current: code inspection only (line references above). Never exercised in a browser.
- To close: automated browser test using `WEBGL_lose_context`, with before, lost and restored screenshots and the console log.
- Current (2026-11-18): Kilo Code pushed `phase1.5/webgl-recovery` at `c582edf` ("fix: restore WebGL viewport after context loss"). It changes `src/render/SceneRenderer.ts` and `src/main.ts` (`onContextRestored` re-syncs the renderer) and `src/ui/shell.ts` (`hideFallback`), and adds `src/render/SceneRenderer.context-loss.test.ts`. Kiro read these from git objects only. That test skips itself in Vitest's Node environment, so it proves nothing in `npm test`. Its note says no browser tool was available, but `phase2/director` now has Playwright, so a real `WEBGL_lose_context` browser test is possible on the integration branch (WW-030). Not closed.

### WW-002 — WebGL-unavailable fallback never verified in a browser

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kilo Code (separate worktree) |
| Target | 2026-11-21 |
| Status | BLOCKED by WW-020 |

**Description.** `SceneRenderer` throws `WebGLUnavailableError` when WebGL 2 is
missing or context creation fails, and `main.ts` shows a fallback message while
the scene list and inspector keep working. Every browser run so far had WebGL 2,
so this path has never executed.

**Acceptance criteria.**
- With WebGL disabled (for example, Chrome `--disable-webgl` or `--disable-gpu` without SwiftShader), the app loads without uncaught errors.
- The fallback message is visible and readable, the loader disappears, and the Quality button shows "Renderer off" (disabled).
- Hierarchy selection, inspector edits, undo/redo and the timeline still work.

**Verification evidence.**
- Current: code inspection only.
- To close: browser run with WebGL disabled; screenshot plus a passing scripted check of selection and editing.

### WW-003 — Bloom pipeline has no capability check or fallback

| Field | Value |
|---|---|
| Severity | High |
| Owner | Kilo Code (separate worktree) |
| Target | 2026-11-21 |
| Status | BLOCKED by WW-020 |

**Description.** Cinematic mode is the default. It renders through an
`EffectComposer` whose target is `HalfFloatType` with `samples: 4`
(`SceneRenderer.ts:501–510`). Multisampled half-float targets depend on GPU and
driver support (for example, color-buffer-float extensions). There is no
capability detection, no error handling around composer creation, and no
automatic switch to Performance mode. On an unsupported device the default view
may render black or fail. Verified only on SwiftShader.

**Acceptance criteria.**
- Required capabilities are detected before the composer is built.
- If unsupported, the renderer falls back first to a non-multisampled target, then to Performance mode, and shows a one-time notice.
- No black frame or uncaught error at startup on a device without support (simulated by forcing the capability check to fail).
- Visual output on supported devices is unchanged from the Phase 1 baseline.

**Verification evidence.**
- Current: works on SwiftShader (Chrome headless, ANGLE/Vulkan). No other GPUs tested.
- To close: automated test with forced capability failure, plus manual check on at least one real GPU (see WW-009).

### WW-004 — No renderer regression tests

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kilo Code (separate worktree); Kiro reviews |
| Target | 2026-11-24 |
| Status | BLOCKED by WW-020 |

**Description.** Unit tests cover only `src/core` (reducer, store, replay) and
`src/ui/parseNumberInput`. Nothing tests `src/render`: world-to-scene
reconciliation (`sync`), binding creation and removal, disposal, archetype
fallback for unknown archetypes, picking that ignores `noPick` and hidden
objects, or light-component handling. Regressions there would only show up in
manual or browser checks.

**Acceptance criteria.**
- Automated tests cover: add, update and remove reconciliation; parent re-attachment; undoing a removal recreates the binding; unknown archetype uses the fallback; picking ignores `noPick` and hidden objects; `dispose()` releases all bindings.
- Tests run in `npm test` (or a documented separate script) without a GPU.
- Each test fails when the behaviour it covers is deliberately broken.

**Verification evidence.**
- Current: test files are `src/core/reducer.test.ts`, `src/core/store.test.ts` and `src/ui/parseNumberInput.test.ts` only.
- To close: test run output listing the new renderer tests, plus a note of each deliberately broken behaviour and the test that caught it.

### WW-005 — Visual preview can leak into the viewport

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro (UI/actions layer). Any renderer-side change goes to Kilo Code. |
| Target | 2026-11-20 |
| Status | OPEN |

**Description.** The colour pickers and glow slider call `actions.preview()` on
`input` (`inspector.ts:258`, `:276`). This repaints the entity without changing
world state. The preview is reverted only when the commit is rejected
(`inspector.ts:261`, `:280`). If a preview ends without a `change` event (for
example, the selection changes mid-drag, the inspector re-renders, or the
picker closes without committing), nothing reverts it. `sync()` does not
repaint either, because it reapplies visuals only when the entity's visual
reference changes (`SceneRenderer.ts:290`). The viewport can then show a look
that is not in the world state.

**Acceptance criteria.**
- Every preview is either committed or reverted, including on selection change, inspector re-render, Escape and window blur.
- After any such interruption, the rendered entity matches the world state.
- An automated test reproduces the leak (preview, then change selection) and passes after the fix.

**Verification evidence.**
- Current: code inspection (line references above). Not yet reproduced in a browser.
- To close: browser test showing the viewport colour returns to the committed value after an interrupted preview.

### WW-006 — Rejected events trigger full redundant re-renders

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-20 |
| Status | OPEN |

**Description.** `WorldStore.dispatch()` emits to subscribers even when the
reducer rejects an event (`store.ts:81`), so the timeline can show the
rejection. The subscriber in `main.ts:108` then runs the full `render()`:
`renderer.sync`, a hierarchy rebuild and an inspector rebuild. The world has not
changed. The inspector rebuild also discards in-progress typed input and focus.

**Acceptance criteria.**
- A rejected event updates only the timeline and toast. The hierarchy, inspector and renderer are not rebuilt.
- Focus and typed text in other inspector fields survive a rejected edit.
- A unit test asserts that a rejection does not report a world change to subscribers.

**Verification evidence.**
- Current: code inspection (line references above).
- To close: test output, plus a browser check that focus is preserved after a rejected rename.

### WW-007 — Undo/redo sequence semantics are undefined for replay and provenance

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro |
| Target | 2026-11-24 |
| Status | DONE (2026-11-18) |

**Description.** Undo and redo restore a snapshot and set
`seq = present.seq + 1` (`store.ts:90`, `:100`). No event exists for that seq.
Undo and redo log entries carry no event payload, so replaying the logged events
cannot reproduce a state reached through undo. Restored entities keep provenance
`lastModifiedSeq` values that point at events which were undone. The planned
Causal Ledger and deterministic replay need these rules defined first.

**Acceptance criteria.**
- A written decision defines how undo and redo are represented (for example, compensating events, or a history pointer), recorded in `.kiro/steering/tech.md`.
- Replaying the full session log, including undo and redo, reproduces the live state exactly (unit test).
- Provenance after undo refers only to changes that are still in effect, or the documented rule says otherwise.
- Existing undo/redo behaviour in the UI is unchanged.

**Verification evidence.**
- Current: `store.test.ts` covers undo/redo state but not replay through undo.
- To close: new replay-through-undo tests passing, plus the recorded decision.
- Verified (2026-11-18): decision recorded in `src/core/store.ts` (sequencing rules) and `.kiro/steering/tech.md`. The store log is the complete replayable record: `replayLog()` (`src/core/replay.ts`) re-executes events, batches, undo and redo and reproduces the live state exactly, including seq. Provenance after undo is the provenance of the restored state. Passing tests in `src/core/batch.test.ts`: "reproduces the live state exactly through events, batches, rejections, undo and redo" and "keeps provenance consistent with the state in effect after undo". Commit `95c62cf`.

### WW-008 — Entity names truncated in the hierarchy

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-22 |
| Status | OPEN |

**Description.** At 1600×900 the hierarchy truncates names, for example
"Aurelion Cita…" (seen in verification screenshots). `.ww-tree-name` uses
ellipsis (`styles.css:161`) and shares the row with the kind label, pin badge and
eye button. Row elements have no tooltip with the full name.

**Acceptance criteria.**
- Every entity in the Crystal Kingdom shows its full name at 1600×900, or reveals it on hover or focus.
- Names up to 80 characters (the reducer maximum) remain usable.
- No layout regression at the widths checked in WW-015.

**Verification evidence.**
- Current: screenshots `01-initial.png` and `03-before-edit.png` (verification run, not committed).
- To close: screenshot at 1600×900 with full names visible, plus a long-name test.

### WW-009 — Performance on real GPU hardware not tested

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Malak (manual measurement); fixes go to Kilo Code |
| Target | 2026-11-26 |
| Status | OPEN |

**Description.** All automated runs used SwiftShader, a software GPU (about
25–50 fps). The user confirmed camera orbit works, but frame rate, GPU load and
visual quality on real hardware have not been measured in Cinematic or
Performance mode.

**Acceptance criteria.**
- FPS recorded from the in-app stats overlay on at least one real GPU, at 1920×1080, in both Cinematic and Performance modes, after 30 seconds idle and during orbiting.
- Proposed target, to be confirmed by Malak: Cinematic at 50 fps or more on the target machine; Performance at 60 fps.
- Any shortfall is registered as a new issue for Kilo Code.

**Verification evidence.**
- Current: none on real hardware. Manual camera orbit confirmed by the user.
- To close: recorded GPU model, browser, resolution, FPS and draw-call readings for both modes.

### WW-010 — Browser end-to-end tests not committed

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro |
| Target | 2026-11-24 |
| Status | DONE (2026-11-18) |

**Description.** Phase 1 browser verification (18 checks) ran from a temporary
DevTools-protocol driver in `%TEMP%`, outside the repository. It is not
repeatable by others and is not run before commits. The harness also hit
headless frame stalls that hung screenshot capture.

**Acceptance criteria.**
- Committed end-to-end suite with a documented command (for example `npm run test:e2e`).
- Covers at least: app start, render, viewport and hierarchy selection, an inspector edit with a visible change, undo, rename, camera orbit, zoom and pan, quality toggle, resize, and console health.
- Runs reliably three times in a row.
- Any new dev dependency (for example Playwright) is approved by Malak before it is installed.

**Verification evidence.**
- Current: 18 checks passed through the temporary driver (recorded in `status.md`).
- To close: committed suite, plus output of three consecutive passing runs.
- Verified (2026-11-18): Playwright suite `tests/e2e/director.spec.ts`, run with `npm run test:e2e` (`@playwright/test` 1.65.1, Apache-2.0, dev dependency approved in the Phase 2 instruction; uses the installed Chrome, no browser download). Three consecutive passing runs on commit `f8339e6`, 12/12 each (6.7, 7.2 and 8.1 min). One further run on `9c7d406`: 13/13 (4.9 min). Covers app start and render, viewport and hierarchy selection, inspector edit, undo/redo, Director create/discard/cancel/duplicate/keyboard/pinned/stale/errors, responsive layout and console health.

### WW-011 — Console and shadow-warning check not re-run after fix

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-20 |
| Status | DONE (2026-11-18) |

**Description.** The full console-health check (0 errors) passed before
`PCFSoftShadowMap` was replaced with `PCFShadowMap`. The later runs ended before
the console step, so the warning's removal and continued error-free startup are
unconfirmed.

**Acceptance criteria.**
- A fresh full browser run reports 0 console errors, 0 shader or program errors, and no `PCFSoftShadowMap` warning.

**Verification evidence.**
- Current: earlier run reported 0 errors and 5 warnings, including the `PCFSoftShadowMap` deprecation.
- To close: console log from a full run on the current code.
- Verified (2026-11-18): browser test "loads the Crystal Kingdom with a clearly labelled RECORDED Director and a clean console" asserts 0 console errors, 0 page errors and no `PCFSoftShadowMap`, `THREE.`, shader or program warnings. It passed in all three consecutive runs on `f8339e6` and on `9c7d406`.

### WW-012 — Development-only picomatch advisory

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-30 |
| Status | DONE (2026-11-18) |

**Description.** `npm audit` reports picomatch ReDoS (GHSA-fc5q-39xc-vjpf)
through `vite`, `vitest`, `tinyglobby` and `fdir`. These are development tools
only. Production dependencies report 0 vulnerabilities. npm's only fix
downgrades Vitest from 5.1.1 to 3.1.4, a breaking change, so it was not applied.

**Acceptance criteria.**
- Re-run `npm audit` by the target date.
- If a non-breaking upstream fix exists, apply it with approval and confirm the type check, tests and build still pass.
- Otherwise, record a dated risk acceptance: development tool only, not shipped, dev server bound to `127.0.0.1`.

**Verification evidence.**
- Current: `npm audit --omit=dev` reports 0. Full audit reports 5 high findings, all from the single picomatch advisory.
- To close: audit output on the target date, plus either the upgrade or the recorded risk acceptance.
- Verified (2026-11-18): `npm audit` and `npm audit --omit=dev` at `f8339e6` both report 0 vulnerabilities. `picomatch` is still 4.0.7 and the lockfile entry is unchanged since `a850253`; the registry no longer reports GHSA-fc5q-39xc-vjpf against it. No upgrade was applied. The 2026-11-30 re-check stays in the schedule.

### WW-013 — Bundle is a single 664 kB chunk

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro (build configuration) |
| Target | 2026-11-30 |
| Status | OPEN |

**Description.** The production build emits one JavaScript chunk of 664.44 kB
(169.43 kB gzip), mostly three.js and its post-processing add-ons. No code
splitting. First load is acceptable on fast connections but has not been
measured on slow ones.

**Acceptance criteria.**
- Vendor code split from app code, so app-only changes don't invalidate the cached three.js chunk.
- No chunk larger than 500 kB minified (proposed target), and no Vite size warning.
- First render time measured on a throttled connection and recorded.

**Verification evidence.**
- Current: Phase 1 build output (`dist/assets/index-*.js` 664.44 kB, 169.43 kB gzip).
- To close: new build output, plus the throttled first-render measurement.

### WW-014 — Draw-call count is high

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kilo Code (separate worktree) |
| Target | 2026-11-26 |
| Status | BLOCKED by WW-020 |

**Description.** The default view issues about 394 draw calls and 51k triangles
in Cinematic mode, and 263 in Performance mode. Each crystal is two separate
meshes (shell and core), built from 9 `crystal()` call sites in
`archetypes.ts`. Combined with shadow and bloom passes, this is likely the main
GPU cost.

**Acceptance criteria.**
- Draw calls in the default view reduced (proposed: 200 or fewer in Cinematic mode) using instancing or geometry merging.
- Visual output matches the Phase 1 baseline, compared by screenshot.
- Selection, hover and per-entity recolouring still work for every entity.

**Verification evidence.**
- Current: in-app stats from browser verification (394, then 263 draw calls).
- To close: before and after stats and screenshots, plus selection and edit checks passing.

### WW-015 — Responsive layouts not verified

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro |
| Target | 2026-11-26 |
| Status | OPEN |

**Description.** `styles.css` has breakpoints at 1180px and 860px plus a
reduced-motion rule (`styles.css:294`, `:298`, `:304`). Only 1600×900 was
visually verified, plus a canvas-size check at 1200×760. The narrow layouts
have never been looked at.

**Acceptance criteria.**
- Screenshots at 1920×1080, 1366×768, 1180×800, 860×800 and 390×844 show no overlapping panels and a usable viewport.
- Panels and controls are reachable by mouse and keyboard at each size.
- Reduced-motion mode disables the intro flight and the animations.

**Verification evidence.**
- Current: 1600×900 screenshots; canvas resize check at 1200×760.
- To close: the five screenshots listed above, reviewed, plus a reduced-motion check.
- Partial (2026-11-18): the browser suite found and fixed two narrow-layout defects: a 794 px-wide layout on a 390 px screen (single `1fr` grid column plus a non-wrapping title card) and stacked panels overlapping. The responsive test at 390×844 now asserts every panel fits, no horizontal overflow and no overlap; 1600×900 is covered by the other tests. Still to do: 1920×1080, 1366×768, 1180×800, 860×800 and the reduced-motion check. Target 2026-11-26 unchanged.

### WW-016 — World state is in memory only

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro (implementation); Malak (persistence decision) |
| Target | 2026-11-28 |
| Status | BLOCKED — persistence layer not decided |

**Description.** The world and its event log live only in memory. Reloading the
page resets to the generated Crystal Kingdom, and all edits are lost.
Persistence is also a prerequisite for the planned Causal Ledger and Parallel
Futures. The persistence layer is listed as a pending decision.

**Acceptance criteria.**
- Malak records a persistence decision (for example browser storage first, or a server store).
- Edits survive a page reload.
- Stored data is validated through the reducer on load, and corrupt data cannot crash the app.
- Saved data never contains secrets.

**Verification evidence.**
- Current: none. Known by design.
- To close: the recorded decision, plus a browser test that edits, reloads and confirms the state.

### WW-017 — Phase 1 not verified against Master Plan v1.2

| Field | Value |
|---|---|
| Severity | High |
| Owner | Malak (supply the document); Kiro (gap analysis) |
| Target | 2026-11-24 (document); 2026-11-27 (gap analysis) |
| Status | BLOCKED — the original Master Plan v1.2 document has not been supplied |

**Description.** Master Plan v1.2 is the approved project direction, but the
document is not in the repository or the workspace. Phase 1 was built from the
Phase 1 brief alone, so its scope, priorities, visual identity details and
feature definitions have not been checked against the plan. Its contents must
not be reconstructed or assumed.

**Acceptance criteria.**
- The original Master Plan v1.2 is supplied and added to the repository (or its location recorded).
- A written gap analysis compares Phase 1 and this register against the plan.
- Every gap becomes a new register issue, and the schedule is updated.

**Verification evidence.**
- Current: a search of the workspace and common user folders found no Master Plan file.
- To close: document location, the gap analysis, and the resulting register changes.

### WW-018 — Phase 1.5 visual improvement list not available

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Malak (supply the list) |
| Target | 2026-11-24 |
| Status | BLOCKED — the planned list is not recorded in the repository |

**Description.** Phase 1.5 visual improvements are planned, but the list of
those improvements is not in the repository or the development record. To avoid
inventing scope, this register records only visual issues actually observed
(WW-008, WW-019). The planned items will be registered individually once the
list is supplied.

**Acceptance criteria.**
- The Phase 1.5 list is supplied.
- Each item is registered as its own issue with owner, target, acceptance criteria and evidence requirements.
- WebGL and rendering items are assigned to Kilo Code.

**Verification evidence.**
- Current: none.
- To close: the supplied list, plus the new issue IDs.

### WW-019 — Citadel close-up glow washes out detail

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kilo Code (separate worktree) |
| Target | 2026-11-26 |
| Status | BLOCKED by WW-020 |

**Description.** After the Phase 1 exposure fix, the wide view reads correctly
(viewport average luminance about 124/255). When the citadel is framed with F,
the citadel region averages about 194/255 luminance, with about 66% of pixels
above 180. Crystal facets merge into glow.

**Acceptance criteria.**
- In the framed citadel view, facets of the central spire are distinguishable in a screenshot.
- Proposed target: region average luminance at or below 170, with the wide view still between 110 and 140.
- The Orchid Flare recolour remains clearly visible (WW-010 edit check still passes).

**Verification evidence.**
- Current: verification measurements from `03-before-edit.png` (region 560,120,480×620).
- To close: before and after region measurements and screenshots.

### WW-020 — Kilo Code worktree is on the pre-Phase-1 commit

| Field | Value |
|---|---|
| Severity | High |
| Owner | Kilo Code |
| Target | 2026-11-19 |
| Status | IN PROGRESS |

**Description.** `git worktree list` shows Kilo Code's worktree at
`C:/Users/user/.local/share/kilo/worktree-pool/worldweaver-9cd03c12d04e/capricious-mars`
on a detached HEAD at `1e03dff` (`main`). That commit predates Phase 1 and has no
`src/` code, so none of the WebGL issues assigned to Kilo Code can start there.
Kiro has not modified that worktree.

**Acceptance criteria.**
- Kilo Code works on a named branch created from `origin/phase1/engine-foundation` at `3459f26` or later (for example `kilo/webgl-hardening`).
- `npm install`, `npm test`, `npm run typecheck` and `npm run build` pass in that worktree.
- Kilo's changes reach Phase 1 code only through a reviewed merge or pull request, never by pushing to `main`.

**Verification evidence.**
- Current (2026-11-18, first listing): only the `capricious-mars` worktree at `1e03dff`.
- Current (2026-11-18, later listing): a new worktree `C:/Users/user/WORLDWEAVER-WEBGL` on branch `phase1.5/webgl-recovery` at `3459f26` (Phase 1). The branch is not on `origin` yet. The `capricious-mars` worktree still exists. Kiro has not run any command inside either worktree, so install, test, type-check and build results there are unverified.
- To close: Kilo Code reports `git log -1` plus passing `npm test`, `npm run typecheck` and `npm run build` from `WORLDWEAVER-WEBGL`. WW-001 to WW-004, WW-014 and WW-019 then change from BLOCKED to OPEN.
- Current (2026-11-18, Phase 2 session): `WORLDWEAVER-WEBGL` is at `c582edf` on `phase1.5/webgl-recovery`. Kilo Code ran its own Playwright suite there (observed processes, read-only). Its results have not been reported to Kiro, so the acceptance checks remain unverified.
- Current (2026-11-18, readiness check): `phase1.5/webgl-recovery` is on `origin` at `c582edf`, based on `3459f26`. Kilo Code has still not reported install, test, type-check and build results. Kiro has not touched either Kilo worktree.

### WW-021 — Phase 2 start and proxy runtime not approved

| Field | Value |
|---|---|
| Severity | Critical |
| Owner | Malak |
| Target | 2026-11-19 |
| Status | DONE (2026-11-18) |

**Description.** Gemini world creation, Phase 2, is the first item on the
critical path to the 2026-12-03 target. It needs three approvals before
implementation begins. First, permission to start Phase 2. Second, a
server-side component: a static Vite build cannot keep the API key secret. The
proposed runtime is Node 24, which the project already requires, with Vite dev
middleware and no new dependency. Third, a labelled fixture mode that serves
recorded responses for tests and as a demo fallback. See
[PHASE2_PLAN.md](PHASE2_PLAN.md) step P2-00.

**Acceptance criteria.**
- Malak's decisions on all three points are recorded in `.kiro/steering/tech.md`.
- If the runtime differs from the proposal, `PHASE2_PLAN.md` and the schedule are updated the same day.

**Verification evidence.**
- Current: approved by Malak on 2026-11-18. Approved: Node.js 24 local proxy with no paid services; Gemini API key server-side only; recorded responses for deterministic tests; real Gemini integration remains mandatory; no flagship feature removed. Recorded in `.kiro/steering/tech.md` ("Phase 2 decisions").
- To close: done. The decision is recorded in the same commit that starts Phase 2 on branch `phase2/director`.

### WW-022 — Submission and deployment format undecided

| Field | Value |
|---|---|
| Severity | High |
| Owner | Malak |
| Target | 2026-11-24 |
| Status | BLOCKED — awaiting decision |

**Description.** It is not decided whether the submission is a hosted demo, a
locally run app, a video, or a combination. A hosted demo needs a hosted proxy
that holds the API key, so a static host alone cannot hide it. A local demo
needs clear run instructions, and each user supplies their own key. This
affects proxy hosting, README instructions and the final test plan.

**Acceptance criteria.**
- The submission format is recorded in `.kiro/steering/tech.md`.
- If hosted: the hosting target keeps the key server-side and uses no paid services unless Malak explicitly approves them.
- The README run instructions match the chosen format.

**Verification evidence.**
- Current: none.
- To close: the recorded decision, plus updated README instructions.

### WW-023 — Flagship feature requirements need Master Plan v1.2

| Field | Value |
|---|---|
| Severity | High |
| Owner | Malak (supply); Kiro (requirements and conformance) |
| Target | 2026-11-24 |
| Status | BLOCKED by WW-017 |

**Description.** World Morph, Living Characters, Parallel Futures and the
Causal Ledger are defined only by the short summaries in
`.kiro/steering/product.md`. `PHASE2_PLAN.md` section 10 gives provisional
scope derived from those summaries. The detailed requirements, the depth
expected for the submission, and conformance checks depend on Master Plan v1.2,
which has not been supplied. They must not be assumed.

**Acceptance criteria.**
- When Master Plan v1.2 is supplied, each flagship feature has requirements and acceptance criteria traced to the document.
- Every difference from the provisional scope becomes a register issue, and the schedule is updated.
- Until then, provisional work is labelled provisional in `status.md`.

**Verification evidence.**
- Current: provisional scope in `PHASE2_PLAN.md` section 10; Master Plan not available.
- To close: traced requirements document, plus register updates.

### WW-024 — Preflight script sends the API key in the URL query

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro (change requires Malak's explicit approval) |
| Target | 2026-11-21 |
| Status | OPEN |

**Description.** `tests/preflight/gemini_structured_output_tests.ps1:104`
builds the request URL as `...:generateContent?key=<GEMINI_API_KEY>`. Keys in
URLs can appear in exception messages, proxy logs or shell history. The script
does not print the key, and runs only locally. Steering rules forbid changing
this script without explicit instruction. The Phase 2 proxy and the new v2
preflight script must use the `x-goog-api-key` header instead.

**Acceptance criteria.**
- New Phase 2 code and the v2 preflight script send the key only in the `x-goog-api-key` header (code review plus proxy unit test).
- With Malak's approval, the existing preflight script is switched to the header, and a no-key dry run plus a syntax check still pass. Otherwise a dated risk acceptance is recorded here.

**Verification evidence.**
- Current: line 104 of the preflight script uses the query parameter.
- To close: header-only key usage in new code, plus either the updated script or the recorded acceptance.
- Partial (2026-11-18): all new Phase 2 code sends the key only in the `x-goog-api-key` header (`server/director/gemini.ts`). Proxy test "sends the key only in the x-goog-api-key header" asserts the upstream URL contains no key. The existing preflight script is unchanged and still needs Malak's approval to edit. Target 2026-11-21 unchanged.

### WW-025 — Gemini output schema v2 not tested against the live model

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro (script); Malak (live run) |
| Target | 2026-11-21 |
| Status | BLOCKED — needs a live run with Malak's key |

**Description.** The 9/9 live preflight covered only the v1 schema
(`worldName`, `biome`, `objects[{name,type}]`). Phase 2 needs a v2 schema with
operations, enums, refs and placement intents (`PHASE2_PLAN.md` section 4.1).
Gemini's handling of v2 has never been tested.

**Acceptance criteria.**
- New script `tests/preflight/gemini_schema_v2_tests.ps1`: at most 9 calls, at least 5 s apart, no automatic retries, key from the environment sent in a header, never printed. The existing script is untouched.
- Covers create, edit with refs, Arabic, mixed Arabic and English, pinned context, oversized request and an adversarial prompt.
- A no-key dry run and a syntax check pass. Malak runs it live and the results are recorded in `status.md`.

**Verification evidence.**
- Current: none. v2 schema exists only in the plan.
- To close: script committed, dry-run output, and live results.
- Partial (2026-11-18): instead of the planned PowerShell script, the live suite is TypeScript, `tests/live/director.live.test.ts` (`npm run test:live`), so it exercises the real proxy, validator and translator: 8 live calls (cap 9), at least 5.3 s apart, no retries, key in the header only. Run without a key: BLOCKED, 0 calls, recorded in `test-results/live-gemini.json`. It has not run live because no key is available to the agent. **Live compatibility is not claimed.** Target 2026-11-21 unchanged.
- Current (2026-11-18): live suite audited without making requests: model `gemini-3.5-flash-lite` (`DEFAULT_MODEL`), schema `PROPOSAL_RESPONSE_SCHEMA` sent as `responseSchema`, 8 requests (cap 9) through the local proxy only, 5.3 s spacing, no retries, key only in the `x-goog-api-key` header (pinned by proxy tests). Runbook with hidden key entry: [LIVE_TEST_RUNBOOK.md](LIVE_TEST_RUNBOOK.md). Still BLOCKED until Malak runs it; target 2026-11-21 unchanged.

### WW-026 — Gemini quota and availability risk for the live demo

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kiro |
| Target | 2026-11-25 |
| Status | IN PROGRESS |

**Description.** Phase 2 depends on Gemini at demo time. Free-tier rate limits
and quota exhaustion (HTTP 429) or upstream outages would break a live
demonstration. Automatic retries are prohibited, and paid services must not be
enabled without approval.

**Acceptance criteria.**
- 429 and timeout states are clear to the user, with retry-after countdowns (`PHASE2_PLAN.md` section 8).
- Fixture mode serves recorded proposals behind a visible "Recorded responses" badge. It is used for E2E tests and as a demo fallback, and is never presented as live AI.
- The quota available to the project is recorded by Malak.

**Verification evidence.**
- Current: none.
- To close: browser tests of the 429 and timeout states in fixture mode, a screenshot of the badge, and the recorded quota.
- Partial (2026-11-18): recorded mode exists with a sticky RECORDED badge, a "RECORDED · not live AI" preview chip and footer note, verified in the browser with a screenshot. The 429 countdown is browser-tested; the timeout and the other error states are unit-tested in `server/director/handler.test.ts`. Remaining: Malak records the project's Gemini quota. Target 2026-11-25 unchanged.

### WW-027 — Reducer accepts no-op visual and transform changes

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-23 |
| Status | DONE (2026-11-18) |

**Description.** The reducer rejects no-op renames and pin changes with
"No change." so that history stays clean (`reducer.test.ts`, "treats a no-op
change as rejected"). It does not do the same for `entity/visualChanged` or
`entity/transformed`. A patch that sets values the entity already has is
accepted, recorded in undo history and the timeline, and bumps provenance. One
way to trigger it is clicking the already-active palette swatch in the
inspector. Found while testing the Director translator, which now filters such
operations itself (`src/director/translate.ts`, `isNoOp`).

**Acceptance criteria.**
- The reducer rejects visual and transform patches that change nothing, with "No change.".
- New reducer unit tests cover both cases. Existing Phase 1 tests and editor behaviour still pass.
- Fixed together with the store work in P2-04 (same target date), so undo and history semantics change in one place.

**Verification evidence.**
- Current: translator test "rejects no-op visual and transform changes" documents the behaviour. The reducer is unchanged.
- To close: reducer tests, plus a browser check that clicking the active swatch adds no timeline entry.
- Verified (2026-11-18): the reducer rejects visual and transform patches that change nothing (`src/core/reducer.ts`), covered by the "reducer no-op rule (WW-027)" tests in `src/core/batch.test.ts`. The browser test "WW-027: clicking the already-active swatch records no edit" first showed that the store still logged a rejected chip. The UI edit path now dry-runs and skips no-ops (`src/main.ts`), and the test passes. Commits `95c62cf` and `9c7d406`.

### WW-028 — Vite config loader warns about extensionless imports

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-12-01 |
| Status | OPEN |

**Description.** Since the Director proxy is mounted from `vite.config.ts`, Vite 8 prints: "Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite". The reason is extensionless imports in `server/director/*` and the `src/director` and `src/core` modules they import. The current default loader works: dev and preview both serve `/api/director`, and the health check returns 200. A future Vite major version may break config loading.

**Acceptance criteria.**
- Either the imports used by the config are made native-loader compatible (explicit extensions plus `allowImportingTsExtensions`), or the config pins `configLoader: 'bundler'` with a comment explaining why.
- `npm run dev` and `npm run preview` start without the warning, and `/api/director/health` still returns 200.
- Type check, unit tests, build and the browser suite still pass.

**Verification evidence.**
- Current (2026-11-18): warning text in the dev-server output; `/api/director/health` returns 200 through Vite.
- To close: dev-server output without the warning, plus passing checks.

### WW-029 — Browser suite is slow and contends with other agents on a shared machine

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-25 |
| Status | OPEN |

**Description.** The Playwright suite uses software WebGL (SwiftShader). On this machine (about 8 GB RAM, often under 1 GB free) a run takes 5–17 minutes, against about 3 minutes when the machine is idle. When Kilo Code's own Playwright suite ran at the same time from its worktree, runs failed with timeouts: free RAM dropped to about 110–600 MB. Three tests also depended on a 1.5 s recorded latency; they were rewritten to hold requests deterministically (`holdDirector` in the spec). The per-test timeout was raised to 240 s. No assertions were weakened.

**Acceptance criteria.**
- Kiro and Kilo Code agree not to run browser suites at the same time, or use separate ports and lower parallelism (documented in `tech.md`).
- Optionally, add a fast smoke subset (`--grep @smoke`) that runs in under 2 minutes.
- Three consecutive passing full runs are recorded after any change to the suite.

**Verification evidence.**
- Current (2026-11-18): run timings and failures recorded during the Phase 2 session; after the deterministic-hold change, three consecutive 12/12 runs on `f8339e6` and 13/13 on `9c7d406`.
- To close: documented coordination rule, plus run timings.

### WW-030 — Phase 2 and WebGL branches not integration-tested

| Field | Value |
|---|---|
| Severity | High |
| Owner | Kiro (integration branch and tests); Kilo Code (fixes in `src/render/**`) |
| Target | 2026-11-21 |
| Status | BLOCKED — needs Malak's approval to create the integration branch |

**Description.** Kilo Code's `phase1.5/webgl-recovery` (`c582edf`) and `phase2/director` (`efa19be`) both start from `3459f26`. Two files overlap: `src/main.ts` and `src/ui/shell.ts`. An in-memory trial merge (`git merge-tree`, no working-tree change) is **textually clean**: both files auto-merge and the result tree is `64caf8b`. The **semantic** result has not been tested. The specific risks:
- Kilo's `onContextRestored` calls `renderer.sync(store.getState())`. It must also restore Director-added entities, the selection marker and any pending Director preview. The Director panel must keep working while the fallback is shown.
- `showFallback` and `hideFallback` replace the viewport's children; the Director panel and toasts must not be affected.
- Kilo's `SceneRenderer.context-loss.test.ts` is now picked up by the Phase 2 Vitest include (`src/**/*.test.ts`). It skips itself under Node, so it would add no real coverage, and it must pass the stricter Phase 2 type-check projects.
- Kilo's branch has not run the Phase 2 browser suite, and Phase 2 has not run with Kilo's renderer changes.
- Kilo's note that no browser tool exists is out of date: Playwright is on `phase2/director`, so WW-001 can be verified with a real `WEBGL_lose_context` test.

**Update (2026-11-18, later the same day).** Kilo Code pushed `116e97f` ("feat: WebGL context-loss recovery for renderer resilience") on top of `c582edf`. The trial merge is **no longer textually clean**: `git merge-tree` exits 1 with conflicts in `.gitignore` (treated as binary, see WW-032), `package.json`, `package-lock.json` and `playwright.config.ts` (both branches added one; add/add). `src/main.ts` and `src/ui/shell.ts` still auto-merge. Kilo's branch now also adds `tests/browser/webgl-recovery.test.ts`, a second Playwright setup (`testDir: 'tests/browser'`, `baseURL` port 4173, HTML reporter, `test:browser` script) and a redundant `playwright` dependency next to `@playwright/test`.

**Acceptance criteria.**
- Malak approves an integration branch, for example `integration/phase2-webgl`, created from `phase2/director` with `origin/phase1.5/webgl-recovery` merged in. Neither `main` nor the source branches are changed.
- On that branch, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` (3 consecutive runs) pass.
- A new browser test forces `WEBGL_lose_context` loss and restore while the Director has an applied proposal and an open preview. The viewport returns, all entities including Director-added ones render, the selection is kept, the preview is still usable, and the console is clean.
- Semantic conflicts are fixed by their owners: `src/render/**` by Kilo Code, everything else by Kiro.
- Conflict resolution rules (configuration is Kiro-owned): keep Phase 2's UTF-8 `.gitignore`, which already ignores `test-results/` and `playwright-report/`; keep one `@playwright/test` dependency and drop the redundant `playwright` package; keep one Playwright config with Phase 2's recorded-mode web server and two projects, `e2e` (`tests/e2e`) and `browser` (Kilo's `tests/browser`); keep one script, `test:e2e`, running both projects; regenerate `package-lock.json` with `npm install` and do not hand-merge it.

**Verification evidence.**
- Current (2026-11-18): `git merge-tree --write-tree` exit 0; auto-merged `src/main.ts` and `src/ui/shell.ts`; Kilo's diff read from git objects (+173/−5 lines in 4 files). No semantic tests run, because merging needs approval.
- To close: integration branch commit, outputs of all four commands, and the context-loss browser test result.
- Current (2026-11-18, re-check against `116e97f`): `git merge-tree --write-tree` exit 1; result tree `67c162c`; 4 conflicting files, 2 auto-merged. Read from git objects only; Kilo's worktree was not touched.

### WW-031 — World Morph design defaults need confirmation

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Malak (decision); Kiro (implementation) |
| Target | 2026-11-22 |
| Status | OPEN |

**Description.** [WORLD_MORPH_PLAN.md](WORLD_MORPH_PLAN.md) section 2 proposes four defaults:
- D-WM-1: a morph with any pin-rejected operation is rejected as a whole, not filtered;
- D-WM-2: pinning also protects a pinned entity's ancestors from move, hide and remove, because transforms and visibility are inherited;
- D-WM-3: adding children to a pinned entity is allowed;
- D-WM-4: transitions last at most 1.2 s and are instant under reduced motion and in Performance mode.

These are design choices that Master Plan v1.2 might settle differently (WW-023).

**Acceptance criteria.**
- Malak confirms or replaces each default, and the decision is recorded in `.kiro/steering/tech.md`.
- If Master Plan v1.2 is supplied later and differs, a new issue is registered.

**Verification evidence.**
- Current (2026-11-18): defaults written in the plan; no decision recorded.
- To close: commit recording the decision.

### WW-032 — WebGL branch .gitignore has UTF-16 lines

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kilo Code (on `phase1.5/webgl-recovery`); Kiro if it is resolved during integration (WW-030) |
| Target | 2026-11-20 |
| Status | OPEN |

**Description.** On `phase1.5/webgl-recovery` (`116e97f`) the `.gitignore` blob (`470ccac`) is 2,432 bytes and contains 35 NUL bytes, starting at byte 2,363. The original rules are intact ASCII, including `.env`, `*.pem`, `*.key`, `secrets/`, `credentials/`, `node_modules/` and `dist/`. The last two lines, `test-results/` and `playwright-report/`, were appended as UTF-16 (the default encoding of `>>` in Windows PowerShell 5.1). Effects: git does not recognise those two patterns, so Playwright output, including screenshots, could be committed on that branch; and git treats the whole file as binary, which causes the WW-030 merge conflict.

**Acceptance criteria.**
- `.gitignore` on the branch is plain UTF-8 or ASCII with no NUL bytes, or the integration branch takes Phase 2's `.gitignore`.
- `git check-ignore -v test-results/x playwright-report/x .env` matches all three paths on the resulting branch.
- No Playwright output is tracked on the branch: `git ls-files test-results playwright-report` prints nothing.

**Verification evidence.**
- Current (2026-11-18): byte inspection of the blob via `git show` (read-only); NUL region decodes as UTF-16 `test-results/` and `playwright-report/`.
- To close: the byte check showing 0 NUL bytes, plus the `git check-ignore` output.

---

## 2026-11-21 audit (Kiro, branch `feature/persistence-studio-1121`)

Status words in this section: **PASS** (acceptance met, evidence below), **FAIL**, **BLOCKED**, **DEFERRED**, **NOT TESTED**. "Previously reported" means a result from an earlier session that was not re-run today.

| ID | 2026-11-21 status | Evidence today | Priority |
|---|---|---|---|
| WW-016 | PASS on branch (not yet integrated) | `ed99f75`: 7/7 `persistence.spec.ts`, 2/2 `persistence-lifecycle.spec.ts`, 52 focused unit tests. Edits survive a reload through an explicit Restore (not automatic, by design). Closes as DONE once merged into the integration branch with the full suite passing (WW-036). | P2 |
| WW-029 | FAIL (recurred) | Today Kiro's runs collided with Kilo's suite on port 5199 ("already used") and two runs ended with exit -1 under about 300–600 MB free RAM. The coordination rule exists in `tech.md` but is not enforced. Fix: check port 5199 and running Playwright processes before starting; one agent runs browser suites at a time. | P2 |
| WW-030 | PASS (previously reported), superseding path | The Phase 2 plus WebGL-recovery combination reached the integration line through `release/rc-2026-11-19` and `feature/integration-1120`, not through merging `116e97f`. `tests/e2e/webgl-recovery.spec.ts` (10 tests, `WEBGL_lose_context`) is on `ed99f75`; the earlier session reported 43/43 browser tests on `96a1422`. Not re-run today. Merging `116e97f` itself is no longer needed and is not recommended. Closes as DONE after WW-036. | P1 (through WW-036) |
| WW-031 | BLOCKED (decision, D-WM-4 only) | D-WM-1 to D-WM-3 approved by Malak on 2026-11-19 (`docs/world-morph/IMPLEMENTATION_STATUS.md`). D-WM-4 (1200 ms transition) remains a proposal. | P3 |
| WW-032 | PASS | On `ed99f75`: `.gitignore` has 0 NUL bytes; `git check-ignore -v test-results/x playwright-report/x .env` matches all three (lines 40, 127, 10); `git ls-files test-results playwright-report` prints nothing. `116e97f` still has the defect but is superseded (WW-030). | — |

### WW-033 — Renderer dispose does not release the WebGL context immediately

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Kilo Code (`src/render/SceneRenderer.ts`) |
| Target | 2026-11-23 |
| Status | OPEN (NOT TESTED beyond 4 reboots) |

**Description.** Restore and Import rebuild the session, which creates a new `SceneRenderer` and WebGL context each time. `SceneRenderer.dispose()` at `f9775f7` is otherwise thorough: idempotent, animation loop stopped, all canvas and controls listeners removed, bindings, environment, composer and shared textures disposed, canvas removed, and the frame, resize and transition steps guarded by `disposed`. It calls `renderer.dispose()` but not `renderer.forceContextLoss()`, so each old context lingers until garbage collection. Browsers allow about 16 live contexts and then drop the oldest with a console warning.

**Acceptance criteria.**
- `dispose()` releases the context (for example `forceContextLoss()` after listeners are removed), or a documented reason why not.
- A browser test performs 20 consecutive Imports with no "Too many active WebGL contexts" warning, exactly one canvas, and a clean console.

**Evidence.** Code review of `f9775f7` (`dispose()` at lines 383–407). `tests/e2e/persistence-lifecycle.spec.ts` on `ed99f75`: 4 consecutive Import reboots, one canvas, no context warnings, clean console (PASS). 20 reboots: NOT TESTED.

### WW-034 — Kilo's in-progress camera work edits Kiro-owned UI files

| Field | Value |
|---|---|
| Severity | Low (process) |
| Owner | Kilo Code (propose); Kiro (apply) |
| Target | 2026-11-22 |
| Status | OPEN |

**Description.** The uncommitted work in `C:\Users\user\WORLDWEAVER-CAMERA-CINEMATIC` (branch `feature/camera-cinematic-1121`, at `f9775f7`) changes `src/ui/shell.ts` (4 lines) and `src/ui/styles.css` (2 lines, a `.ww-viewport-hint` rule) as well as renderer files. `tech.md` assigns `src/ui/**` to Kiro, and Kilo proposes `shell.ts` changes through review. The change is small and additive: `git apply --check` of that UI diff against `ed99f75` succeeds.

**Acceptance criteria.** Kilo commits the UI change separately with a handoff note, and Kiro reviews it before integration; or Kiro applies it on the integration branch.

### WW-035 — Kilo's camera work is uncommitted and unpushed

| Field | Value |
|---|---|
| Severity | Medium (risk of losing work) |
| Owner | Kilo Code |
| Target | 2026-11-21 |
| Status | OPEN |

**Description.** At the time of the audit, `feature/camera-cinematic-1121` has no commits beyond `f9775f7`, exists only locally, and carries uncommitted changes (`archetypes.ts` +521/−76 lines, `SceneRenderer.ts`, `shell.ts`, `styles.css`). A second Kilo worktree, `.kilo/worktrees/feature-camera-cinematic-1121-2-…` on `feature/camera-cinematic-1121-2`, sits at `1e03dff` with no changes. The main worktree shows `?? .kilo/` as untracked; only `.kilo/worktrees/` is excluded (through `.git/info/exclude`).

**Acceptance criteria.** Kilo's work is committed and pushed to a named remote branch; `.kilo/` stays uncommitted (add `.kilo/` to the exclude file or `.gitignore` after approval).

### WW-036 — Full browser suite not run on the integrated tree

| Field | Value |
|---|---|
| Severity | High |
| Owner | Kiro |
| Target | 2026-11-22 |
| Status | OPEN (NOT TESTED) |

**Description.** No single tree containing persistence (`ed99f75`) and the cinematic renderer (`f9775f7` or later) has been tested. A trial merge is textually clean (`git merge-tree --write-tree ed99f75 f9775f7`: exit 0, tree `17b43cb`; only `src/main.ts` overlaps and auto-merges with both sides' changes present). On `ed99f75` alone, these ran today: the 7 persistence tests, the 2 lifecycle tests and 7 selected director tests (the phone-width test passed after a fix). Not run on `ed99f75`: `webgl-recovery.spec.ts`, `performance.spec.ts`, the rest of `director.spec.ts`, and `tests/ui/ledger-futures.spec.ts` (`playwright.ui.config.ts`).

**Acceptance criteria.** On an approved integration branch: `npm run typecheck`, `npm test`, `npm run build`, `npx playwright test` (all `tests/e2e`) and `npx playwright test -c playwright.ui.config.ts` pass, run when no other agent is running a browser suite.

### WW-037 — Session-reboot fallback path is untested

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-24 |
| Status | OPEN (NOT TESTED) |

**Description.** If booting a restored world throws, `requestReboot` (`src/main.ts`) boots the previous world again, without its undo history. Reviewed in code only.

**Acceptance criteria.** A test forces the new session to fail (for example a renderer constructor stub) and confirms the previous world, a notice and a clean recovery.

### WW-038 — Persistence panel not checked at narrow widths

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-24 |
| Status | OPEN (NOT TESTED) |

**Description.** The persistence tests run at 1600×900. The left-column scroll fix applies only above 860 px; at 390 px, Save, Import and the confirmation box have not been exercised. Part of WW-015.

**Acceptance criteria.** At 390×844 and 1180×800, Save, Export, Import confirmation and Cancel are reachable and clickable, with no overlap.

### WW-039 — Agent terminal intermittently corrupts commands

| Field | Value |
|---|---|
| Severity | Low (tooling; affects evidence reliability) |
| Owner | Malak (environment) |
| Target | 2026-11-22 |
| Status | OPEN |

**Description.** On 2026-11-21, Kiro's PowerShell tool often prefixed the first token of a command with `ؤ` (U+0624), so the first statement failed and later ones ran. One long run was lost this way. Mitigation used: a harmless first statement (`$null = 0;`), and checking every output used as evidence. A likely cause is an Arabic keyboard layout or input-method state on the host terminal; not confirmed.

**Acceptance criteria.** Cause identified, or a full session without the corruption.

## 2026-11-21 risk closure (Kiro, later the same day)

Run with no other agent's Playwright process active (checked port 5199 and `node` processes before each run). SwiftShader, recorded mode.

| Command | Result |
|---|---|
| `npx vitest run` | 37 files, 454 passed, 0 failed (443 before plus 11 new: `reboot.test.ts` 7, `confirmation.test.ts` 4) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0; JS 797.71 kB (211.36 kB gzip); bundle has no `x-goog-api-key`, `generativelanguage` or `AIza…` |
| `npx playwright test tests/e2e/persistence-risk.spec.ts`, first run (before the WW-033 fix) | 5 passed, 1 failed: 12 WebGL contexts still live after 20 reboots |
| `npx playwright test tests/e2e/persistence-risk.spec.ts tests/e2e/persistence-lifecycle.spec.ts tests/e2e/persistence.spec.ts` (after the fix) | **15 passed** (13.9 min) |

**WW-033 — IN PROGRESS.** Measured with an init-script probe over 20 Save/Restore and Import reboots, each preceded by an edit:

| Probe (after reboot 20) | Before fix | After fix |
|---|---|---|
| Canvases in the page | 1 | 1 |
| WebGL contexts created | 42 (2 per boot) | 42 |
| Contexts still live (not lost) | **12** | **1** |
| Live studio-viewport contexts | not measured | 1 (at every sampled cycle) |
| Live probe contexts (renderer capability check, `SceneRenderer.ts:56`) | not measured | 0–1, released only by garbage collection |
| `keydown` / `beforeunload` window listeners | 1 / 2, unchanged | 1 / 2, unchanged |
| Active `ResizeObserver`s | 1, unchanged | 1, unchanged |
| JS heap (Chrome `performance.memory`) | 34.1–39 MB over cycles 1–20, 52.4 MB after final interactions | 35.1–50.7 MB over cycles 10–20, 36.5 MB after final interactions |
| "Too many active WebGL contexts" warnings, console errors | none, none | none, none |

Fix (Kiro, `src/main.ts`, no renderer file changed): session teardown calls `WEBGL_lose_context.loseContext()` on the disposed renderer's canvas after `renderer.dispose()`. Remaining for Kilo: the renderer's WebGL2 capability probe (`SceneRenderer.ts:56` on this branch; check `f9775f7`'s WebGL1/WebGL2 diagnostics too) creates a throwaway context per boot that is never released. Acceptance remains: 20 reboots with live probe contexts at most 1 without relying on garbage collection, and `dispose()` releasing the viewport context itself.

Kilo's pushed `feature/camera-cinematic-1121` (`39811af`, read from git objects only): the capability probe now creates up to two throwaway contexts per boot (`getContext('webgl2')` at `SceneRenderer.ts:85`, `getContext('webgl')` at `:94`) and calls neither `loseContext` nor `forceContextLoss`. The integrated build would therefore create about 3 contexts per boot; the Kiro teardown fix still releases the viewport context. Recommended Kilo fix: call `getExtension('WEBGL_lose_context')?.loseContext()` on each probe context right after the check.

**WW-034 update.** `39811af` is committed and pushed, and touches Kiro-owned files: `src/director/schema.ts` and `src/director/describe.ts` (adds a `castle` archetype to the Director allowlist and its defaults, `maxCount: 1`), `src/ui/shell.ts` (viewport controls hint) and `src/ui/styles.css` (2 lines). Reviewed read-only: all additive. Effects: the Director may now propose `castle`; save-file validation reads the same list (`saveFile.ts:76`), so worlds with a castle save and load, and existing saves stay valid (no format version change needed). A file containing `castle` is refused by builds without it ("Unknown archetype"). Trial merges are clean: `git merge-tree --write-tree 35be7d6 39811af` exit 0 (tree `37ac85c`), and with `f9775f7` exit 0 (tree `3af2cd4`). Status stays OPEN until Kiro reviews these files on the integration branch and the unit suite (schema and recording tests) passes there.

**WW-037 — DONE.** `src/persistence/reboot.ts` (extracted from `main.ts`) is unit-tested (7 tests: success, deferral, rollback, double failure shows a plain message instead of a blank page, concurrent request refused, throwing teardown, failed first start). Browser test "rollback: a valid world that fails to start keeps the previous world": a valid import whose session boot throws once leaves the previous world with its unsaved edit, the notice "…Your previous world was kept.", one canvas, pins intact, stable listeners, and a later import still works. Defect fixed: before, a second failure caused an unhandled rejection and an empty page.

**WW-038 — DONE.** Browser tests at 390×844, 860×800 and 1180×800: Save, Export (`*.worldweaver.world`), Import confirmation within the viewport width, Cancel clickable (not covered), Restore, and no horizontal overflow. All pass.

### WW-040 — Restore and Import discarded open futures without asking

| Field | Value |
|---|---|
| Severity | Medium (silent loss of user work) |
| Owner | Kiro |
| Target | 2026-11-21 |
| Status | DONE (2026-11-21) |

**Description.** Futures live outside the store. With futures open but no world edits, `confirmation()` saw no unsaved changes and no undo history, so Restore or Import replaced the session and discarded the futures without a prompt.

**Fix.** `createPersistence` takes `openFutures()` (`src/main.ts` passes the futures manager's count). Confirmation is required while futures are open, and the message names them ("…discards 2 open futures…"). If the count cannot be read, the studio asks.

**Evidence.** `src/persistence/confirmation.test.ts` (4 tests). Browser test "Parallel Futures after a restore": with 2 futures and an active preview, Restore asks and names 2 open futures; Cancel keeps both; confirming restores, shows "No futures yet", removes the preview bar, keeps one canvas; a new future can be created, previewed and stopped in the restored session; console clean.

## 2026-11-21 integration (Kiro, branch `integration/1121`)

`integration/1121` = `feature/persistence-studio-1121` (`3a5dfdb`) + `--no-ff` merge of `feature/camera-cinematic-1121` (`39811af`, which contains `f9775f7`). Merge commit `0085b41`; no conflicts (`git merge-tree` exit 0 before merging). `package.json` and the lockfile are unchanged from `96a1422`. SwiftShader, recorded mode; every browser run started only after Kilo's Playwright processes had exited and port 5199 was free.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS (exit 0) |
| Unit tests | `npx vitest run` | PASS: 37 files, 454/454 |
| Build | `npm run build` | PASS: JS 806.50 kB (213.84 kB gzip); bundle has no `x-goog-api-key`, `generativelanguage` or `AIza…` |
| Camera | `npx playwright test tests/e2e/camera.spec.ts` (new) | PASS: 2/2 (6.1 min) |
| Studio browser suite | `npx playwright test` on director, webgl-recovery, performance, persistence, persistence-lifecycle and persistence-risk specs | PASS: 58/58 (25.9 min) |
| Ledger/Futures demo suite | `npx playwright test -c playwright.ui.config.ts` | NOT RUN: agent terminal stopped executing commands (WW-039) |

Camera evidence (mean RGB difference against an idle-animation baseline of 0.62; threshold 1.87): orbit 18.6, pan 13.5, zoom 11.2, Home vs zoomed view 22.4, Home vs start view 2.6, double-click focus 19.9 (selects Aurelion Citadel), F framing 37.7. A drag selects nothing. After a Restore reboot: idle 1.29, orbit 19.41.

WW-033 on the cinematic renderer (20 Save/Restore and Import reboots): 1 canvas throughout; 42 contexts created; **1 live context at the end** (studio viewport 1, probe 0); probe contexts were live briefly at cycles 1 and 5 (1 each) and later collected; no "Too many active WebGL contexts" warnings; `keydown` 1, `beforeunload` 2 and `ResizeObserver` 1 unchanged; heap 31.1 MB at start, 40.8 MB at end. Kilo's probe still relies on garbage collection, so WW-033 stays IN PROGRESS for Kilo.

WW-036: PASS for the studio suite on `0085b41`; the Ledger/Futures demo suite is still to run. Status stays OPEN until it passes.

---

## Change log

| Date | Change |
|---|---|
| 2026-11-18 | Register created from the Phase 1 review: WW-001 to WW-020. |
| 2026-11-18 | Phase 2 readiness: added WW-021 to WW-026. WW-020 moved to IN PROGRESS (new `WORLDWEAVER-WEBGL` worktree on Phase 1 code observed; checks unverified). No existing target dates changed. |
| 2026-11-18 | Phase 2 started on `phase2/director`: WW-021 DONE (approval recorded). Added WW-027 (found by translator tests). No existing target dates changed. |
| 2026-11-18 | Phase 2 Director implementation: WW-007, WW-010, WW-011, WW-012 and WW-027 DONE with evidence; WW-026 IN PROGRESS; WW-025 BLOCKED (needs a live run with Malak's key); evidence added to WW-015, WW-020 and WW-024. Added WW-028 and WW-029. No existing target dates changed. |
| 2026-11-18 | Readiness: added WW-030 (integration risk; textual merge clean, semantic tests pending) and WW-031 (World Morph defaults). Evidence added to WW-001, WW-020 and WW-025; live-test runbook and World Morph plan written. No existing target dates changed. |
| 2026-11-18 | Re-check after Kilo pushed `116e97f`: WW-030 trial merge now has 4 conflicts (dated update added; earlier "textually clean" finding kept for history). Added WW-032 (UTF-16 lines in the WebGL branch `.gitignore`). No existing target dates changed. |
| 2026-11-21 | Integration-readiness audit on `feature/persistence-studio-1121`: WW-016 IN PROGRESS (passes on branch), WW-030 IN PROGRESS (superseded path), WW-032 DONE with evidence, WW-029 recurred. Added WW-033 to WW-039. No existing target dates changed. See `docs/integration/INTEGRATION_READINESS_2026-11-21.md`. |
| 2026-11-21 | Risk closure: WW-037, WW-038 DONE with evidence; WW-033 IN PROGRESS (studio context released at teardown, renderer probe context open for Kilo); added WW-040 (DONE). No existing target dates changed. |
