# WORLDWEAVER Phase 2 Plan — Gemini World Director

Status: **IMPLEMENTED on branch `phase2/director`, except live Gemini
verification.** Approved by Malak on 2026-11-18 (WW-021). Steps P2-00 to
P2-07 and P2-09 are done; P2-08 (live smoke) and the live run of P2-02 are
BLOCKED until they are run with Malak's key. See the step table in section 12
and "As built" in section 13. Every date is a target. Progress is recorded in
[ISSUE_REGISTER.md](ISSUE_REGISTER.md) and
[DEVELOPMENT_SCHEDULE.md](DEVELOPMENT_SCHEDULE.md).

Approved architecture: Node.js 24 local proxy, no paid services; Gemini API
key server-side only; recorded responses for deterministic tests; real
Gemini integration remains mandatory; no flagship feature is removed.

- **Baseline:** commit `23e676e` on `phase1/engine-foundation`
- **Master Plan v1.2:** not available (WW-017). This plan is derived from
  `.kiro/steering/product.md`, `tech.md` and `status.md`. Requirements that
  depend on the Master Plan are marked **BLOCKED (WW-023)**. They are not
  assumed.

## 1. Goal

A user types a natural-language request, in English, Arabic or both, into the
AI World Director. Gemini returns a structured proposal. The studio validates
it, shows a review, and on approval applies it to the world as one undoable step
that renders immediately and replays deterministically.

Two modes share one pipeline:

- **Create**: build a new world, or add to the current one, from a description.
- **Edit**: change the current world ("make the citadel violet, add three wisps").

## 2. Constraints carried over from steering (non-negotiable)

1. The Gemini API key never reaches the browser. It is read from
   `GEMINI_API_KEY` by a server-side proxy only, sent upstream in the
   `x-goog-api-key` header (never the URL), and never logged, printed,
   returned or committed.
2. All world changes go through `WorldEvent`s and the reducer, with
   `source: 'director'`. The renderer and UI stay pure observers.
3. Structured output only: `responseMimeType: application/json` with a
   `responseSchema`. Free-text world-state generation is not accepted.
4. At least 5 seconds between upstream calls and **no automatic retries**
   (`tech.md`). Retrying is always an explicit user action.
5. Request bodies are UTF-8. Arabic and mixed-language prompts must work.
6. No paid services are enabled. The plan must work within the Gemini quota the
   user already has (WW-026).

## 3. Architecture

```
Browser (Vite app)                            Local server (Node 24)            Google
┌───────────────────────────────┐   POST     ┌────────────────────────┐  HTTPS ┌──────────┐
│ Director panel (src/ui)       │──/api/────▶│ Director proxy         │──────▶│ Gemini   │
│  prompt, review, apply        │  director  │  input limits, origin  │ key in │ generate │
│                               │◀───────────│  check, rate limit,    │ header │ Content  │
│ src/director/                 │  raw JSON  │  30 s timeout, error   │◀──────│          │
│  client → validate → translate│  + meta    │  mapping, no key leak  │        └──────────┘
│  → dry-run → proposal         │            └────────────────────────┘
│                               │            GEMINI_API_KEY lives only here
│ WorldStore.dispatchBatch()    │
│  one atomic step, one undo,   │
│  one log entry with metadata  │
│ SceneRenderer.sync() (as now) │
└───────────────────────────────┘
```

| Layer | Location (planned) | Responsibility |
|---|---|---|
| Proxy | `server/director.ts` (+ Vite dev middleware; runtime per WW-021) | Holds the key; validates input; calls Gemini; maps errors |
| Client | `src/director/client.ts` | `fetch('/api/director')` with `AbortController`; typed results |
| Schema + validator | `src/director/schema.ts`, `src/director/validate.ts` (implemented) | `responseSchema` v2 plus a hand-written validator (no new dependency) |
| World context | `src/director/context.ts` (implemented) | Ref summary (`e1…eN`) for the model; ref → `EntityId` map for the translator |
| Translator | `src/director/translate.ts` (implemented) | Proposal → `WorldEvent[]`; deterministic IDs and layout; per-operation dry-run |
| Planner | `src/director/planner.ts` | Implements the existing `WorldPlanner` contract; dry-run through the reducer |
| Store | `src/core/store.ts` | New `dispatchBatch()`: all-or-nothing, single undo snapshot, single log entry |
| UI | `src/ui/director.ts` | Enable the panel: prompt, status, review list, Apply, Discard, Retry |

