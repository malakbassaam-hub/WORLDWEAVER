# World Morph Plan

Status: **PLAN ONLY. Implementation has not started.**

World Morph starts only after these gates are met:

1. Malak has run the live Gemini test and Kiro has reviewed the results
   (WW-025; see [LIVE_TEST_RUNBOOK.md](LIVE_TEST_RUNBOOK.md)).
2. The Phase 2 and WebGL branches pass their semantic tests together on an
   integration branch (WW-030).
3. Malak has confirmed the design defaults in section 2, or replaced them (WW-031).

Scope comes from `.kiro/steering/product.md` §2: *"The user may pin individual
objects… When a Morph command is issued, pinned objects are excluded from the
transformation and carried forward unchanged."* Detailed requirements need
Master Plan v1.2, so conformance is **BLOCKED (WW-023)**. This plan is
provisional and does not assume the document's contents.

Schedule: [DEVELOPMENT_SCHEDULE.md](DEVELOPMENT_SCHEDULE.md). Issues:
[ISSUE_REGISTER.md](ISSUE_REGISTER.md).

## 1. What a Morph is

A Morph is a third Director task next to Create and Edit, for example "Make the
whole kingdom darker and more apocalyptic." The model receives the world
context with pinned entities marked, and returns a World Proposal (schema v2)
that restyles many unpinned entities at once. The user reviews it and applies
it as **one atomic, undoable step**, exactly like Phase 2 proposals.

Morph v1 deliberately **reuses schema v2 operations** (add, remove, rename,
recolor, glow, move, show, hide). No new operation types means:
- the validator and translator are reused unchanged;
- the WW-025 live compatibility evidence carries over, and only one new live
  case (the morph prompt) is needed;
- the live test stays within its 9-request cap (8 existing + 1 morph).

New operations such as scale, a style catalogue or multi-stage morphs are out
of scope for v1 and need a new schema version plus a new live test.

## 2. Design defaults (WW-031: Malak confirms or replaces)

| ID | Question | Default | Reason |
|---|---|---|---|
| D-WM-1 | If a morph contains any operation the pin rules reject, is it rejected as a whole or are those operations filtered out? | **Rejected as a whole.** The preview lists every rejected operation with its reason; the user regenerates or edits the request. | Same all-or-nothing rule as Phase 2. Never applies something the user did not see. |
| D-WM-2 | Does pinning protect only the entity itself? | **The entity plus its ancestors**, for move, hide and remove. | Transforms and visibility are inherited from parents in the renderer, so moving or hiding an unpinned parent visibly changes a pinned child. |
| D-WM-3 | May a morph add children to a pinned entity? | **Yes.** | The pinned entity's own data stays unchanged. |
| D-WM-4 | Transition length | **At most 1.2 s**, instant under reduced motion and in Performance mode | Readable but never blocking |

## 3. Pinned-entity preservation

Enforced in three layers. Only layers 2 and 3 are trusted.

1. **Model guidance** (exists): the context marks `pinned: true`, and the
   system instruction forbids changing pinned entities. The morph instruction
   adds: "Pinned entities and their ancestors must not be moved, hidden or
   removed."
2. **Translator rule** (new, Kiro): a `pinClosure(world)` function returns:
   - `pinned`: entities with `pinned: true`. Operations rename, recolor, glow,
     move, show, hide and remove are rejected (this already exists in
     `resolveTarget`).
   - `protectedAncestors`: every ancestor of a pinned entity. Move, hide and
     remove are rejected; rename, recolor and glow are allowed.
   - The rejection reason names the pinned entity, for example
     *"Moving “Isle of Aurelion” would move pinned “Aurelion Citadel”."*
   - The closure is computed against the **preview** world, so an earlier
     operation in the same proposal cannot shift it.
3. **Invariant check before Apply** (new, Kiro): `assertPinnedInvariant(before,
   after, pinned)` must hold, or Apply is refused. For every pinned entity:
   - its `Entity` object is unchanged (same reference, therefore deep-equal,
     including provenance);
   - its composed world transform is unchanged (parent chain multiplied out,
     tolerance 1e-9);
   - its effective visibility is unchanged (its own and its ancestors'
     `visible`).

   This catches anything layer 2 misses, for example a future operation type.

## 4. Atomic apply, undo and redo

- Morphs use the existing `translateProposal`, then `applyTranslation`, then
  `WorldStore.dispatchBatch`. That is one undo step and one `batch` log entry,
  and redo restores the identical post-morph entity objects.
- The stale-preview guard (`baseSeq`) is reused. Any edit after the preview
  marks it stale; Refresh re-translates without a model call.
