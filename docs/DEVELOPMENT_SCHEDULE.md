# WORLDWEAVER Development Schedule

Window: **Wednesday 2026-11-18 to Thursday 2026-12-03** (submission preparation
target). Every date below is a **target**, not completed work. Progress is
recorded only in [ISSUE_REGISTER.md](ISSUE_REGISTER.md), by changing an issue's
status with evidence. Phase 2 details: [PHASE2_PLAN.md](PHASE2_PLAN.md).

> **Schedule source.** The detailed day-by-day plan previously discussed for
> this window is not recorded in the repository or the development session.
> Only the 2026-12-03 target is on record. This document is a **proposed**
> schedule within that window, built from the issue register and the Phase 2
> plan. If it differs from the agreed plan, the agreed plan wins; update this
> file to match.

## Owners

| Owner | Scope | Works in |
|---|---|---|
| Kilo Code | WebGL and rendering implementation (`src/render/**`), including new archetypes and visual effects for the flagship features | Its separate worktree (`WORLDWEAVER-WEBGL`, branch `phase1.5/webgl-recovery`; see WW-020) |
| Kiro | Core, Director pipeline and proxy, UI, tests, docs, build configuration | Main worktree `C:\Users\user\WORLDWEAVER` |
| Malak | Decisions, missing documents, live Gemini runs, manual GPU and visual review, merge approval | — |

## Baseline (done before this schedule)

| Date | Item | Evidence |
|---|---|---|
| 2026-11-18 | Phase 1 engine foundation committed and pushed | Commit `3459f26` on `origin/phase1/engine-foundation` |
| 2026-11-18 | Issue register and first schedule | Commit `23e676e` |
| 2026-11-18 | Phase 2 plan, register update and this schedule | Commit `3be7356` |
| 2026-11-18 | Phase 2 approved (WW-021); P2-01 schema and validator and P2-03 translator implemented ahead of their 2026-11-20 and 2026-11-21 targets | Branch `phase2/director` |
| 2026-11-18 | P2-04 atomic batches and log replay (WW-007, WW-027), P2-05 proxy with live and recorded modes, P2-06 active Director panel, P2-07 browser acceptance suite (WW-010, WW-011), P2-02 live suite written, all ahead of target. **P2-08 live smoke and the live run of P2-02 are BLOCKED** until Malak runs them with her key. | Commits `95c62cf` to `9c7d406` on `phase2/director` |

## Status update (2026-11-18)

Phase 2 implementation finished about five days ahead of the 2026-11-23 to
2026-11-25 targets, except live Gemini verification (WW-025, P2-08), which
needs Malak's key. The dates below are unchanged: they remain targets. Freed
time should go first to the flagship features on the critical path (World
Morph, Causal Ledger, Parallel Futures, Living Characters). Any move to
earlier dates should be agreed with Malak and recorded in the register's
change log.

## Schedule

Task IDs: `P2-xx` are Phase 2 steps (see [PHASE2_PLAN.md](PHASE2_PLAN.md)
section 12). `WM`, `LC`, `PF` and `CL` are World Morph, Living Characters,
Parallel Futures and Causal Ledger. `INT` is final integration. `WW-xxx` are
register issues, whose target dates are unchanged from the previous schedule.