Kilo Code owns any change under `src/render/**` (for example new archetypes or
transition effects). Kiro owns everything else listed here.

## 4. Data contract

### 4.1 Gemini output schema v2 (provisional)

The preflight-verified v1 schema (`worldName`, `biome`, `objects[{name,type}]`)
cannot express edits, placement or colour. v2 is **provisional**. It must pass a
new live preflight (WW-025), and its final shape needs Master Plan
confirmation (WW-023).

```json
{
  "type": "object",
  "required": ["summary", "operations"],
  "properties": {
    "summary":   { "type": "string" },
    "worldName": { "type": "string" },
    "biome":     { "type": "string" },
    "operations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["op"],
        "properties": {
          "op":        { "type": "string", "enum": ["add", "remove", "rename", "recolor", "glow", "move", "show", "hide"] },
          "target":    { "type": "string", "description": "Ref of an existing entity, e.g. e7" },
          "name":      { "type": "string" },
          "archetype": { "type": "string", "enum": ["floatingIsland", "crystalSpire", "crystalCluster", "crystalCitadel", "arcaneRing", "lightOrb", "obelisk"] },
          "count":     { "type": "integer" },
          "placement": { "type": "string", "enum": ["center", "inner-ring", "outer-ring", "sky", "on-target", "near-target"] },
          "palette":   { "type": "string", "enum": ["Aether Cyan", "Night Violet", "Orchid Flare", "Aurora Mint", "Ember Gold", "Moon White"] },
          "glow":      { "type": "number" },
          "direction": { "type": "string", "enum": ["up", "down", "left", "right", "forward", "back"] }
        }
      }
    }
  }
}
```

Design decisions:

- **The model never chooses coordinates or IDs.** It picks a placement intent.
  The client layout uses a seeded RNG (`world.seed ^ hash(proposalId)`) to
  compute positions, and `createIdFactory('ai:' + proposalId)` to assign IDs.
  The same proposal therefore always produces the same events, and malformed
  coordinates are impossible.
- **Entities are referenced by short refs** (`e1…eN`). The prompt context
  contains a compact world summary using refs (name, kind, archetype, palette,
  pinned). Refs are mapped back to `EntityId`s on the client. An unknown ref
  invalidates that operation only.
- Colours come from the existing Luminous palette, so AI output stays within
  the visual identity and the reducer's colour validation.

### 4.2 Proxy API

`POST /api/director` — JSON request, JSON response, same-origin only.

| Request field | Limit |
|---|---|
| `mode` | `"create"` or `"edit"` |
| `prompt` | 1–2,000 characters after trimming; UTF-8 |
| `world` | Compact ref summary, at most 32 KB, at most 200 entities |

| Response | Shape |
|---|---|
| Success | `{ ok: true, requestId, model, finishReason, text }`, where `text` is the raw model JSON string, validated on the client |
| Failure | `{ ok: false, requestId, code, message, retryAfterSec? }` |

Error codes: `NO_KEY`, `BAD_REQUEST`, `RATE_LIMITED`, `TIMEOUT`, `UPSTREAM`,
`BLOCKED_SAFETY`, `EMPTY`, `FORBIDDEN_ORIGIN`.

## 5. Validation and safe parsing (client, in order)