- `BatchMeta.details` gains `kind: 'morph'` (Create and Edit become
  `create` and `edit`), plus `pinnedCount` and `pinnedHash` (FNV-1a of the
  sorted pinned IDs at preview time). No prompt text is stored.
- Replay: `replayLog()` already replays batches and needs no change. A new
  test replays a session containing morphs, undo and redo.

## 5. Causal Ledger compatibility

The Causal Ledger (scheduled from 2026-11-27) will build on the store log.
Morph keeps that path simple:

- A morph is an ordinary `batch` entry of ordinary `WorldEvent`s. The ledger
  needs no morph-specific event types.
- Each batch carries what the ledger needs to explain an outcome: `kind`,
  `proposalKey`, `mode` (live or recorded), `model`, `requestId`, operation and
  event counts, and the `pinnedHash` that proves which entities were protected.
- Per-entity `provenance.lastModifiedBy = 'director'` and `lastModifiedSeq`
  link each changed entity back to its batch.
- Contract for the ledger, recorded here so World Morph does not have to
  change later: *one ledger entry per accepted batch; causes = the batch's
  proposal; effects = the entity IDs in the batch's events; rejected batches
  are recorded but have no effects.*

## 6. Renderer transition interface

The renderer is Kilo Code's. Kiro owns only the contract, which is types in
`src/core/presentation.ts` with no three.js import:

```ts
export interface WorldTransition {
  readonly kind: 'morph';
  readonly before: World;              // state before the batch
  readonly after: World;               // state after the batch (the truth)
  readonly changed: readonly EntityId[];
  readonly pinned: readonly EntityId[]; // never animated
  readonly maxDurationMs: number;       // 1200 (D-WM-4)
}

export interface TransitionPresenter {
  /** Presentation only. Must never mutate World or dispatch events. */
  play(transition: WorldTransition): Promise<void>;
  /** Stop at once and show `after` exactly (undo, new edit, dispose). */
  cancel(): void;
}
```

Rules:

1. **World state is the truth.** `renderer.sync(after)` runs first and stays
   correct with or without a transition. A transition only animates the path
   between the two states.
2. If there is no presenter, or `play` throws, the change appears instantly.
   That is today's behaviour, so World Morph can ship before Kilo's effect is
   ready.
3. `cancel()` is called on undo, redo, any new edit, a new morph, context loss
   and dispose. The frame after `cancel()` must match `after`.
4. Instant under `prefers-reduced-motion` and in Performance quality mode.
5. Pinned entities are not animated.
6. No new GPU resources survive the transition. `dispose()` cleans up.

Wiring: Kiro calls the presenter from `src/main.ts` after a successful morph
batch. Kilo implements `SceneRenderer.playTransition()` and
`cancelTransition()` in `src/render/`. Neither agent edits the other's files.

## 7. File ownership