| Target date | Owner | Task | IDs | Depends on |
|---|---|---|---|---|
| 2026-11-19 | Malak | **Approve Phase 2 start, proxy runtime and fixture mode** | WW-021, P2-00 | — |
| 2026-11-19 | Kilo Code | Confirm install, tests, type check and build in the WebGL worktree | WW-020 | — |
| 2026-11-19 | Malak | **Run the live Gemini test and the Create/Edit smoke test with your own key** ([LIVE_TEST_RUNBOOK.md](LIVE_TEST_RUNBOOK.md)); send back the summary, never the key | WW-025, P2-08 | — |
| 2026-11-20 | Kiro | Schema v2 and validator with fixtures and unit tests | P2-01 | — |
| 2026-11-20 | Kiro | Fix preview leakage; stop full re-renders on rejected events; re-run console check | WW-005, WW-006, WW-011 | — |
| 2026-11-20 | Malak | Approve creating `integration/phase2-webgl`: Kilo's `phase1.5/webgl-recovery` merged into a copy of `phase2/director`, with `main` untouched | WW-030 | — |
| 2026-11-21 | Kiro | Write the v2 live preflight script (header-based key; existing script untouched); translator with deterministic IDs and layout | P2-02, P2-03, WW-024 | P2-01 |
| 2026-11-21 | Malak | Run the v2 live preflight (at most 9 calls) | WW-025 | P2-02 |
| 2026-11-21 | Kilo Code | WebGL context-loss recovery; verify WebGL-unavailable fallback; bloom capability check and fallback | WW-001, WW-002, WW-003 | WW-020 |
| 2026-11-21 | Kiro, Kilo Code | Integration branch: type check, unit tests, build, browser suite ×3 and a context-loss browser test; each owner fixes semantic conflicts in their own files | WW-030, WW-001 | Approval (11-20) |
| 2026-11-21 | Malak, Kiro | Review the live results; go or no-go for World Morph | WW-025, WM-00 | Live run (11-19) |
| 2026-11-22 | Kiro | Readable entity names in the hierarchy; start atomic batch dispatch | WW-008, P2-04 | — |
| 2026-11-22 | Malak | Confirm or replace the World Morph defaults D-WM-1 to D-WM-4 | WW-031 | — |
| 2026-11-22 | Kiro | WM-01 pin closure and pinned invariant; WM-02 morph request mode, instruction and recordings | WM | WM-00 |
| 2026-11-23 | Kiro | Finish `dispatchBatch` with undo and replay semantics; reducer rejects no-op visual and transform changes; Director proxy plus fixture mode and security controls | P2-04, P2-05, WW-007, WW-027 | P2-00, P2-03 |
| 2026-11-24 | Kiro | Director client, planner and panel (review, Apply, Discard, Retry, error states); close undo/replay semantics; committed browser E2E suite (new dev dependency needs approval) | P2-06, WW-007, WW-010 | P2-04, P2-05; E2E tooling approval |
| 2026-11-23 | Kiro | WM-03 Ledger-ready batch metadata; WM-04 transition contract and presenter hook (instant fallback) | WM | WM-01 |
| 2026-11-24 | Kilo Code | Renderer regression tests | WW-004 | WW-020 |
| 2026-11-24 | Kiro | WM-05 Director Morph task, with pin-rejection reasons in the preview | WM | WM-04 |
| 2026-11-24 to 2026-11-26 | Kilo Code | WM-K1 `SceneRenderer.playTransition` and `cancelTransition` per the contract | WM | WM-04, WW-030 |
| 2026-11-24 | Malak | Supply Master Plan v1.2 and the Phase 1.5 visual list; decide the submission and deployment format | WW-017, WW-018, WW-022, WW-023 | — |
| 2026-11-25 | Kiro | Phase 2 browser acceptance in fixture mode; quota-safe states and "Recorded responses" badge; Phase 2 checkpoint branch and pull request | P2-07, P2-09, WW-026 | P2-06, WW-010 |
| 2026-11-25 | Malak, Kiro | Live smoke test with the real key; **flagship depth decision** (how deep each feature goes by 2026-12-03; no feature removed) | P2-08 | P2-06 |
| 2026-11-25 | Kiro, Kilo Code | Agree a rule so browser suites do not run at the same time; optional fast smoke subset | WW-029 | — |
| 2026-11-25 | Kiro, Malak | WM-06 browser acceptance tests (3 consecutive runs); WM-07 one live morph case (the 9th request) | WM | WM-05 |
| 2026-11-26 | Kiro | World Morph with pinned-object enforcement on the Phase 2 pipeline (provisional scope): WM-08 integrates Kilo's transition; World Morph DONE with evidence ([WORLD_MORPH_PLAN.md](WORLD_MORPH_PLAN.md)) | WM | P2-09, WM-06, WM-K1 |
| 2026-11-26 | Kiro | Responsive and reduced-motion verification at five viewport sizes | WW-015 | — |
| 2026-11-26 | Kilo Code | Reduce draw calls; tune citadel close-up glow; optional Morph transition effect | WW-014, WW-019, WM | WW-020 |
| 2026-11-26 | Malak | Measure performance on a real GPU in both quality modes | WW-009 | — |
| 2026-11-27 | Kiro | Causal Ledger core: hash chain, cause links, verify (provisional scope) | CL | P2-04 |
| 2026-11-27 | Kiro | Gap analysis of Phase 1 and this plan against Master Plan v1.2; register Phase 1.5 items | WW-017, WW-018, WW-023 | Documents from 2026-11-24 |
| 2026-11-27 | Kilo Code | Character archetype for Living Characters | LC | WW-020 |
| 2026-11-28 | Malak, Kiro | Decide and implement persistence (needed by the Ledger and character memory) | WW-016 | Decision |
| 2026-11-28 | Kiro | Causal Ledger `explain()` in the inspector | CL | WW-016 |
| 2026-11-28 to 2026-11-30 | Kilo Code, Kiro | Phase 1.5 visual improvements, scoped from the supplied list | New issues from WW-018 | WW-018 |
| 2026-11-29 | Kiro | Parallel Futures: fork, switch, compare and discard; timeline branches (provisional scope) | PF | WW-007, P2-04 |
| 2026-11-29 | Kilo Code | Branch comparison visuals in the viewport | PF | PF core |
| 2026-11-30 | Kiro | Living Characters: memory store and talk flow, part 1 (provisional scope); split the bundle; re-review the picomatch advisory | LC, WW-013, WW-012 | WW-016, P2-05 |
| 2026-12-01 | Kiro | Living Characters, part 2; final integration scenario (create → edit → pin → morph → fork → talk → explain → undo → reload) | LC, INT | All features |
| 2026-12-01 | Kiro, Malak | Full regression: E2E suite, console health, real-GPU recheck, responsive recheck | INT, WW-009, WW-010, WW-011, WW-015 | INT scenario |
| 2026-12-01 | Kiro | Make the Vite config native-loader compatible (or pin the bundler loader) | WW-028 | — |
| 2026-12-02 | Kiro | Master Plan conformance review of all flagship features | WW-023 | **BLOCKED until WW-017 is resolved** |
| 2026-12-02 | Malak, Kiro | Feature freeze; update `status.md` and README; decide whether to merge into `main` | INT | Regression results |
| 2026-12-03 | Malak | Submission preparation target | — | Freeze |

