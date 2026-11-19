# Parallel Futures — Technical Design

Status (2026-11-19, branch `phase4/ledger-futures`): **domain logic
implemented and tested** in `src/core/futures.ts` and
`src/director/futures.ts`. No UI and no renderer preview yet (contracts in
[../ledger-futures/UI_RENDERER_HANDOFF.md](../ledger-futures/UI_RENDERER_HANDOFF.md)).
Futures live in memory only (persistence needs WW-016). Requirements still
depend on Master Plan v1.2 (WW-023).

## Model

- A **future** is an isolated alternative continuation of the world. It holds
  a base world, a list of steps and one state per step (for undo). Its state
  is always exactly `applyEvents(base, all step events)`.
- **Fork** (`manager.fork(label)`) starts from the store's current state, after
  verifying that the store log replays from the initial world to exactly that
  state. Verification is cached per seq.
- **Fork from a snapshot** (`forkFromSnapshot(ref, label)`) starts from an
  earlier point (`initial` plus a log prefix, restored by verified replay). It
  is for exploration; it must be rebased before it can be committed.
- **Steps** come from `manager.apply(id, events, { label, details })`, or for
  model output from `proposeInFuture()` in `src/director/futures.ts`, which runs
  the standard validator and translator (Morph with the approved WW-031 policy)
  against the future's own state.
- **Commit** applies one future to the store as one batch (one undo step).
- **Rebase** re-applies a stale future's steps onto the current world.
- **Compare**: `compare(id)` (base against future) and `compareAll()` (all open
  futures, plus `contested` entities that different futures change in
  different ways). Comparisons are field-level, with derived consequences
  listed separately.

## Rules (each is tested)

1. Creating, changing, undoing, comparing or discarding a future never changes
   the original world or its log.
2. Every step is checked, in order: structure (`wellformed.ts`), source (one
   source per future, because a commit is one store batch), the reducer
   (all-or-nothing), then the **pinned invariant** against the base: every
   pinned entity keeps its data, world pose and effective visibility. This
   applies to user steps as well as AI steps, consistent with WW-031 policies
   A to C. New children under pinned entities are allowed.
3. A refused step leaves the future exactly as it was.
4. Commit is refused, and the store is unchanged, if the future is:
   - stale (the store's seq or content differs from the base; any edit, undo
     or redo makes a future stale);
   - violating a pin;
   - empty;
   - already committed or discarded;
   - unknown.
5. Before committing, the events are dry-run on the live state. The result must
   equal the previewed future exactly, including seq, so the committed world
   is byte-identical to the preview.
6. Committing one future applies only its own events. All other open futures
   become stale and must be rebased or discarded.
7. A rebase that no longer applies, or that would now change an entity pinned
   since the fork, is refused and leaves the future unchanged.

## Error codes

`UNKNOWN_FUTURE`, `CLOSED`, `LIMIT`, `MALFORMED`, `SOURCE`, `REJECTED`,
`PINNED` (with the violations), `EMPTY`, `STALE`, `UNVERIFIED`, `INVALID`. The
Director adapter adds `INVALID_PROPOSAL`, `NOT_APPLICABLE`, `NO_FUTURE` and
`FUTURE_REFUSED`.

## Bounds

| Limit | Value | Reason |
|---|---|---|
| Open futures | 4 | The comparison view shows at most four alternatives |
| Steps per future | 32 | One state is kept per step for undo |
| Events per future | 1000 | Equal to `MAX_BATCH_EVENTS`, because a commit is one batch |
| Label | 80 characters, no control or bidirectional-override characters | Labels are shown in the UI and stored in the batch label |

States share unchanged entity objects with the base (tested), so memory is
proportional to open futures × steps × changed entities. Commit and discard
release the intermediate states. Measured on 2026-11-19: 4 futures × 32 steps
on a 1000-entity world plus `compareAll()` in 72 ms; a verified fork (replay of
200 entries), 3 steps and commit in 1.6 ms on the Crystal Kingdom.

## Ledger record

A committed future is one store batch with label `Future: <label>` and details
`kind: 'future'`, `futureId`, `baseSeq`, `baseFingerprint`,
`futureFingerprint`, `steps` and, if any step came from the Director,
`proposalKeys`. The Causal Ledger shows it as a `future` cause. A future's
internal steps are not in the store log until the commit.

## Not implemented

Persistence and reload (WW-016), the futures panel UI and the viewport preview
(contracts ready), a BranchManager service that implements the async
`BranchManager` interface in `src/core/extensions.ts`, and merging two
futures (out of scope until the Master Plan is available).

## Tests

`src/core/futures.test.ts` (22), `src/director/futures.test.ts` (6) and
scenarios C, D and E in `src/director/scenarios.test.ts`. A property test runs
80 seeded random sessions and checks: the original is never touched before a
commit, pins hold, the committed world equals the preview, and the other
futures become stale.