1. **Transport.** Non-2xx or `ok:false` maps to a typed error (section 8). No retry.
2. **Parse.** `JSON.parse` inside `try`. Failure produces `INVALID_JSON`, and the raw text is never rendered as HTML.
3. **Shape (strict).** Hand-written validator against schema v2: required fields, types and enums. **Unknown properties and unknown operation types are rejected**, as are `__proto__`, `constructor` and `prototype` keys and non-plain objects. Nothing is repaired or clamped.
4. **Limits.** At most 24 operations per proposal and 64 added entities; `count` 1–8 with per-archetype caps (citadel 1, ring 2, island 3, light orb 4); `glow` 0–10; `steps` 1–5; finite numbers only. Text is NFC-normalised and trimmed; empty text, C0/C1 controls, bidi overrides and isolates, line separators, BOM and lone surrogates are rejected; names at most 80 UTF-16 units (`NAME_MAX_LENGTH`). Raw text at most 64 KB, checked before parsing. Up to 50 path-qualified issues are reported.
5. **Semantics.** Refs must exist. Operations that change pinned entities are rejected (adding children to a pinned entity is allowed). The world total may not exceed 200 entities, and Director-added point lights stop at 6 per world. Operations that would change nothing are rejected as "No change.".
6. **Dry-run.** Each operation's events are applied to a preview world with `applyEvent`, and each operation is accepted or rejected as a unit with its reason. The accepted events always replay to exactly the preview.
7. **Review.** The UI lists accepted operations and dropped ones with reasons. Nothing changes until the user clicks **Apply**.

All AI-provided text is treated as data. It is displayed with `textContent`, as
in Phase 1, and is never used in selectors, URLs or HTML.

## 6. Converting output into WorldEvents

| Operation | Events produced |
|---|---|
| `add` | `count` × `entity/added`; IDs `ai:<proposalId>:<slug>-NNN`; transform from placement layout; visual from archetype defaults plus palette and glow |
| `remove` | `entity/removed` |
| `rename` | `entity/renamed` |
| `recolor` | `entity/visualChanged` `{color, emissive}` from palette |
| `glow` | `entity/visualChanged` `{emissiveIntensity}` |
| `move` | `entity/transformed` `{position}`, a fixed step in `direction` |
| `show` / `hide` | `entity/visualChanged` `{visible}` |

Every event carries `source: 'director'` and `note: <proposal summary>`. The
`worldName` and `biome` fields need a new `world/renamed` event, an additive
reducer change with tests. Without it, they are displayed only.

## 7. Store integration, undo/redo and replay

- **`dispatchBatch(events, meta)`** applies a list atomically: all events
  succeed or the world is unchanged. It pushes one undo snapshot and appends
  one log entry of kind `batch`, containing the events plus
  `meta = { proposalId, mode, model, promptSha256, requestId, createdAt }`.
  The prompt text is stored only as a SHA-256 hash, so logs carry no user
  content by default.
- **Undo/redo:** one proposal is one step. This builds on the WW-007 decision,
  which must define how undo is represented before `dispatchBatch` ships.
- **Replay:** the log stores the exact events. Replay never calls Gemini, so
  `replay(initial, flatten(log))` reproduces the live state. Unit tests cover
  director batches mixed with user edits and undo/redo.
- **Provenance:** entities stamped with `createdBy: 'director'`. The inspector
  shows the proposal ID. Full Causal Ledger links come in section 10.4.

## 8. Error handling, timeouts and retries

| Condition | Detected by | User sees | Retry |
|---|---|---|---|
| Key not configured | Proxy `NO_KEY` | "AI Director is not configured on this machine." Panel shows setup instructions. | No |
| Rate limited (HTTP 429) | Proxy `RATE_LIMITED`, `retryAfterSec` | Countdown, then the Retry button becomes enabled | Manual, after the countdown |
| Local rate limit (under 5 s since the last call) | Proxy | "Please wait N s" | Manual |
| Timeout (30 s) | `AbortController` in proxy and client | "Gemini did not answer in time." | Manual |
| Upstream 5xx or network | Proxy `UPSTREAM` | Generic failure message plus requestId | Manual |
| Safety block | `finishReason`/`promptFeedback` | "Request was blocked by safety filters." | Edit the prompt |
| Empty candidate | Proxy `EMPTY` | "No proposal returned." | Manual |
| Invalid JSON or schema | Client validator | "The proposal was malformed." Count of problems shown | Manual |
| All operations dropped | Client semantics or dry-run | Review shows each reason; Apply disabled | Edit the prompt |
| User cancels | `AbortController` | Panel returns to idle | — |

