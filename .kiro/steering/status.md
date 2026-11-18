---
inclusion: always
---

# WORLDWEAVER — Implementation Status

Last updated: 2026-11-18, Phase 2 Director implementation (branch `phase2/director`).

This document is the single source of truth for what has and has not been
completed. Status values:

- **DONE**: implemented and verified as described.
- **PARTIAL**: a foundation exists; the full feature does not.
- **PLANNED**: not implemented.

---

## Master Plan

Master Plan v1.2 is the approved project direction, as confirmed by the user.
The Master Plan v1.2 document is **not available in this repository or
workspace**, so its contents were not consulted during Phase 1. Phase 1 was
implemented from the requirements given directly in the Phase 1 brief. Re-check
Phase 1 against the document when it becomes available.

---

## Repository

| Item | Status | Notes |
|---|---|---|
| Git repository, branch `main`, remote `origin` | DONE | |
| MIT LICENSE (2026) | DONE | Copyright holder: Malak Bassam Abdulghani |
| `.gitignore` | DONE | Excludes node_modules, dist, env files, keys, credentials, logs, temp files. `package-lock.json` is tracked. `.kiro/` is tracked. |
| `.kiro/steering/` + `.kiro/agents/worldweaver-dev.md` | DONE | |
| Gemini preflight test script | DONE | `tests/preflight/gemini_structured_output_tests.ps1` |
| Phase 1 application (Vite + TypeScript + three.js) | DONE | Branch `phase1/engine-foundation`; not merged into `main` |
| Phase 2 AI World Director | DONE except live verification | Branch `phase2/director` (from `3be7356`); not merged |

---

## Phase 2 — AI World Director (2026-11-18)

**Live Gemini compatibility is NOT verified.** No API key was available to the
agent. Everything below was verified in recorded mode and with mocked
upstream responses.

| Area | Status | Location | Evidence |
|---|---|---|---|
| Proposal schema v2, strict validator, deterministic translator | DONE | `src/director/schema.ts`, `validate.ts`, `context.ts`, `translate.ts` | Unit tests; mutation checks caught by tests |
| Atomic proposal application (one undo step, all-or-nothing) | DONE | `WorldStore.dispatchBatch`, `src/director/apply.ts` | `src/core/batch.test.ts`, `src/director/apply.test.ts`; browser "create … one undo step" |
| Log replay, undo/redo semantics (WW-007) | DONE | `replayLog()` in `src/core/replay.ts` | `batch.test.ts` replay tests |
| Reducer and UI no-op rule (WW-027) | DONE | `src/core/reducer.ts`, `src/main.ts` | Unit tests plus browser test |
| Node.js 24 Director proxy, LIVE and RECORDED modes | DONE (live path tested with mocks only) | `server/director/` | 53 proxy tests over real HTTP; 13 recording tests |
| Director UI (prompt, preview, Apply, Discard, cancel, retry, errors, mode badge) | DONE | `src/ui/director.ts`, `src/director/controller.ts`, `client.ts`, `describe.ts` | 23 controller tests; browser suite |
| Browser acceptance suite (WW-010, WW-011) | DONE | `tests/e2e/director.spec.ts` | 3 consecutive 12/12 runs on `f8339e6`; 13/13 on `9c7d406` |
| Live compatibility suite (WW-025) | Written; **BLOCKED** | `tests/live/director.live.test.ts` | Run without a key: BLOCKED, 0 calls |
| Live smoke in the app (P2-08) | **BLOCKED** | — | Needs Malak's key |

Test totals at `9c7d406`: 225 unit tests passed, 0 failed, 0 skipped; 13
browser tests passed; live suite 1 passed (the BLOCKED report) and 9 skipped
(no key). Production build clean; the bundle contains no key values, no auth
header name and no Gemini URL. `npm audit`: 0 vulnerabilities.

---

## Phase 1 — Engine foundation (DONE)

### Architecture

