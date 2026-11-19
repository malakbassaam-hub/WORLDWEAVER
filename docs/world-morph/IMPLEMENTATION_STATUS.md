# World Morph — Implementation Status

Branch: `phase3/world-morph` (from `phase2/director` at `3139171`).
Worktree: `C:\Users\user\WORLDWEAVER-MORPH`. Last updated: 2026-11-18.

**World Morph is implemented and unit-tested, but NOT enabled anywhere.**
Its gates in [../WORLD_MORPH_PLAN.md](../WORLD_MORPH_PLAN.md) are not met:

| Gate | Status |
|---|---|
| Live Gemini results reviewed (WW-025) | **BLOCKED**: needs Malak's key |
| Phase 2 / WebGL integration branch green (WW-030) | In progress (Kilo Code) |
| Design defaults D-WM-1 to D-WM-4 confirmed (WW-031) | **Not approved**: implemented as a configurable policy marked `approved: false` |

## What is implemented

| Plan step | Status | Where | Evidence |
|---|---|---|---|
| WM-01 pin closure, ancestor rules, pinned invariant | **Implemented** | `src/director/morph.ts`, `src/core/pose.ts` | `morph.test.ts` (25), `pose.test.ts` (6, checked against three.js) |
| WM-02 proxy morph mode, instruction, recordings | **Implemented, off by default** | `server/director/{request,prompt,recordings,config,handler}.ts` | `server/director/morph.test.ts` (6), `recordings.test.ts` |
| WM-03 Ledger-ready batch metadata | **Implemented** | `src/director/apply.ts`, `morph.ts` | `morph.test.ts`, `ledger.test.ts` |
| WM-04 transition contract and coordinator | **Contract and coordinator implemented; not wired** | `src/core/presentation.ts` | `presentation.test.ts` (6) |
| WM-05 Director Morph task | **Controller implemented, off by default; no UI** | `src/director/controller.ts` (`generateMorph`) | `controller.morph.test.ts` (6) |
| WM-K1 renderer transition | Not started (Kilo Code) | `src/render/**` | — |
| WM-06 browser acceptance tests | **Not started**: needs the UI and a shared-config change | — | — |
| WM-07 live morph case | **Not started**: waits for the WW-025 review | — | — |
| WM-08 integration | Not started | — | — |

### Behaviour

- **Morph = one World Proposal (schema v2)** applied with extra pin rules. No
  new operation types, so validation and translation are unchanged.
- **Pinned entities** cannot be renamed, recoloured, glowed, moved, shown,
  hidden or removed (existing rule, now tagged `rule: 'pinned'`).
- **Ancestors of pinned entities** cannot be moved, hidden, shown or removed
  (`rule: 'pinned-ancestor'`), because position and visibility are inherited.
  Recolour, glow and rename of ancestors are allowed. Descendants of pinned
  entities are free.
- **Children may be added under a pinned entity** by default; the policy can
  block it (`rule: 'pinned-parent'`).
- **Pinned invariant (second layer):** before apply, each pinned entity's
  data, world pose (computed like the renderer: position and rotation
  inherited, scale not) and effective visibility must be unchanged in the
  preview. It is re-checked in `applyMorph`.
- **All-or-nothing:** non-pin rejections (unknown refs, invalid values, no-ops)
  always block a morph. Pin rejections block it under `reject-proposal`
  (proposed default) or are dropped and listed under `drop-operation`.
- **One undo step** per morph (`dispatchBatch`); redo restores identical
  objects; `replayLog` reproduces sessions with morphs exactly and never calls
  Gemini.
- **Batch details** (Causal Ledger input): `kind: 'morph'`, `pinnedCount`,
  `pinnedHash`, `policy`, `policyApproved: 'false'`, `pinRejections`,
  `proposalKey`, `mode`, and `model`, `requestId` or `recordingId` when known.
  No prompt text.
- **Off by default:** the browser controller refuses with `MORPH_DISABLED`
  unless constructed with `morph: { enabled: true }`; the proxy rejects
  `mode: "morph"` with HTTP 400 unless started with `DIRECTOR_MORPH=1`.
  `src/main.ts` passes nothing, so the studio is unchanged.
- **Create and Edit are unchanged,** including the exact Gemini system
  instruction used by the pending live test.

### Recorded morphs (served only with `DIRECTOR_MORPH=1`)

| Id | What it does | Expected result |
|---|---|---|
| `morph-violet-dusk` (default) | Violet spires, violet main isle and Veilstone Reach, softer wisps, hidden halo | Applicable; citadel unchanged |
| `morph-ember-ruin` | Ember spires, sunken Emberglass Rest, hidden wisps, new ember obelisk | Applicable |
| `morph-shift-isle` | Lifts the Isle of Aurelion (parent of the pinned citadel) | **Blocked** with a named reason |

## Contracts prepared for later features (not features)

| Feature | What exists | What does NOT exist |
|---|---|---|
| Causal Ledger | `src/core/ledger.ts`: reference projection of the store log; exact effects; undo/redo targets; `explainEntity` | Hash chain, persistence, UI |
| Parallel Futures | `src/core/futures.ts`: snapshot refs, deterministic restore, independent fork, compare | BranchManager service, persistence, timeline UI, viewport comparison |
| Living Characters | `src/director/characters.ts`: turn admission (reply plus proposal through the standard validator, never applied) and grounded memories | Character archetype, talk UI, proxy task, memory persistence, model calls |

Designs: [../architecture/CAUSAL_LEDGER.md](../architecture/CAUSAL_LEDGER.md),
[../architecture/PARALLEL_FUTURES.md](../architecture/PARALLEL_FUTURES.md),
[../architecture/LIVING_CHARACTERS.md](../architecture/LIVING_CHARACTERS.md).

## Verification (2026-11-18, on this branch)

| Check | Result |
|---|---|
| Type check (browser, server, tests) | PASS |
| Unit tests | **289 passed, 0 failed, 0 skipped** in 21 files (225 Phase 2 baseline + 64 new) |
| Production build | PASS; bundle contains no key values, auth header name or Gemini URL |
| Mutation checks | 8 of 8 deliberate breakages caught (ancestor rule, pose and visibility invariant, reject policy, closure, pose maths, controller gate, server gate) |
| Browser tests | **NOT RUN** for World Morph: there is no UI, and enabling it needs shared-file changes (see the handoff) |
| Live Gemini | **NOT RUN / BLOCKED**: no key; nothing is claimed about live morph behaviour |

## Ready for a browser demonstration?

- **Phase 2 Director (Create and Edit, recorded mode): yes**, unchanged.
- **World Morph: no.** It needs the WW-031 decision, a Morph task in
  `src/ui/director.ts` (Kiro), and the integration hooks in
  [KILO_HANDOFF.md](KILO_HANDOFF.md).