Only one request is in flight at a time. The panel is disabled while waiting,
and a new request cancels the old one.

## 9. Security and API-key protection

| Control | Verification |
|---|---|
| Key read only from `process.env.GEMINI_API_KEY` on the server | Unit test: proxy module is not imported by any `src/` file; the build contains no `process.env` |
| Key sent in the `x-goog-api-key` header, never the URL | Proxy unit test inspects the mocked `fetch` call |
| Key never logged or returned | Test spies on `console.*` and inspects responses for the key value set in the test |
| Bundle contains no key | CI check: grep `dist/` for `AIza` and `x-goog-api-key`; must find none |
| Proxy bound to `127.0.0.1`; same-origin `Origin` check; `Content-Type: application/json` required | Proxy tests for a foreign origin and the wrong content type |
| Body limit 64 KB; prompt and world limits (section 4.2) | Proxy tests |
| Server log records only requestId, status, latency and sizes; no prompt text | Test |
| `.env` stays ignored; only `.env.example` with a placeholder is committed | `git check-ignore` check (already passing) |
| AI text rendered with `textContent` only | Existing `h()` helper; review in code inspection |
| Preflight script's URL-query key (WW-024) not copied into Phase 2 | Code review |

## 10. Flagship features after Phase 2 (provisional)

Each feature builds on the Phase 2 pipeline. Scope below is derived from
`product.md`. Detailed requirements and conformance are **BLOCKED (WW-023)**
until Master Plan v1.2 is supplied. None of these features is dropped or
replaced.

### 10.1 World Morph with pinned-object preservation
- A Morph prompt in the Director runs in a `morph` mode. Context marks pinned refs as immutable.
- Enforcement is on the client, not trusted to the model: any operation targeting a pinned entity, or its pinned ancestors, is dropped with a reason.
- Applied as one batch. Kilo Code may add a transition effect (renderer only).
- Acceptance: after a morph, every pinned entity is byte-identical in world state; the morph undoes in one step; tested with fixtures.

### 10.2 Living Characters with persistent memory
- New `character` kind plus a character archetype (Kilo Code, `src/render`).
- `CharacterMemoryStore` implementation: memories keyed by character, each with `causedBySeq`; persisted through the WW-016 layer.
- Talk flow: user message plus recent memories go to the proxy (a separate `character` mode), and back come a structured reply plus optional `WorldEvent` proposals, reviewed like any other.
- Acceptance: a character recalls a fact from an earlier session after a reload; memory entries link to log seqs; no memory text in console logs.

### 10.3 Parallel Futures and controlled simulation branches
- `BranchManager` implementation: fork at a log position into a named branch that shares the ancestor snapshot; switch, compare (entity diff) and discard.
- Branch state is separate from undo history (per the WW-007 decision).
- The UI timeline shows branches. Optional side-by-side or ghost comparison in the viewport is Kilo Code's work.
- Acceptance: two branches from one ancestor diverge independently; switching restores each exactly; replay of each branch reproduces it.

### 10.4 Causal Ledger, provenance and explainable outcomes
- `CausalLedger` implementation: append-only entries hash-chained with SHA-256 (WebCrypto); each entry records event(s), source, causes (for example proposal → events, user edit → entity) and the metadata from section 7.
- `explain(entityId)` returns the chain of entries that created and modified an entity. The inspector shows it.
- Tamper evidence: changing any stored entry breaks verification.
- Acceptance: verify passes on a clean ledger and fails after any byte changes; `explain` matches the log for a scripted session.

