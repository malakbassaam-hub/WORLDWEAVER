# Causal Ledger — Technical Design

Status (2026-11-19, branch `phase4/ledger-futures`): **domain logic
implemented and tested** in `src/core/ledger.ts`. Not persisted (needs
WW-016), no UI yet (contract in
[../ledger-futures/UI_RENDERER_HANDOFF.md](../ledger-futures/UI_RENDERER_HANDOFF.md)).
Requirements still depend on Master Plan v1.2 (WW-023).

## Purpose

An inspectable, replayable history of every world-changing action that says
what happened, what changed and what the log records as the cause, without
making causal claims the data does not support.

## Source of truth

The `WorldStore` log records every event, batch, undo and redo, including
rejected ones, and `replayLog()` reproduces a session exactly. The ledger is a
**projection of that log**. It adds identity, integrity and exact effects; it
never becomes a second source of truth.

## Three kinds of statement

| Kind | Fields | Where it comes from |
|---|---|---|
| **Recorded** | `cause`, `actions` | The log: event source, batch details (proposal key, kind, mode, request or recording id, pinned hash, policy), future ID and base seq, undo/redo target |
| **Observed** | `changes`, `effects`, `before`, `after` | Exact comparison of the world before and after the entry, field by field |
| **Derived** | `consequences` | Fixed engine rules only: a child's world pose and effective visibility follow its ancestors (`pose.ts`). Each item has `basis: 'derived'`, a `rule` and the changed ancestor `via` |

The ledger never states that one entry caused another, never stores model
reasoning and never stores prompt text. A Director or Morph batch label
contains model text, so its entry has `summaryOrigin: 'model'`; the UI must
present it as model text, not as a fact.

## Entry model

| Field | Meaning |
|---|---|
| `id` | `le-<index base 36>-<8 hex of hash>`; the same log always gives the same IDs |
| `index` | Position in the log (deterministic order) |
| `kind`, `status` | `event`, `batch`, `undo`, `redo` or `malformed`; `applied`, `rejected` or `malformed` |
| `seqBefore`, `seqAfter`, `before`, `after` | Seq and content fingerprint of the states around the entry. `after` of one entry equals `before` of the next; an undo's `after.fingerprint` equals the fingerprint of the state it returns to |
| `cause` | `event`, `proposal`, `future`, `batch`, `undo` (`reverses`, `reversesId`), `redo` (`reapplies`, `reappliesId`) or `unknown` |
| `actions` | One per event: `id` (`<index>/<n>`), type, target, source, the seq it produced, and a fingerprint of the payload. The payload itself stays in the store log |
| `changes` | Per entity: `added`, `removed` or `changed`, the changed field names (`name`, `transform.position`, `visual.color`, `provenance`, …) and `recordedBy`, the action IDs that targeted it |
| `consequences` | Derived pose and visibility changes of descendants |
| `issues` | Malformed input, replay mismatches, or an observed change with no recorded action |
| `prevHash`, `hash` | Hash chain |

`CausalLedgerView` adds `genesis` (bound to the initial world's fingerprint),
`head`, `initial`, `final`, `inEffect` (applied change entries that are not
currently undone, history limit respected) and `consistent`.

## API

| Function | Purpose |
|---|---|
| `buildLedger(initial, log)` | Replays the log in a fresh store and builds the ledger. Never throws: malformed entries are recorded as `malformed`, change nothing and set `consistent: false` |
| `createLedgerRecorder(initial, store)` | Live, incremental recording as the store emits, without replay. Ingests an existing log first. Produces exactly the same view as `buildLedger` (property-tested over 40 random sessions) |
| `verifyLedgerChain(view)` | Recomputes every hash and ID; detects any edit, reordering, forged hash or wrong head |
| `verifyLedgerAgainstLog(initial, log, stored)` | Rebuilds from the log and compares entry by entry |
| `traceEntity(view, id)` | Everything the ledger can state about one entity: direct changes and derived consequences, each with `inEffect` |
| `explainEntity(entries, id)` | Accepted entries that directly changed the entity (Phase 3 API, kept) |
| `diffWorlds`, `entityChanges`, `changedFields`, `derivedConsequences` | Exact comparison helpers, shared with Parallel Futures |

Supporting modules: `src/core/fingerprint.ts` (canonical JSON, 64-bit
fingerprint, per-entity cache), `src/core/wellformed.ts` (structural checks for
events and log entries from outside the session).

## Integrity: what the hash chain does and does not give

The chain uses a 64-bit non-cryptographic hash. It detects accidental
corruption, naive edits, reordering and truncation. It does **not** resist a
deliberate forger who recomputes the whole chain. The production upgrade is a
SHA-256 chain via WebCrypto (asynchronous), together with persistence.

## Memory and performance

Entries hold IDs, field names and fingerprints, never World objects. A state
is materialised on demand by replay (`inspectEntry` in `historyView.ts`,
`restoreSnapshot` in `futures.ts`). Measured on 2026-11-19 with
`npx vitest run --config vitest.measure.config.ts`:

| Measurement | Result |
|---|---|
| `buildLedger`, Crystal Kingdom (27 entities), 200 entries | 10.9 ms |
| `buildLedger`, 1000 entities, 100 entries | 60 ms |
| Live recorder, 1000 entities, 100 edits | 61 ms total (about 0.6 ms per edit) |
| World fingerprint, 1000 entities, cold / with entity cache | 8.8 ms / 0.18 ms (50x) |
| Average entry size, 1000-entity world | 695 bytes (the world is 411 KB as JSON) |

The ledger grows linearly with the store log, which is itself unbounded per
session. Bounding both is a persistence decision (WW-016).

## Compatibility

- **AI Director:** batches with `proposalKey` become `proposal` causes with
  kind, mode and request or recording id.
- **World Morph:** the same, with `kind: 'morph'`, `pinnedHash`, `policy` and
  `policyApproved` in `details`.
- **Parallel Futures:** a committed future is one batch with
  `kind: 'future'`, giving a `future` cause with `futureId`, `baseSeq`, `steps`
  and the step proposal keys.
- **Living Characters:** memories are grounded in ledger entries
  (`groundMemories`).

## Tests

`src/core/ledger.test.ts` (25), `src/core/fingerprint.test.ts` (6) and
`src/director/scenarios.test.ts` scenario E. They cover causes and exact
effects, batch grouping, state links, model-text labelling, undo/redo targets
and the history limit, in-effect tracking, derived consequences (including
scale, which is not inherited), determinism, ID stability as the log grows,
chain tampering, verification against the log, an empty log, malformed and
inconsistent logs, the live recorder and memory bounds.
