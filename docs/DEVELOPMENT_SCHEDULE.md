# WORLDWEAVER Development Schedule

Window: **Wednesday 2026-11-18 to Thursday 2026-12-03** (submission preparation
target). Every date below is a **target**, not completed work. Progress is
recorded only in [ISSUE_REGISTER.md](ISSUE_REGISTER.md) by changing an issue's
status with evidence.

> **Schedule source.** The detailed day-by-day plan previously discussed for
> this window is not recorded in the repository or the development session.
> Only the 2026-12-03 target is on record. This document is a **proposed**
> schedule within that window, built from the issue register. If it differs
> from the agreed plan, the agreed plan wins; update this file to match.

## Owners

| Owner | Scope | Works in |
|---|---|---|
| Kilo Code | WebGL and rendering implementation (`src/render/**`) | Its separate worktree, on a branch from `phase1/engine-foundation` (see WW-020) |
| Kiro | Core, UI, tests, docs, build configuration | Main worktree `C:\Users\user\WORLDWEAVER` |
| Malak | Decisions, missing documents, manual GPU and visual review, merge approval | — |

## Baseline (done before this schedule)

| Date | Item | Evidence |
|---|---|---|
| 2026-11-18 | Phase 1 engine foundation committed and pushed | Commit `3459f26` on `origin/phase1/engine-foundation` |
| 2026-11-18 | Issue register and this schedule created | This documentation commit |

## Schedule

| Target date | Owner | Task | Issues | Depends on |
|---|---|---|---|---|
| 2026-11-19 | Kilo Code | Move worktree to a branch from `phase1/engine-foundation`; confirm install, tests, type check and build pass | WW-020 | — |
| 2026-11-20 | Kiro | Fix preview leakage; stop full re-renders on rejected events; re-run console check | WW-005, WW-006, WW-011 | — |
| 2026-11-21 | Kilo Code | WebGL context-loss recovery; verify WebGL-unavailable fallback; bloom capability check and fallback | WW-001, WW-002, WW-003 | WW-020 |
| 2026-11-22 | Kiro | Readable entity names in the hierarchy | WW-008 | — |
| 2026-11-24 | Kiro | Define and test undo/redo replay semantics; committed browser E2E suite (new dev dependency needs Malak's approval) | WW-007, WW-010 | Approval for E2E tooling |
| 2026-11-24 | Kilo Code | Renderer regression tests | WW-004 | WW-020 |
| 2026-11-24 | Malak | Supply Master Plan v1.2 and the Phase 1.5 visual improvement list | WW-017, WW-018 | — |
| 2026-11-26 | Malak | Measure performance on a real GPU in both quality modes | WW-009 | — |
| 2026-11-26 | Kilo Code | Reduce draw calls; tune citadel close-up glow | WW-014, WW-019 | WW-020; WW-009 readings help |
| 2026-11-26 | Kiro | Responsive and reduced-motion verification at five viewport sizes | WW-015 | — |
| 2026-11-27 | Kiro | Gap analysis of Phase 1 against Master Plan v1.2; register new issues; register Phase 1.5 items | WW-017, WW-018 | Documents from 2026-11-24 |
| 2026-11-28 | Malak, Kiro | Decide the persistence layer; implement save and reload if approved | WW-016 | Decision |
| 2026-11-28 to 2026-11-30 | Kilo Code, Kiro | Phase 1.5 visual improvements, scoped from the supplied list | New issues from WW-018 | WW-018 |
| 2026-11-30 | Kiro | Split the bundle; re-review the picomatch advisory | WW-013, WW-012 | — |
| 2026-12-01 | Kiro, Malak | Full regression: E2E suite, console health, real-GPU recheck, responsive recheck | WW-009, WW-010, WW-011, WW-015 | Prior items |
| 2026-12-02 | Malak, Kiro | Feature freeze; update `status.md` and README; decide whether to merge into `main` | All | Regression results |
| 2026-12-03 | Malak | Submission preparation target | — | Freeze |

## Not scheduled in this window

- **Phase 2 (Gemini World Director through a server-side proxy).** It has not
  been approved to start. Adding it would compete with the items above;
  schedule it only with Malak's explicit approval.
- **World Morph, Living Characters, Parallel Futures, Causal Ledger, safety
  layer.** These remain PLANNED (see `status.md`).

## Rules

1. Dates are targets. An item is done only when its register issue is **DONE** with evidence.
2. A missed target is recorded in the register's change log with a new date. It is never silently dropped.
3. Kiro does not modify `src/render/**`. Kilo Code changes arrive through review.
4. Nothing is merged into `main` or force-pushed without Malak's explicit approval.
5. BLOCKED items stay BLOCKED until the named dependency is supplied. Missing documents are never reconstructed.