### 10.5 Final integration and testing
- End-to-end scenario covering create → edit → pin → morph → fork → talk to a character → explain → undo/redo → reload, on fixtures and once live.
- Full regression of the issue register items. Real-GPU check (WW-009).
- Master Plan conformance review: **BLOCKED (WW-017, WW-023)**.

## 11. Testing strategy

| Level | What | Network |
|---|---|---|
| Unit (Vitest) | Validator (valid, missing, wrong types, oversized, control characters, unknown enums, injection-style text), translator determinism, layout bounds, ref mapping, pinned enforcement, `dispatchBatch` atomicity, single-step undo, replay with batches, provenance | None |
| Proxy (Vitest, mocked `fetch`) | Success; 429 with retry-after; timeout; 5xx; malformed body; safety block; empty; missing key; foreign origin; oversize body; key only in header; key never in response or logs | None |
| Browser acceptance (WW-010 suite, fixture mode) | Prompt → review → apply → entities in hierarchy and viewport (pixel-diff vs idle baseline, as in Phase 1) → one undo removes all → redo → each error banner via fixtures | None (proxy runs in fixture mode) |
| Live preflight v2 (new script `tests/preflight/gemini_schema_v2_tests.ps1`) | Schema v2 against `gemini-3.5-flash-lite`: create, edit, Arabic, mixed, pinned context, oversized request, adversarial prompt; at most 9 calls, 5 s apart | Live, run by Malak |
| Live smoke (manual) | One create and one edit in the running app with the real key | Live, run by Malak |

**Fixture mode.** The proxy can serve recorded proposals from
`tests/fixtures/director/*.json` when `DIRECTOR_FIXTURES=1`. The panel then
shows a visible "Recorded responses" badge. This makes E2E tests
deterministic and gives a demo fallback if the quota runs out (WW-026). It is
never presented as live AI.

## 12. Exact implementation steps