## Day-by-day

| Date | Main focus | Who |
|---|---|---|
| 2026-11-19 | Live Gemini test and smoke test (runbook); Kilo worktree checks | Malak, Kilo Code |
| 2026-11-20 | Approve the integration branch; preview-leak and redundant-render fixes | Malak, Kiro |
| 2026-11-21 | Integration branch green; live results reviewed (World Morph gate) | Kiro, Kilo Code, Malak |
| 2026-11-22 | World Morph defaults; WM-01 and WM-02 | Malak, Kiro |
| 2026-11-23 | WM-03 and WM-04 | Kiro |
| 2026-11-24 | WM-05; Kilo transition starts; Master Plan, Phase 1.5 list and submission format due | Kiro, Kilo Code, Malak |
| 2026-11-25 | WM-06 and WM-07; flagship depth decision; browser-suite coordination rule | Kiro, Malak, Kilo Code |
| 2026-11-26 | World Morph DONE; responsive checks; real-GPU measurement | Kiro, Kilo Code, Malak |
| 2026-11-27 | Causal Ledger core; Master Plan gap analysis | Kiro, Kilo Code |
| 2026-11-28 | Persistence; Ledger `explain()`; Phase 1.5 visuals | Malak, Kiro, Kilo Code |
| 2026-11-29 | Parallel Futures | Kiro, Kilo Code |
| 2026-11-30 | Living Characters part 1; bundle split; audit re-check | Kiro |
| 2026-12-01 | Living Characters part 2; integration scenario; full regression; Vite loader fix | Kiro, Malak |
| 2026-12-02 | Master Plan conformance (BLOCKED without the document); feature freeze | Kiro, Malak |
| 2026-12-03 | Submission preparation target | Malak |

