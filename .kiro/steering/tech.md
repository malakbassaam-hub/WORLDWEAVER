---
inclusion: always
---

# WORLDWEAVER — Technical Steering

## Status

No application code has been written yet. All technical decisions below are
constraints and conventions to apply when implementation begins. Nothing here
represents completed work.

Master Plan v1.2 is pending approval. Do not finalise rendering engine,
persistence layer, deployment target, or UI framework before it is approved.

---

## AI Integration

**Model:** `gemini-3.5-flash-lite` (Gemini API via Google Generative Language)

**Structured output:** All world-state responses must use `responseMimeType: application/json`
with the `responseSchema` field set to the WORLDWEAVER world schema. Free-text
generation is not acceptable for world-state mutations — structured output only.

**World schema (canonical, confirmed by preflight):**
```json
{
  "type": "object",
  "properties": {
    "worldName": { "type": "string" },
    "biome":     { "type": "string" },
    "objects": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string" }
        },
        "required": ["name", "type"]
      }
    }
  },
  "required": ["worldName", "biome", "objects"]
}
```

All string fields must be validated as non-empty after receipt. The `objects`
array may be empty (barren worlds), but the field must be present.

**API key:** Always read from the `GEMINI_API_KEY` environment variable at runtime.
Never hardcode, log, print, commit, or embed the key in any file.

**Rate limiting:** Minimum 5 seconds between sequential API calls. No automatic
retries. Handle HTTP 429 explicitly with a clear error message.

**Body encoding:** Encode request bodies as UTF-8 bytes explicitly. This is
required for Arabic, mixed-language, and special-character prompts.

---

## Language and Runtime

> PLANNED — not decided until Master Plan v1.2 is approved.

Candidate stacks under consideration (no decision made):
- Node.js / TypeScript
- Python

The test suite (`tests/preflight/`) is PowerShell 5.1+ using only built-in
cmdlets. No runtime dependency on Node or Python for preflight tests.

---

## Repository Layout Conventions

```
WORLDWEAVER/
├── .gitignore                        # Node.js, Python, secrets, build artifacts
├── .kiro/
│   ├── steering/                     # Always-included Kiro project context
│   │   ├── product.md
│   │   ├── tech.md
│   │   └── status.md
│   └── agents/
│       └── worldweaver-dev.md        # PLANNED - dev agent definition
├── LICENSE                           # MIT 2026 Malak Bassam Abdulghani
├── README.md
└── tests/
    └── preflight/
        └── gemini_structured_output_tests.ps1
```

Source directories (`src/`, `app/`, etc.) do not exist yet and must not be
created until the Master Plan is approved and a scaffold decision is made.

---

## Security Constraints (apply from day one)

- Secrets in environment variables only. No `.env` files committed. `.env.example`
  (with placeholder values, no real keys) is the only exception.
- Parameterise all external queries; no string interpolation of user input into
  API payloads without sanitisation.
- Least-privilege file and network access.
- Safety layer (see `product.md §7`) must be implemented before any user-facing
  world generation is exposed.

---

## Git Conventions

- Branch: `main`
- Commit style: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- Do not force-push `main`.
- Do not commit secrets, build artifacts, or generated world-state data.
- `.kiro/` is tracked and committed (explicitly not ignored).
