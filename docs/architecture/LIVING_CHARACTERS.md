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

- `CharacterMemory = { id, characterId, text, causedBySeq }`.
- A memory is admissible only if `causedBySeq` refers to an **accepted** change
  in the session log (`validateMemory`). Characters cannot invent events.
- `memoriesForContext` keeps the 12 most recent memories for the prompt.

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

- **Done:** `characters.test.ts` covers a valid turn, pinned protection,
  hostile and malformed turns, grounded memories and the context limit.
- **To add:** proxy task schema tests, recorded character turns, browser talk
  flow, and memory persistence across reload.
