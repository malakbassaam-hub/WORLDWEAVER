---
inclusion: always
---

# WORLDWEAVER — Product Steering

## Project Identity

**WORLDWEAVER** is a Kiroween 2026 entry.

It is an AI-powered world-creation and world-editing tool driven entirely by natural language.
A user describes, refines, or transforms a world in plain text (or Arabic, or any language);
the system interprets that description and maintains a structured, queryable world state.

**Repository:** https://github.com/malakbassaam-hub/WORLDWEAVER.git
**License:** MIT — Copyright (c) 2026 Malak Bassam Abdulghani
**Branch:** `main`

---

## Approved Concept

The following features are approved in concept. None has been implemented yet.
Every item is marked PLANNED until a commit explicitly lands it.

### 1. Natural-Language World Creation and Editing — PLANNED

The primary interface is a text prompt. The user types a description such as
"A desert island with a ruined lighthouse and a lagoon of black water" and receives
a structured world back. Subsequent prompts mutate the world incrementally:
"Remove the lagoon. Add a sandstorm." Each mutation is applied as a delta,
not a full regeneration.

Schema (confirmed working via Gemini structured-output preflight):
- `worldName` : string
- `biome`     : string
- `objects`   : array of `{ name: string, type: string }`

### 2. World Morph with Pinned Objects — PLANNED

The user may **pin** individual objects in the world to protect them from mutation.
When a Morph command is issued ("make it darker and more apocalyptic"), pinned
objects are excluded from the transformation and carried forward unchanged.
Unpinned objects may be rewritten, removed, or augmented.

### 3. Living Characters with Memory — PLANNED

Characters in the world have persistent memory across sessions. A character
remembers conversations, relationships, and events. This memory is stored in
the world state alongside physical objects and is included in future prompt
context. Characters are first-class objects in the schema (type = "character").

### 4. Parallel Futures — PLANNED

From any saved world state the user can branch into multiple "futures" — diverging
continuations of the same world under different assumptions or choices. Futures
are independent states that share a common ancestor in the history tree.
They can be compared, merged, or discarded.

### 5. Causal Ledger — PLANNED

Every change to the world is recorded in a Causal Ledger: a tamper-evident,
append-only log that stores the prompt that caused the change, the diff of the
world state before and after, the timestamp, and an optional author note.
The Causal Ledger is the authoritative source of provenance (see §6).

### 6. Provenance — PLANNED

Every object and every attribute in the world state carries provenance metadata:
which prompt created it, which Causal Ledger entry last modified it, and the
chain of ancestor entries back to genesis. Provenance is queryable ("who added
the lighthouse, and when?").

### 7. Safety Layer — PLANNED

Before any mutation is applied to the world state, a safety pass evaluates the
incoming content against a configurable policy. The safety layer may reject,
redact, or flag content. It operates on the structured output, not the raw prompt,
so the policy is deterministic given the same input.

### 8. Undo — PLANNED

Undo is a first-class operation backed by the Causal Ledger. Any entry in the
ledger can be targeted for reversal. Single-step undo (last action) and
targeted undo (by ledger entry ID) are both PLANNED. Undo itself is recorded
as a ledger entry so the full history remains intact.

---

## Master Plan

Master Plan v1.2 is **pending approval**. No architectural decisions have been finalised.
Do not make irreversible decisions about rendering engine, data persistence layer,
deployment target, or UI framework until the Master Plan is approved and committed.

---

## Out of Scope (for Kiroween 2026 entry)

- 3D engine or real-time rendering
- Multiplayer or networked world state
- Paid cloud services or external data stores beyond the Gemini API
