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
| WW-007 | Undo/redo sequence semantics are undefined for replay and provenance | Medium | Kiro | 2026-11-24 | OPEN |
| WW-008 | Entity names truncated in the hierarchy | Low | Kiro | 2026-11-22 | OPEN |
| WW-009 | Performance on real GPU hardware not tested | Medium | Malak | 2026-11-26 | OPEN |
| WW-010 | Browser end-to-end tests not committed | Medium | Kiro | 2026-11-24 | OPEN |
| WW-011 | Console and shadow-warning check not re-run after fix | Low | Kiro | 2026-11-20 | OPEN |
| WW-012 | Development-only picomatch advisory | Low | Kiro | 2026-11-30 | OPEN |
| WW-013 | Bundle is a single 664 kB chunk | Low | Kiro | 2026-11-30 | OPEN |
| WW-014 | Draw-call count is high | Medium | Kilo Code | 2026-11-26 | BLOCKED (WW-020) |
| WW-015 | Responsive layouts not verified | Medium | Kiro | 2026-11-26 | OPEN |
| WW-016 | World state is in memory only | Medium | Kiro | 2026-11-28 | BLOCKED (decision) |
| WW-017 | Phase 1 not verified against Master Plan v1.2 | High | Malak | 2026-11-24 | BLOCKED (document) |
| WW-018 | Phase 1.5 visual improvement list not available | Medium | Malak | 2026-11-24 | BLOCKED (list) |
| WW-019 | Citadel close-up glow washes out detail | Low | Kilo Code | 2026-11-26 | BLOCKED (WW-020) |
| WW-020 | Kilo Code worktree is on the pre-Phase-1 commit | High | Kilo Code | 2026-11-19 | OPEN |

**Totals:** 20 issues. High 4, Medium 10, Low 6. OPEN 11, BLOCKED 9, IN PROGRESS 0, DONE 0.

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
| Status | OPEN |

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
| Status | OPEN |

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

### WW-011 — Console and shadow-warning check not re-run after fix

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-20 |
| Status | OPEN |

**Description.** The full console-health check (0 errors) passed before
`PCFSoftShadowMap` was replaced with `PCFShadowMap`. The later runs ended before
the console step, so the warning's removal and continued error-free startup are
unconfirmed.

**Acceptance criteria.**
- A fresh full browser run reports 0 console errors, 0 shader or program errors, and no `PCFSoftShadowMap` warning.

**Verification evidence.**
- Current: earlier run reported 0 errors and 5 warnings, including the `PCFSoftShadowMap` deprecation.
- To close: console log from a full run on the current code.

### WW-012 — Development-only picomatch advisory

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Kiro |
| Target | 2026-11-30 |
| Status | OPEN |

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
| Status | OPEN |

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
- Current: `git worktree list` output on 2026-11-18.
- To close: `git worktree list` and `git log -1` from the Kilo worktree, plus passing checks.

---

## Change log

| Date | Change |
|---|---|
| 2026-11-18 | Register created from the Phase 1 review: WW-001 to WW-020. |
