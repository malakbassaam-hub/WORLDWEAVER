---
inclusion: always
---

# WORLDWEAVER — Technical Steering

## Status

Phase 1 established the client application: Vite + TypeScript + three.js (see
`status.md`). Master Plan v1.2 is the approved direction; the document is not
available in the repository. Persistence layer, deployment target and the
Gemini proxy design are still undecided.

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

- Client: TypeScript (strict), Vite, three.js, Vitest. No UI framework; UI is
  plain DOM modules under `src/ui/`.
- Commands: `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`.
- Layering: `src/core/` never imports three.js or the DOM; `src/render/` and
  `src/ui/` observe World snapshots and change state only by dispatching
  `WorldEvent`s through the reducer.
- No secrets or `import.meta.env` values in client code. Gemini calls (PLANNED)
  must go through a server-side proxy.

The preflight suite (`tests/preflight/`) is PowerShell 5.1+ using only built-in
cmdlets and does not depend on Node.

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
│       └── worldweaver-dev.md        # Dev agent definition
├── LICENSE                           # MIT 2026 Malak Bassam Abdulghani
├── README.md
├── index.html, package.json, package-lock.json, tsconfig.json, vite.config.ts
├── src/
│   ├── core/                         # World model, reducer, store, replay (no three.js/DOM)
│   ├── render/                       # three.js renderer and procedural archetypes
│   ├── ui/                           # Studio shell and panels
│   ├── worlds/                       # Deterministic world builders
│   └── main.ts                       # Composition root
└── tests/
    └── preflight/
        └── gemini_structured_output_tests.ps1
```

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

- Branches: `main` (stable); phase work on feature branches such as
  `phase1/engine-foundation`, merged only with explicit approval
- Commit style: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- Do not force-push `main`.
- Do not commit secrets, build artifacts, or generated world-state data.
- `.kiro/` is tracked and committed (explicitly not ignored).