| Area | Location | Notes |
|---|---|---|
| Typed world model | `src/core/types.ts` | World, Entity, components (transform, visual, light), stable `EntityId`, seeds, `WorldEvent` union, `EventSource` (`system` / `user` / `director` reserved) |
| Pure reducer with validation | `src/core/reducer.ts` | Rejects invalid events with a reason and never throws. Unchanged entities keep the same object reference. |
| Store, undo/redo, event log | `src/core/store.ts` | Snapshot history (limit 200), monotonic `seq`, append-only session log including rejected events |
| Deterministic replay | `src/core/replay.ts` | Same initial world + same events produce an identical world (unit tested) |
| Seeded RNG + stable IDs | `src/core/random.ts` | mulberry32, FNV-1a, deterministic ID factory |
| Extension contracts | `src/core/extensions.ts` | **Types only**: WorldPlanner (Gemini), WorldMorph, CharacterMemoryStore, BranchManager, CausalLedger, SimulationSystem |
| Showcase world data | `src/worlds/crystalKingdom.ts` | "Crystal Kingdom at Dusk", 27 entities generated from seed 20261031 through `entity/added` events |
| Renderer (observer of state) | `src/render/` | three.js scene, procedural archetypes, dusk environment, bloom, shadows, picking, selection marker, camera tweens, resize and resource disposal, WebGL failure and context-loss messages |
| Studio UI (framework-free DOM) | `src/ui/` | Luminous Night shell, scene hierarchy, inspector, timeline, AI Director placeholder. Panels act only through `StudioActions`. |

### Implemented, user-visible behaviour

- Interactive 3D Crystal Kingdom: floating islands, crystal citadel focal point,
  halo ring, sentinel spires, satellite isles, light wisps, obelisks, procedural
  sky with stars and moon, sea, mist, drifting motes.
- Orbit, zoom and pan camera; intro camera flight; frame selected entity (F);
  reset view (Home).
- Selection from the viewport (click) or the scene hierarchy; hover labels.
- Inspector edits, each a real event through the reducer: rename, position,
  rotation Y, raise/lower, palette swatches, base and glow colour, glow
  intensity, visibility, pin, remove (blocked for pinned entities or entities
  with children).
- Undo/redo (buttons, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y); timeline shows the real
  session event log, including rejected edits.
- Quality toggle: Cinematic (bloom, shadows, up to 1.5x pixel ratio) or
  Performance (no bloom or shadows, 1x pixel ratio).
- Position fields accept Arabic-Indic and Persian digits.

### Verification evidence

| Check | Result | Evidence |
|---|---|---|
| TypeScript type check (`tsc --noEmit`, TS 7.0.2) | PASS | 0 errors; a deliberate type-error canary was correctly rejected |
| Unit tests (Vitest) | PASS | 21/21: reducer, store, undo/redo, replay determinism, number parsing |
| Production build (`npm run build`) | PASS | JS 664 kB (169 kB gzip), CSS 18 kB |
| Automated browser verification | PASS | Headless Chrome with SwiftShader WebGL 2, driven through the DevTools Protocol with real mouse and keyboard input (see below) |
| Manual camera orbit on the user's machine | PASS | Reported by the user |
| Real hardware GPU performance | NOT TESTED | Automated runs used a software GPU (about 25–50 fps) |

Automated browser checks (all PASS): app starts with no WebGL fallback; scene
renders non-blank and lit; studio shell present; viewport selection and hover
label; hierarchy selection; inspector edit updates state and visibly changes the
render; Ctrl+Z restores state and render; typed rename; typed position edit with
an Arabic-Indic digit; pinned entity cannot be removed; camera orbit, zoom and
pan; drag does not select; quality toggle (394 to 263 draw calls); resize; no
console or shader errors (checked in a full run before the `PCFShadowMap`
change; not re-run since). Visual checks compared each change against an
idle-animation baseline. In the final run, interaction changes were 10–15 times
larger than idle noise.

Defects found and fixed during verification: overexposed dusk lighting
(retuned sky, water, beam, bloom threshold, exposure); number inputs rendering
OS-locale digits (switched to text inputs); removed three.js
`PCFSoftShadowMap` (now `PCFShadowMap`).

### Known limitations

