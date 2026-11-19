# Causal Ledger — Technical Design

Status: **design plus a reference projection** (`src/core/ledger.ts`, tested).
The production ledger (persistence, hash chain, UI) is not implemented.
Requirements depend on Master Plan v1.2 (WW-023); this design is provisional.

## Purpose

An inspectable, replayable history of every validated world-changing action,
which can say *what changed, what caused it and when*, without making causal
claims the data does not support.

## Source of truth

The `WorldStore` log already records every event, batch, undo and redo,
including rejected ones, and `replayLog()` reproduces the session exactly. The
ledger is a **projection of that log**, not a second source of truth.

## Entry model (implemented in `src/core/ledger.ts`)

| Field | Meaning |
|---|---|
| `index` | Index of the log entry |
| `accepted` | Whether the change was applied |
| `seqBefore`, `seqAfter` | World sequence numbers around the entry |
| `cause` | `event` (source), `proposal` (key, kind, mode, request or recording id), `undo` (which entry it reverses) or `redo` (which entry it reapplies) |
| `effects` | Entity ids added, removed and changed, computed exactly by comparing worlds; empty for rejected entries |

## What the ledger may claim

| May claim (recorded) | Must not claim (inferred) |
|---|---|
| Entry 7 was a Director morph from proposal `k`, recorded mode | "The user wanted a darker world" |
| Entry 7 changed entities A and B and added C | "B changed because A changed" |
| Entry 9 undid entry 7 | Anything about model reasoning |

Model output is never stored as an explanation. Prompt text is never stored,
only a hash if one is needed later.

## Production design (not implemented)

1. **Append-only store:** one ledger record per accepted or rejected log
   entry, written when the store emits. Needs the persistence decision (WW-016).
2. **Tamper evidence:** `hash_n = SHA-256(hash_{n-1} || canonicalJSON(record_n))`
   via WebCrypto. `verify()` recomputes the chain; any change breaks it.
3. **Explain:** `explainEntity(id)` (implemented in the reference) lists the
   accepted entries whose effects touched the entity. The inspector shows them
   as a timeline. World Morph batches appear as one entry with
   `kind: 'morph'` and the pinned-set hash.
4. **Replay:** from any entry index, using `restoreSnapshot()`
   (`src/core/futures.ts`).

## Tests

- **Done:** `ledger.test.ts` covers causes, exact effects, undo and redo
  targets, history limit, rejected entries and explain.
- **To add with production:** hash-chain verify passes on a clean ledger and
  fails after any byte changes; persisted ledger reloads identically.