## Critical path

```
WW-021 approval (11-19)
  → P2-01 schema + validator (11-20)
  → P2-02/WW-025 live v2 preflight (11-21) ─┐
  → P2-03 translator (11-21) ───────────────┤
  → P2-04 dispatchBatch + undo/replay, WW-007 (11-23)
  → P2-05 proxy (11-23) → P2-06 Director panel (11-24)
  → P2-07/P2-09 acceptance + checkpoint (11-25)
  → WW-025 live run (11-19) and review (11-21) ─┐
  → WW-030 integration branch green (11-21) ────┤ gates
  → WW-031 Morph defaults (11-22) ──────────────┘
  → WM World Morph (WM-01 11-22 … WM-08 11-26)
  → CL Causal Ledger (11-27/28) ← WW-016 persistence (11-28)
  → PF Parallel Futures (11-29)
  → LC Living Characters (11-30/12-01) ← WW-016, Kilo LC archetype (11-27)
  → INT integration + regression (12-01) → freeze (12-02) → submission (12-03)
```

- **Float:** Phase 2 finished early, so World Morph can start on 2026-11-22 instead of 2026-11-26, but only after its three gates. From 2026-11-26 there is no float: every flagship feature is on the critical path because Kiro builds them in sequence.
- **Parallel tracks (off the critical path):** Kilo Code WebGL hardening (WW-001 to WW-004, WW-014, WW-019) and rendering for the flagship features; Malak's decisions and documents.
- **Earliest blocker:** WW-021 on 2026-11-19. P2-01 and P2-03 can start without it, but P2-05 (proxy) cannot.

## Realism and slip rules

- Kiro has 21 scheduled tasks on 13 of the 15 days, most of them on the
  critical path. Kilo Code has 7 and Malak 9. The schedule is feasible only if
  decisions arrive on time and the provisional flagship scope in
  `PHASE2_PLAN.md` section 10 is accepted.
- On 2026-11-25, Malak decides how deep each flagship feature goes for
  2026-12-03. Depth may be reduced, for example Living Characters with
  in-session memory first. **No flagship feature is removed.**
- If time is short, Low-severity items slip first: WW-008, WW-012 and WW-013.
  A slip is recorded in the register's change log with a new date. Nothing is
  dropped.
- Any item marked "BLOCKED" stays blocked until its named dependency is
  resolved. The Master Plan conformance review cannot be completed without the
  original document.

## Not scheduled in this window

- **Safety layer** (`product.md` §7): Phase 2 relies on Gemini safety signals
  and client validation only. A configurable content policy is not scheduled
  and remains PLANNED. Scheduling it needs Malak's decision and probably
  Master Plan input (WW-023).
- **Physics and simulation** (`SimulationSystem`): not scheduled; remains PLANNED.

## Rules

1. Dates are targets. An item is done only when its register issue is **DONE** with evidence.
2. A missed target is recorded in the register's change log with a new date. It is never silently dropped.
3. Kiro does not modify `src/render/**`. Kilo Code changes arrive through review.
4. Nothing is merged into `main` or force-pushed without Malak's explicit approval.
5. BLOCKED items stay BLOCKED until the named dependency is supplied. Missing documents are never reconstructed.
6. Phase 2 implementation starts only after WW-021 is approved.
