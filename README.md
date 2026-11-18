# WORLDWEAVER

> **Kiroween 2026** — AI-assisted cinematic 3D world studio (in development)

WORLDWEAVER is being developed as an entry for **Kiroween 2026**.

## Current status: Phase 1 — engine foundation

Phase 1 provides an interactive 3D world studio running in the browser:

- The "Crystal Kingdom at Dusk" world, generated deterministically from a seed
- Orbit, zoom and pan camera controls
- Entity selection from the viewport or the scene hierarchy
- An inspector whose edits (name, position, colour, glow, visibility, pin) update the world and the scene
- Undo/redo and a session event timeline

AI features are **not implemented yet**. Gemini world generation, World Morph,
Living Characters, Parallel Futures and the Causal Ledger are planned. The
studio makes no AI or network calls. See
[`.kiro/steering/status.md`](.kiro/steering/status.md) for the detailed status.

## Run locally

Requires Node.js 22.12 or newer (tested with Node 24).

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm test           # unit tests
npm run typecheck
npm run build
```

## Repository

- **Remote:** https://github.com/malakbassaam-hub/WORLDWEAVER.git
- **License:** MIT
