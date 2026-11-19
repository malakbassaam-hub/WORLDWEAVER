# Living Characters — Technical Design

Status: **contract plus safety boundary** (`src/director/characters.ts`,
tested). No character archetype, talk UI, proxy task, memory persistence or
model calls exist. Requirements depend on Master Plan v1.2 (WW-023).

## Safety boundary (implemented)

A character turn from the model is **untrusted data** with two parts:

| Part | Handling |
|---|---|
| `reply` (text) | Validated: string, 1–600 characters, no control or bidi-override characters, NFC-normalised. Displayed with `textContent` only. |
| `proposal` (optional) | Validated by the standard `validateProposal` and translated by `translateProposal`, with all Phase 2 and pin rules. Returned for **user review**. Never applied by the character module. |

A character can never write to the store, bypass the Director's
review-and-apply flow, or change pinned entities.

## Memory (implemented contract)

- `CharacterMemory = { id, characterId, text, causedBySeq }`. `memoryId()`
  derives a stable ID from the character, the seq and the normalised text.
- A memory is admissible only if `causedBySeq` refers to an **accepted** change
  in the session log (`validateMemory`). Characters cannot invent events.
- **Causal Ledger grounding (2026-11-19):** `groundMemories(state, ledger)`
  classifies each memory as `grounded` (its change is in effect), `undone`
  (the change was undone, or its redo was discarded) or `unknown`. With a
  ledger, `memoriesForContext` uses grounded memories only, so a character
  never treats an undone change as current fact. A redo makes the memory
  grounded again.
- **Parallel Futures:** `memoriesForFuture(state, ledger, baseSeq)` keeps only
  grounded memories of changes made before the fork.
- **World Morph:** characters are ordinary entities of kind `character`.
  `charactersExposedToMorph(world)` lists unpinned characters so the UI can warn
  before a morph. Pinning a character protects it under WW-031.
- `memoriesForContext` keeps the 12 most recent memories for the prompt, in a
  deterministic order.

## Production design (not implemented)

1. **Character entities:** kind `character` plus a character archetype (Kilo
   Code, `src/render/**`).
2. **Proxy task `character`:** a separate task with its own response schema
   (`reply` plus an optional World Proposal), gated like Morph, with a live
   compatibility case.
3. **Talk flow:** user message plus recent memories go to the proxy, the turn
   is admitted, the reply is shown, and an optional proposal is reviewed and
   applied as one batch with `kind: 'character'` in its details.
4. **Memory writes:** after an accepted batch or user edit, a memory is
   proposed and validated; it is stored with the persistence layer (WW-016).
5. **Ledger:** character batches are ordinary proposal entries whose cause
   names the character id.

## Tests

- **Done:** `characters.test.ts` (8) covers a valid turn, pinned protection,
  hostile and malformed turns, log-grounded memories, ledger grounding through
  undo and redo, memories inside a future, characters exposed to a morph, and
  the context limit.

## Open design questions (need the Master Plan, WW-023)

- May a character propose changes to itself (rename, move, remove)?
- Do memories belong to the world (and so branch with a future) or to the
  session?
- Retention: how many memories per character, and what happens to `undone`
  memories after the redo history is discarded?
- **To add:** proxy task schema tests, recorded character turns, browser talk
  flow, and memory persistence across reload.