- The verification harness lives outside the repo (`%TEMP%`). There are no
  committed end-to-end browser tests yet.
- Headless Chrome sometimes stops producing frames during long automated runs,
  which hangs screenshot capture. This is a harness limitation, not an app defect.
- `npm audit`: 0 vulnerabilities in production dependencies. One dev-only
  advisory (picomatch ReDoS, GHSA-fc5q-39xc-vjpf) reaches the Vite/Vitest
  toolchain. npm's only remedy downgrades Vitest 5 to 3 (breaking), so it is
  not applied.
- Bundle is a single 664 kB chunk (mostly three.js). No code splitting yet.
- Long entity names are truncated in the hierarchy.
- World state lives in memory only and resets on reload.
- Undo history is per session and limited to 200 steps.

---

## Preflight Tests

### Gemini Structured-Output Test Suite
**File:** `tests/preflight/gemini_structured_output_tests.ps1`
**Model tested:** `gemini-3.5-flash-lite`
**Test cases:** 9

| TC | Name | Real API Result |
|---|---|---|
| TC-1 | Baseline: complex world, 5 named objects | PASS |
| TC-2 | Arabic-language prompt | PASS |
| TC-3 | Mixed Arabic/English prompt | PASS |
| TC-4 | Exact object count: 3 objects | PASS |
| TC-5 | Empty/barren scene: schema valid with 0 objects | PASS |
| TC-6 | Conflicting instructions: schema survives contradiction | PASS |
| TC-7 | Ambiguous request: minimal prompt | PASS |
| TC-8 | Special characters in names | PASS |
| TC-9 | Large object list: exactly 6 objects | PASS |

**Preflight result: 9/9 PASS**

> Preflight confirms that the Gemini API accepts the WORLDWEAVER schema and
> returns parseable structured JSON. The studio application makes **no** Gemini
> or network calls. Gemini application integration has NOT been implemented
> or tested.

---

## Feature Implementation

| Feature | Status | What exists today |
|---|---|---|
| Natural-language world creation (Gemini) | PARTIAL | Fully implemented on `phase2/director` (proxy, validation, review, atomic apply) and verified in RECORDED mode. **Live Gemini output not yet verified** (WW-025, P2-08). |
| Natural-language world editing | PARTIAL | Director Edit mode (rename, recolour, glow, move, show/hide, remove by ref), verified in RECORDED mode; live not verified |
| World Morph | PLANNED | `WorldMorph` interface only |
| Pinned objects | PARTIAL | Pin flag on entities; pinned entities cannot be removed. Morph preservation PLANNED. |
| Living Characters with persistent memory | PLANNED | `CharacterMemoryStore` interface only |
| Parallel Futures / simulation branches | PLANNED | `BranchManager` interface only |
| Causal Ledger | PLANNED | Session event log is a foundation; not tamper-evident, no causal links, not persisted |
| Provenance | PARTIAL | Per-entity created-by / last-modified-by + seq stamps. Full provenance chains and explanations PLANNED. |
| Safety layer | PLANNED | Reducer input validation only; no content policy |
| Deterministic replay | PARTIAL | `replay()` and `replayLog()` (events, Director batches, undo, redo) reproduce live state exactly, with tests; never calls Gemini. No replay UI or persisted logs. |
| Undo / redo | PARTIAL | Session snapshot undo/redo; a Director proposal is one undo step. Ledger-backed and targeted undo PLANNED. |
| World state persistence | PLANNED | |
| Cinematic interactive 3D + studio editing | DONE (Phase 1 scope) | See Phase 1 above |
| Physics / simulation | PLANNED | `SimulationSystem` interface only |

---

## Pending Decisions

- Server-side proxy design for Gemini (the key must never reach the client)
- Persistence layer for worlds and the Causal Ledger
- Schema extensions for characters, ledger entries and provenance
- Deployment target
- Committed browser test framework (e.g. Playwright)

## Recommended Phase 2

Gemini World Director through a server-side proxy, with review-before-apply of
proposed events (`source: 'director'`); then World Morph using pins; committed
end-to-end browser tests.