| Step | Owner | Target | Work | Done when | Status |
|---|---|---|---|---|---|
| P2-00 | Malak | 2026-11-19 | Approve Phase 2 start, the proxy runtime (proposed: Node 24 with Vite dev middleware, no new dependency) and the fixture mode (WW-021) | Decision recorded in `tech.md` | DONE 2026-11-18 |
| P2-01 | Kiro | 2026-11-20 | `src/director/schema.ts` and `validate.ts` with fixtures and unit tests (section 5, steps 2–5) | Tests pass; no new dependencies | DONE 2026-11-18 |
| P2-02 | Kiro, Malak | 2026-11-21 | Live schema v2 compatibility test (header-based key, existing script untouched); Malak runs it (WW-025) | Live results recorded in `status.md` | Written 2026-11-18 as `tests/live/director.live.test.ts` (`npm run test:live`); live run **BLOCKED** (no key available to the agent) |
| P2-03 | Kiro | 2026-11-21 | `src/director/context.ts` and `translate.ts`: refs, deterministic IDs and layout, event mapping (section 6) | Determinism and mapping tests pass | DONE 2026-11-18 |
| P2-04 | Kiro | 2026-11-23 | `dispatchBatch`, `batch` log entries, undo/replay semantics (closes WW-007); reducer no-op rule (WW-027); optional `world/renamed` | Atomicity, undo and replay tests pass | DONE 2026-11-18 (`95c62cf`) |
| P2-05 | Kiro | 2026-11-23 | Director proxy plus Vite dev middleware; fixture mode; all controls in section 9 | Proxy tests pass; `dist/` key grep clean | DONE 2026-11-18 (`170ec32`) |
| P2-06 | Kiro | 2026-11-24 | `src/director/client.ts`, controller (`controller.ts`, in place of `planner.ts`); enable the Director panel with review, Apply, Discard, Retry, cancel and the error states in section 8 | Unit tests pass; manual run in fixture mode | DONE 2026-11-18 (`002879d`) |
| P2-07 | Kiro | 2026-11-25 | Browser acceptance tests in fixture mode (requires WW-010 tooling approval) | Three consecutive passing runs | DONE 2026-11-18: 3 × 12/12 on `f8339e6`, 13/13 on `9c7d406` |
| P2-08 | Malak, Kiro | 2026-11-25 | Live smoke test with the real key; update `status.md` (Phase 2 DONE or PARTIAL with evidence) | Recorded results | **BLOCKED**: needs Malak's key |
| P2-09 | Kiro | 2026-11-25 | Phase 2 checkpoint on `phase2/director`; pull request for review; no merge without approval | Pushed branch and review requested | Branch pushed; pull request not yet opened (needs Malak's go-ahead) |

## 13. As built (2026-11-18)

Differences from the plan above, and what they mean:

| Area | Plan | As built | Why |
|---|---|---|---|
| Proxy location | `server/director.ts` | `server/director/` (config, request validation, prompt, Gemini call, recordings, handler, Vite plugin) | Separation and testability |
| Proxy hosting | Vite dev middleware | `directorPlugin()` in `vite.config.ts` mounts the same Node handler in **both** `npm run dev` and `npm run preview`; `createDirectorServer()` runs it standalone (tests, live suite) | One handler everywhere; the browser only talks to its own origin |
| Fixture mode | `DIRECTOR_FIXTURES=1` | **Recorded mode**: `DIRECTOR_MODE=recorded`, or automatic when `GEMINI_API_KEY` is unset; 8 recordings in `server/director/recordings.ts`; `#error:<CODE>` test hooks (recorded mode only) | Clear naming; the mode is always labelled RECORDED in the UI |
| Concurrency | One request at a time, others refused | A new request **supersedes** the running one (aborts it, replies 409 `SUPERSEDED`); live spacing of at least 5 s still enforced first | The browser test found that cancel-then-retry could hit a stale "busy" state |
| Error codes | Section 4.2 list | Adds `LOCAL_RATE_LIMITED`, `SUPERSEDED`, `INVALID_PROPOSAL` (server-side validation), `TRUNCATED`, `MODEL_NOT_FOUND`, `UPSTREAM_BAD_REQUEST`, `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE`, `TOO_LARGE` | More precise handling |
| Proposal application | Drop invalid operations, apply the rest | **All-or-nothing**: any rejected operation blocks Apply; one proposal = one undo step | Required by the Phase 2 instruction |
| Live test | PowerShell script | TypeScript live suite through the real proxy, validator and translator | Tests the real pipeline, not a copy |
| Planner module | `planner.ts` | `controller.ts` (DOM-free state machine) plus `describe.ts` (review text) | Unit-testable UI logic |

Verification: 225 unit tests (`npm test`); browser suite `npm run test:e2e`
(13 tests, 3 consecutive passing runs); live suite `npm run test:live`
(BLOCKED without a key).

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Phase 2 approval or proxy decision slips (WW-021) | The whole critical path shifts | Decision requested for 2026-11-19; P2-01 and P2-03 need no decision and can start first |
| Schema v2 behaves poorly live (WW-025) | Rework of schema and translator | Live preflight on day 3; keep the translator independent of exact wording |
| Gemini quota or 429s during demo (WW-026) | Demo failure | No automatic retries; clear countdown; labelled fixture fallback |
| Master Plan conflicts with this plan (WW-017, WW-023) | Rework late in the schedule | Request the document by 2026-11-24; gap analysis on 2026-11-27 |
| Deployment format undecided (WW-022) | Key exposure, or a demo that only runs locally | Static hosting cannot hide the key; decide by 2026-11-24 |
| Flagship features compete for Kiro's time | Late features | Kilo Code parallelises rendering work; depth decision point 2026-11-25 (schedule); no feature is removed |
