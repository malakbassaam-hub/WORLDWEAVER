# Issue Register and Schedule — Pending Delta from `phase4/ledger-futures`

Kiro did **not** edit `docs/ISSUE_REGISTER.md`, `docs/DEVELOPMENT_SCHEDULE.md`,
`README.md` or `.kiro/steering/*` on this branch, because Kilo Code may edit
them in its integration worktrees. Apply this delta when the branches are
integrated, together with
[../world-morph/REGISTER_AND_SCHEDULE_DELTA.md](../world-morph/REGISTER_AND_SCHEDULE_DELTA.md).
It changes no existing ID, owner, severity or date.

## Evidence to append to existing issues

| Issue | Append (dated 2026-11-19) |
|---|---|
| WW-031 | Approved by Malak for D-WM-1 to D-WM-3 (policies A, B, C); see the World Morph delta. D-WM-4 still open. |
| WW-016 | Causal Ledger and Parallel Futures are implemented in memory; persistence is the remaining dependency for both, and for a SHA-256 ledger chain. |
| WW-023 | Ledger and futures follow product.md §4 to §6; conformance with Master Plan v1.2 still BLOCKED. Merging futures and memory retention are open questions. |
| WW-030 | `phase4/ledger-futures` touches none of the four conflicting shared files. Trial merge into `phase1.5/integration-qa` (`bcf39c1`): no conflicts; type check, 364 unit tests and build PASS. |

## Proposed status updates (steering `status.md`, when it is next edited)

| Feature row | Current | Proposed |
|---|---|---|
| Causal Ledger | PLANNED | PARTIAL: domain logic (IDs, hash chain, state refs, field-level effects, derived consequences, live recorder, verification) on `phase4/ledger-futures`; no UI, no persistence |
| Parallel Futures / simulation branches | PLANNED | PARTIAL: domain logic (verified forks, validated steps, stale detection, rebase, atomic commit, comparison) on `phase4/ledger-futures`; no UI, no persistence |
| Provenance | PARTIAL | PARTIAL, plus `traceEntity` (direct and derived history per entity) |
| Living Characters | PLANNED | PLANNED (contract, safety boundary and ledger-grounded memories only) |

## New issues to register (use the next free IDs at merge time)

| Title | Severity | Owner | Target | Status | Acceptance criteria |
|---|---|---|---|---|---|
| Causal Ledger timeline UI not built | Medium | Kiro (`src/ui/`), Kilo (shell wiring) | 2026-11-27 | OPEN | Timeline uses `timelineItems`; undone entries dimmed; inspector shows observed and derived sections; model labels shown as model text; browser cases 6 in UI_RENDERER_HANDOFF.md §6 pass |
| Parallel Futures panel UI not built | Medium | Kiro (`src/ui/`), Kilo (shell wiring) | 2026-11-28 | OPEN | Cards from `futureCardsOf`; preview bar; Apply, Rebase, Discard; browser cases 1 to 5 pass |
| Future preview not implemented in the renderer | Medium | Kilo Code | 2026-11-28 | OPEN | `FuturePreviewPresenter` per rules P1 to P6; browser cases 1, 7 and 8 pass |
| Ledger and futures not persisted | Medium | Kiro | after WW-016 | BLOCKED (WW-016) | Reload restores the world, ledger (chain verifies) and open futures |
| Ledger hash chain is not cryptographic | Low | Kiro | with persistence | OPEN | SHA-256 chain via WebCrypto; tamper test against a recomputed 64-bit chain fails verification |
| `phase4/ledger-futures` not merged | Medium | Malak (approval), Kilo Code (integration) | 2026-11-26 | BLOCKED (WW-030) | Merged after `phase3/world-morph` into the green integration branch; all suites pass |

## Schedule rows to add (existing rows unchanged)

| Target date | Owner | Task |
|---|---|---|
| 2026-11-19 | Kiro | WW-031 approval recorded; Causal Ledger and Parallel Futures domain logic, scenarios A to E, view models and contracts on `phase4/ledger-futures` |
| 2026-11-26 | Kilo Code, Malak | Merge `phase3/world-morph` and `phase4/ledger-futures` into the green integration branch |
| 2026-11-27 | Kiro, Kilo Code | Ledger timeline UI and wiring |
| 2026-11-28 | Kiro, Kilo Code | Futures panel and renderer preview |
