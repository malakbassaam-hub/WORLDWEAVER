# Proposed Schedule and Register Updates, 2026-11-20 to 2026-12-03

From Kiro, 2026-11-20. **Proposal only.** The shared
`docs/ISSUE_REGISTER.md` and `docs/DEVELOPMENT_SCHEDULE.md` were not edited,
because Kilo Code may be editing them. No existing deadline is changed below:
rows marked *(existing)* keep their dates; new rows are additions. No blocker
is marked resolved; where evidence exists, it is listed for the owner to
confirm.

## 1. Register: evidence to append (status changes need the owner's confirmation)

| Issue | Register status | Evidence since | Proposed action |
|---|---|---|---|
| WW-001 WebGL context loss | BLOCKED (WW-020) | Release candidate `0bbb16e`: 10 of 10 WebGL recovery browser tests pass (SwiftShader, real `WEBGL_lose_context`) | Kilo confirms; then DONE for software WebGL, real GPU still WW-009 |
| WW-020 Kilo worktree | IN PROGRESS | Kilo branches are on the Phase 2 line (`0536b13`) | Kilo confirms DONE |
| WW-030 Integration | BLOCKED (approval) | Integrated on `release/rc-2026-11-19`; all gates PASS (audit 2026-11-19) | Malak approves the RC; then DONE |
| WW-031 Morph defaults | OPEN | Approved 2026-11-19 for D-WM-1 to D-WM-3 | DONE for D-WM-1 to D-WM-3; D-WM-4 stays OPEN |
| WW-032 `.gitignore` UTF-16 | OPEN | Valid UTF-8 on the integration line; still UTF-16 on `phase1.5/webgl-recovery` | Kilo decides whether that branch still matters |
| WW-015 Responsive layouts | OPEN | Ledger and futures panels checked at 390 px (no horizontal overflow); studio not re-checked | Unchanged |
| WW-029 Shared machine | OPEN | 2026-11-20: idle `opencode` headless Chrome and an unrelated Vite server were present; Kiro checked CPU (idle) before running its own browser tests on a separate port | Unchanged; suggest a simple lock file convention |

## 2. New items to register (next free IDs at merge time)

| Title | Severity | Owner | Target | Status |
|---|---|---|---|---|
| Ledger and futures panels not mounted in the studio | High (demo) | Kilo Code (`main.ts`) | 2026-11-23 | OPEN (contract ready) |
| Future preview not rendered in the viewport | Medium | Kilo Code | 2026-11-27 | OPEN (contract ready; UI states it is not connected) |
| Studio browser tests for the panels | Medium | Kilo Code (shared suite), Kiro (cases) | 2026-11-24 | BLOCKED (mounting) |
| Morph flag via `import.meta.env` (audit F1) | Medium | Malak, Kilo Code | 2026-11-21 | OPEN (decision) |
| Morph preview shows raw IDs (audit F2) | Low | Kilo Code | 2026-11-22 | OPEN |
| Demo video not produced | High (submission) | Malak, Kiro (script) | 2026-12-01 | OPEN |
| Final security review not done | High | Kiro | 2026-11-30 | OPEN |

## 3. Proposed day-by-day plan

| Date | Owner | Task | Depends on |
|---|---|---|---|
| 11-20 | Kiro | Ledger and Futures panels, adapter, demo page, tests (this branch) | — |
| 11-20 | Kilo | `.gitignore` on the WebGL branch (WW-032, *existing*); review the RC test fix; F2 raw IDs | — |
| 11-20 | Malak | **Live Gemini run** (WW-025, *existing* 11-19, overdue) with `docs/LIVE_TEST_RUNBOOK.md`; decide F1 | Key |
| 11-21 | Malak, Kiro | Review the live results; go or no-go for live Morph (*existing*) | Live run |
| 11-21 | Malak | Approve the release candidate (WW-030, *existing* target) | — |
| 11-21 | Kiro | WW-024 preflight key in header (*existing*); WW-005 and WW-006 (*existing* 11-20, carried) | — |
| 11-22 | Kiro | WW-008 readable names (*existing*); Morph live case in `test:live` if the 11-21 review allows | WW-025 |
| 11-23 | Kilo | Mount the panels (`UI_INTEGRATION.md` §2); studio browser cases 1, 2, 3, 5 | Branch merged into the integration line |
| 11-24 | Malak | **Master Plan v1.2**: supply it, or approve a reconstruction from product.md and status.md (WW-017, WW-023, *existing*); submission and deployment format (WW-022, *existing*) | — |
| 11-24 | Kiro | If no document by 11-24: draft "Master Plan v1.2 (reconstructed)" for Malak's approval, clearly labelled as a reconstruction | WW-023 |
| 11-25 | Kiro | Persistence design for world, ledger and futures (local, no paid services), only if WW-016 is decided | WW-016 |
| 11-25 | Kiro | Living Characters: proxy task schema, recorded turns, talk panel (after the Master Plan decision) | WW-023 |
| 11-26 | Malak | **Real-GPU verification** on the laptop (WW-009, *existing*): camera, morph transition, context loss, quality toggle, panels | Panels mounted |
| 11-26 | Kilo | Renderer future preview (`FuturePreviewPresenter`) | Panels mounted |
| 11-27 | Kiro | Living Characters minimal demo (recorded), behind the same review-before-apply flow | 11-25 |
| 11-28 | Kiro | Persistence implementation (WW-016, *existing* target) with SHA-256 ledger chain | Decision |
| 11-29 | Kiro, Kilo | Full regression: unit, studio browser ×3, WebGL, morph, panels, measurements | All features merged |
| 11-30 | Kiro | Security review: secrets in history, bundle scan, proxy controls, CSP and headers for the chosen deployment, dependency audit | WW-022 |
| 11-30 | Kiro | WW-013 bundle split (*existing*) if time permits | — |
| 12-01 | Malak, Kiro | **Demo video**: script from the recorded demo (Director, Morph with pins, Ledger, Futures, undo); record on real GPU | 11-29 |
| 12-01 | Kiro | WW-028 Vite warning (*existing*) | — |
| 12-02 | Malak | Release candidate approval for submission; merge to `main` | All above |
| 12-03 | Malak | **Final submission** (Kiroween 2026) | 12-02 |

## 4. Risks

- **Live Gemini is still unverified,** two days after its scheduled date. The
  demo can run in recorded mode, which is clearly labelled, but the
  submission should not claim live AI behaviour until WW-025 passes.
- **Master Plan v1.2 is missing.** The flagship requirements (characters,
  futures merging, ledger retention) are provisional until it is supplied or
  a reconstruction is approved.
- **No real-GPU evidence yet** (WW-009). All performance numbers come from
  SwiftShader.