| Area | Owner | Files |
|---|---|---|
| Core model, store, replay, contracts | Kiro | `src/core/**`, including the new `presentation.ts` |
| Director pipeline | Kiro | `src/director/**`, including the new `morph.ts` (pin closure, invariant) |
| Proxy (morph request mode, prompt, recordings) | Kiro | `server/director/**` |
| Director UI and studio wiring | Kiro | `src/ui/director.ts`, the Director section of `src/ui/styles.css`, `src/main.ts` |
| Renderer, transitions, renderer tests | **Kilo Code** | `src/render/**` |
| Studio shell | Kiro edits; Kilo proposes changes through review | `src/ui/shell.ts` (both branches touched it, see WW-030) |
| Packages, build and test configuration | Kiro only | `package.json`, `package-lock.json`, `vite.config.ts`, `playwright.config.ts`, `vitest*.config.ts`, `tsconfig*.json` |
| Tests | Kiro: `tests/e2e/**`, `tests/live/**` and `*.test.ts` outside `src/render/`; Kilo: `src/render/**/*.test.ts` and `tests/browser/**` (renderer browser tests, run as the `browser` Playwright project in Kiro's config) | |
| Docs and steering | Kiro | `docs/**`, `.kiro/**`, `README.md` |

Branching:

- World Morph is developed on `phase3/world-morph`, created from the
  integration branch of WW-030, not directly from `phase2/director`.
- Kilo's transition work goes on its own branch from the same base.
- Changes reach each other only through reviewed merges. Nothing is merged
  into `main` without Malak's approval.
- Browser suites are never run at the same time by both agents (WW-029).

## 8. Implementation steps

| Step | Owner | Target | Work | Done when |
|---|---|---|---|---|
| WM-00 | Malak, Kiro | 2026-11-21 | Gates: live results reviewed (WW-025); integration branch green (WW-030) | Recorded in the register |
| WM-01 | Kiro | 2026-11-22 | `src/director/morph.ts`: `pinClosure`, ancestor rules, `assertPinnedInvariant`; translator hook | Unit tests pass |
| WM-02 | Kiro | 2026-11-22 | Proxy: request mode `morph`, morph system-instruction lines, 3 recorded morphs (one that touches a pinned ancestor) | Proxy and recording tests pass |
| WM-03 | Kiro | 2026-11-23 | Batch metadata `kind`, `pinnedCount`, `pinnedHash`; ledger contract test | Unit tests pass |
| WM-04 | Kiro | 2026-11-23 | `src/core/presentation.ts` contract, plus presenter hook in `main.ts` with instant fallback and cancel rules | Unit tests with a mock presenter pass |
| WM-05 | Kiro | 2026-11-24 | Director UI: **Morph** task, pinned-count notice, pin-rejection reasons in the preview | Controller tests pass |
| WM-K1 | Kilo Code | 2026-11-24 to 2026-11-26 | `SceneRenderer.playTransition` / `cancelTransition` per section 6 | Kilo's renderer tests pass; reviewed |
| WM-06 | Kiro | 2026-11-25 | Browser acceptance tests (section 9) in recorded mode | 3 consecutive passing runs |
| WM-07 | Kiro, Malak | 2026-11-25 | One live morph case added to `test:live` (9th and last request); Malak runs it | Live result recorded |
| WM-08 | Kiro | 2026-11-26 | Integrate Kilo's transition; re-run all suites; update status and register | World Morph DONE with evidence |

## 9. Tests

### Unit (Kiro, `npm test`)

- `pinClosure`: pinned set, ancestors, deep chains, no pins, several pins sharing an ancestor.
- Translator rules: move, hide and remove of a pinned ancestor are rejected with a named reason; rename, recolor and glow of an ancestor are allowed; adding a child to a pinned entity is allowed.
- Invariant: for every recorded morph and 20 seeded random morphs on random worlds with random pins, each pinned entity's object, composed world transform and effective visibility are unchanged after apply.
- The invariant catches a deliberately broken translator (mutation check).
- Atomicity: a morph with one rejected operation applies nothing and adds no undo step; a valid morph is one undo step; redo restores identical objects.
- Replay: a session with morphs, user edits, undo and redo replays exactly with `replayLog()`, and no model call.
- Metadata: `kind = 'morph'`, correct `pinnedCount` and `pinnedHash`, no prompt text in the log.
- Proxy: request mode `morph` is validated, other modes are rejected; the morph instruction contains the pin rules; recorded morphs validate.
- Presenter contract with a mock: called once after Apply; `cancel` on undo, redo, a new edit and a new morph; world state is correct even if `play` throws; no call under reduced motion.

### Renderer (Kilo Code, `src/render/**`)

- `playTransition` ends showing exactly `after`; `cancelTransition` snaps immediately.
- Pinned entities are not animated; reduced motion and Performance mode are instant.
- `dispose()` during a transition leaves no resources behind.

### Browser acceptance (Kiro, `npm run test:e2e`, recorded mode)

1. Pin an extra entity, run a recorded morph, Apply. The pinned entity's name, palette, position and visibility in the inspector are identical before and after, and the other entities changed.
2. One Ctrl+Z restores the whole morph; Ctrl+Shift+Z restores it again.
3. A morph that moves a pinned entity's ancestor: the preview shows the named reason, Apply is disabled, and the world is unchanged.
4. Cancel during a morph: the late response is ignored.
5. Stale preview after a manual edit, then Refresh, then Apply.
6. With Kilo's transition: the world after the transition equals the preview, and undo during the transition snaps correctly.
7. Reduced motion: the change is instant.
8. The console stays clean.

### Live (Malak, `npm run test:live`)

One morph case: valid proposal, pinned invariant holds, applicable or cleanly
rejected. It brings the run to exactly 9 requests.

## 10. Acceptance criteria (World Morph DONE)

- All tests in section 9 pass. The browser suite passes 3 consecutive times.
- Pinned entities are preserved by data, world transform and visibility in
  every test.
- One morph is one undo step, and a session with morphs replays exactly
  without model calls.
- Batch metadata satisfies the Causal Ledger contract in section 5.
- Works with no transition, and with Kilo's transition when present.
- `status.md`, the issue register and the schedule are updated with evidence.
  Master Plan conformance stays BLOCKED (WW-023) until the document is
  supplied.
