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
| 2026-11-18 | Phase 2 plan, register update and this schedule | This documentation commit |

## Schedule

Task IDs: `P2-xx` are Phase 2 steps (see [PHASE2_PLAN.md](PHASE2_PLAN.md)
section 12). `WM`, `LC`, `PF` and `CL` are World Morph, Living Characters,
Parallel Futures and Causal Ledger. `INT` is final integration. `WW-xxx` are
register issues, whose target dates are unchanged from the previous schedule.

| Target date | Owner | Task | IDs | Depends on |
|---|---|---|---|---|
| 2026-11-19 | Malak | **Approve Phase 2 start, proxy runtime and fixture mode** | WW-021, P2-00 | — |
| 2026-11-19 | Kilo Code | Confirm install, tests, type check and build in the WebGL worktree | WW-020 | — |
| 2026-11-20 | Kiro | Schema v2 and validator with fixtures and unit tests | P2-01 | — |
| 2026-11-20 | Kiro | Fix preview leakage; stop full re-renders on rejected events; re-run console check | WW-005, WW-006, WW-011 | — |
| 2026-11-21 | Kiro | Write the v2 live preflight script (header-based key; existing script untouched); translator with deterministic IDs and layout | P2-02, P2-03, WW-024 | P2-01 |
| 2026-11-21 | Malak | Run the v2 live preflight (at most 9 calls) | WW-025 | P2-02 |
| 2026-11-21 | Kilo Code | WebGL context-loss recovery; verify WebGL-unavailable fallback; bloom capability check and fallback | WW-001, WW-002, WW-003 | WW-020 |
| 2026-11-22 | Kiro | Readable entity names in the hierarchy; start atomic batch dispatch | WW-008, P2-04 | — |
| 2026-11-23 | Kiro | Finish `dispatchBatch` with undo and replay semantics; Director proxy plus fixture mode and security controls | P2-04, P2-05, WW-007 | P2-00, P2-03 |
| 2026-11-24 | Kiro | Director client, planner and panel (review, Apply, Discard, Retry, error states); close undo/replay semantics; committed browser E2E suite (new dev dependency needs approval) | P2-06, WW-007, WW-010 | P2-04, P2-05; E2E tooling approval |
| 2026-11-24 | Kilo Code | Renderer regression tests | WW-004 | WW-020 |
| 2026-11-24 | Malak | Supply Master Plan v1.2 and the Phase 1.5 visual list; decide the submission and deployment format | WW-017, WW-018, WW-022, WW-023 | — |
| 2026-11-25 | Kiro | Phase 2 browser acceptance in fixture mode; quota-safe states and "Recorded responses" badge; Phase 2 checkpoint branch and pull request | P2-07, P2-09, WW-026 | P2-06, WW-010 |
| 2026-11-25 | Malak, Kiro | Live smoke test with the real key; **flagship depth decision** (how deep each feature goes by 2026-12-03; no feature removed) | P2-08 | P2-06 |
| 2026-11-26 | Kiro | World Morph with pinned-object enforcement on the Phase 2 pipeline (provisional scope) | WM | P2-09 |
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
| 2026-12-02 | Kiro | Master Plan conformance review of all flagship features | WW-023 | **BLOCKED until WW-017 is resolved** |
| 2026-12-02 | Malak, Kiro | Feature freeze; update `status.md` and README; decide whether to merge into `main` | INT | Regression results |
| 2026-12-03 | Malak | Submission preparation target | — | Freeze |

## Critical path

```
WW-021 approval (11-19)
  → P2-01 schema + validator (11-20)
  → P2-02/WW-025 live v2 preflight (11-21) ─┐
  → P2-03 translator (11-21) ───────────────┤
  → P2-04 dispatchBatch + undo/replay, WW-007 (11-23)
  → P2-05 proxy (11-23) → P2-06 Director panel (11-24)
  → P2-07/P2-09 acceptance + checkpoint (11-25)
  → WM World Morph (11-26)
  → CL Causal Ledger (11-27/28) ← WW-016 persistence (11-28)
  → PF Parallel Futures (11-29)
  → LC Living Characters (11-30/12-01) ← WW-016, Kilo LC archetype (11-27)
  → INT integration + regression (12-01) → freeze (12-02) → submission (12-03)
```

- **Float:** none after 2026-11-25. Every flagship feature is on the critical path because Kiro builds them in sequence.
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
