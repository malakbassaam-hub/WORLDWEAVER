# Parallel Futures — Technical Design

Status: **contract plus reference helpers** (`src/core/futures.ts`, tested).
The BranchManager service, persistence, timeline UI and viewport comparison are
not implemented. Requirements depend on Master Plan v1.2 (WW-023).

## Model

- A **snapshot** is `initial world + the first n log entries`
  (`WorldSnapshotRef`). It is restored by deterministic replay
  (`restoreSnapshot`), never by calling Gemini.
- A **future** (`FutureBranch`) is an independent `WorldStore` started from a
  snapshot. Its undo history starts empty. Nothing it does touches the
  original store.
- **Compare:** `compareWorlds(a, b)` lists added, removed and changed entity
  ids (the same diff as the ledger).

## Rules

1. The original world is never modified by a branch (tested).
2. Restoring the same snapshot twice gives identical worlds (tested).
3. A log that no longer replays identically cannot be used as a snapshot
   (tested: `restoreSnapshot` throws).
4. Pinned entities stay protected in every branch: World Morph rules apply
   per branch (tested with two morphed futures).
5. Branch metadata (id, label, parent snapshot) is recorded in the Causal
   Ledger when branching is implemented.

## Production design (not implemented)

- `BranchManager.fork(fromLogIndex, label)`, `switch(id)`, `discard(id)` and
  `list()`, implementing `BranchManager` in `src/core/extensions.ts`.
- One active store at a time in the studio; others kept as snapshot refs plus
  their own logs, which keeps memory low.
- Timeline shows branches; the viewport comparison (ghosted or side-by-side)
  is Kilo Code's renderer work.
- Persistence needs WW-016.

## Tests

- **Done:** `futures.test.ts` covers an independent fork, deterministic
  restore, invalid snapshot points and a tampered log.
- **To add:** switching branches restores each exactly; discard frees memory;
  ledger records fork and switch.
