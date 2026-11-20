# Causal Ledger and Parallel Futures — Implementation Status

Branch: `phase4/ledger-futures`, from `phase3/world-morph` at `b9f3741`.
Worktree: `C:\Users\user\WORLDWEAVER-LEDGER`. Last updated: 2026-11-19.
Nothing here is merged, and nothing is wired into the studio
(`src/main.ts`, `src/ui/shell.ts` and `src/render/**` are unchanged).

## Update 2026-11-20: panels built (branch `feature/ledger-futures-ui-1120`)

| Item | Status | Evidence |
|---|---|---|
| Causal Ledger panel: timeline, filters, expandable details, before/after fields, recorded / observed / derived sections, AI-text labelling, undo state, batch actions, empty, loading and error states, keyboard | **Built and tested** | `ledgerModel.test.ts` (12), panel browser tests 1 to 4 |
| Parallel Futures panel: baseline, up to 4 cards, create, Preview vs Apply, Rebase, per-future undo/redo, discard, pin feedback, Director prompt inside a future, side-by-side comparison, contested filter | **Built and tested** | `futuresModel.test.ts` (7), `futureRequest.test.ts` (7), panel browser tests 5 to 10 |
| Integration adapter `mountLedgerFutures` | **Built and tested** (demo page) | [UI_INTEGRATION.md](UI_INTEGRATION.md) |
| Mounted in the studio (`src/main.ts`) | **PENDING** (Kilo Code, shared file) | — |
| Viewport preview of a future | **NOT IMPLEMENTED** (renderer); the UI says so | — |
| Recorded demo page | Built (`ledger-futures-demo.html`, dev server only) | `fixtures.test.ts` (2) |

Verification on 2026-11-20: type check PASS; 391 unit tests passed, 0 failed,
0 skipped (30 files); production build PASS, and the demo and panels are not
in the production bundle; panel browser tests 10 of 10 PASS. Studio browser
tests for the panels are PENDING until they are mounted.

## Readiness by feature

| Feature | Domain logic | UI / renderer | Persistence | Ready for |
|---|---|---|---|---|
| Causal Ledger | **Implemented and tested** | Not started; view models and contract ready | Not started (WW-016) | Code review and UI integration |
| Parallel Futures | **Implemented and tested** | Not started; view models and preview contract ready | Not started (WW-016) | Code review and UI integration |
| Living Characters | Contract and safety boundary, ledger-grounded memories | Not started (character archetype is Kilo's) | Not started | Design review only; no feature to demonstrate |
| World Morph policy WW-031 | Approved defaults recorded and tested | Morph UI not started | — | Code review; enabling still needs WW-025 and WW-030 |

## What was built

| Area | Files | Tests |
|---|---|---|
| WW-031 approval: `APPROVED_MORPH_POLICY`, `MORPH_POLICY_STATUS.approved = true` | `src/director/morph.ts` | `morph.policy.test.ts` (10), `morph.test.ts` (25) |
| Fingerprints: canonical JSON, 64-bit hash, per-entity cache, state refs | `src/core/fingerprint.ts` | `fingerprint.test.ts` (6) |
| Structural checks for events and log entries | `src/core/wellformed.ts` | `fingerprint.test.ts`, `ledger.test.ts` |
| Pinned invariant shared by Morph and Futures (moved, API unchanged) | `src/core/pins.ts` | `morph*.test.ts`, `futures.test.ts` |
| Causal Ledger: IDs, hash chain, state refs, field-level changes, derived consequences, in-effect tracking, live recorder, verification, entity trace | `src/core/ledger.ts` | `ledger.test.ts` (25) |
| Parallel Futures: verified fork, snapshot fork, validated steps, undo/redo, compare, contested entities, stale detection, rebase, atomic commit, discard, bounds | `src/core/futures.ts` | `futures.test.ts` (22) |
| Director and Morph proposals inside a future | `src/director/futures.ts` | `director/futures.test.ts` (6) |
| Cross-feature scenarios A to E | — | `scenarios.test.ts` (5) |
| UI view models: timeline items, entry inspection, future cards | `src/core/historyView.ts` | `historyView.test.ts` (5) |
| Renderer contract: future preview | `src/core/presentation.ts` | `historyView.test.ts` |
| Living Characters: ledger grounding, futures and morph helpers | `src/director/characters.ts` | `characters.test.ts` (8) |
| Opt-in measurements | `src/core/ledger.measure.ts`, `vitest.measure.config.ts` | Run separately |

Designs: [../architecture/CAUSAL_LEDGER.md](../architecture/CAUSAL_LEDGER.md),
[../architecture/PARALLEL_FUTURES.md](../architecture/PARALLEL_FUTURES.md),
[../architecture/LIVING_CHARACTERS.md](../architecture/LIVING_CHARACTERS.md).
Integration: [UI_RENDERER_HANDOFF.md](UI_RENDERER_HANDOFF.md).

## Cross-feature scenarios (`src/director/scenarios.test.ts`)

They use the recorded Director responses that the proxy serves in recorded
mode.

| Scenario | What is checked |
|---|---|
| A. Morph and history | `morph-violet-dusk` changes several entities in one batch and one ledger entry; undo and redo restore exact fingerprints; the ledger shows proposal, undo and redo |
| B. Protected objects | `morph-shift-isle` (lifts the parent of the pinned citadel) is rejected whole, with no log entry and no change, both in the world and inside a future |
| C. Alternative futures | Violet and Ember futures from one snapshot differ, both respect pins, the original is unchanged; committing Ember reproduces its preview exactly and makes Violet stale |
| D. Stale future | A user edit after the fork makes the commit fail with `STALE`; world and log unchanged |
| E. Coherent history | Edit, Director create, morph, undo, redo, committed future and undo: the ledger is consistent, the chain verifies, the recorder equals a rebuild, replay matches, every observed change links to an action that targeted it, undo/redo point at real change entries, and model labels are marked as model text |

## Verification (2026-11-19)

| Check | Result |
|---|---|
| Type check (browser, server, tests) | PASS |
| Unit tests | **364 passed, 0 failed, 0 skipped** in 26 files (289 on `phase3/world-morph` + 75 new) |
| Production build | PASS. No key value, auth header name or Gemini URL in the bundle; the environment variable name appears in the existing Director help text only |
| Mutation checks | 15 of 16 caught. The survivor removes the commit dry-run equality check, which cannot fail by construction (defence in depth). The first run found 3 gaps that were then covered by new tests |
| Property tests | Ledger recorder = rebuild over 40 random sessions; futures invariants over 80 random sessions; morph pins over 60 random morphs |
| Trial merge with `phase1.5/integration-qa` (`bcf39c1`) | No conflicts; type check, 364/364 unit tests and build PASS on the merged tree (temporary detached worktree, removed afterwards) |
| Trial merge with `phase1.5/webgl-recovery` (`116e97f`) | The same 4 config conflicts as `phase2/director`; no new ones |
| Browser tests | **NOT APPLICABLE**: there is no ledger or futures UI yet |
| Live Gemini | **BLOCKED**: no key. Nothing here calls a model; futures use the same validator for live and recorded output |

## Known limitations

- The hash chain is not cryptographic (see CAUSAL_LEDGER.md).
- Ledger and futures live in memory only; reload loses them, as it loses the
  world (WW-016).
- The store log, and therefore the ledger, is unbounded within a session.
- One source per future, because a commit is one store batch (mixed
  user and Director futures would need a store change).
- Any change to the original world, including undo, makes every open future
  stale; rebase is explicit.
- Futures cannot be merged with each other.
- `inspectEntry` replays from the start for each call (fast at current sizes;
  cache in the UI if needed).
