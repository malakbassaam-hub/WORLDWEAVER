# World Persistence: studio integration (2026-11-21)

Branch `feature/persistence-studio-1121`, built from `feature/integration-1120`
(`96a1422`) plus `feature/world-persistence-1120` (`5022898`). This replaces
the "not yet mounted" status in `INTEGRATION.md`, which remains the design
rationale. Verification results are at the end of this file.

## What the studio does now

| Control | Behaviour |
|---|---|
| Save | Writes the canonical world to browser `localStorage` (slot `current`), keeps the previous save as `backup`. A full or blocked store reports the error and changes nothing. |
| Restore | Loads `current`, or the backup if `current` is damaged (and says so). Confirms first if there are unsaved changes or undo history. |
| Export | Downloads `worldweaver-<name>-<timestamp>.worldweaver.world` (JSON content, checksummed envelope, format `worldweaver.world`, version 1). |
| Import | Accepts `.worldweaver.world` (also `.json`). Checks size and type before reading, parses and validates the whole file, shows name, entity count, pinned count and save time, and applies nothing until the user confirms. |
| Indicator | "Unsaved changes" or "All changes saved". Compares content fingerprints, so undoing back to the saved state is clean again. |
| Page close | `beforeunload` warning while there are unsaved changes. |

## v1 restore policy, as implemented

- **Canonical world only.** Only `store.getState()` is saved. Pinned flags are part of each entity and are saved and restored.
- **No dispatch into the live store.** Restore and Import hand a validated `World` to `requestReboot` in `src/main.ts`. The studio tears the session down and boots a new one with that world as its genesis.
- **Fresh baseline.** The new `WorldStore` has an empty log and no undo history. The timeline's first row reads "Restored baseline · N entities". A new Causal Ledger recorder and Futures manager start from the restored world.
- **What is discarded:** undo and redo history, the session log, the Causal Ledger, open Futures and any future preview, the selection. The panel shows this permanently ("Saves keep the world only...") and the confirmation text repeats it. After a load, a toast says history, ledger and futures start fresh.
- **Atomic.** A failed check never reaches `requestReboot`. If the new session itself fails to start, `main.ts` boots the previous world again (its content is kept, its undo history is not). This fallback is covered by code review only, not by a test.
- **Futures and previews are never saved.**
- **Startup does not restore silently.** A reload boots the default world and a toast says a local save exists. The user chooses Restore.

## Files

| File | Role |
|---|---|
| `src/persistence/saveFile.ts` | Format, validation, checksum, migrations, limits (2 MB) |
| `src/persistence/localSave.ts` | Two-slot browser storage with backup |
| `src/persistence/controller.ts` | Save, Restore, Export, Import, dirty state, confirmation |
| `src/ui/persistenceModel.ts`, `persistencePanel.ts` | View model and DOM |
| `src/main.ts` | Mounts the panel, owns `requestReboot` and session lifecycle |
| `src/ui/timeline.ts` | `restored` flag for the baseline row |
| `tests/e2e/persistence.spec.ts` | Browser acceptance tests |

## Integration contract for the yellow agent

**Single owner of `src/main.ts` for persistence: Kiro.** Today's yellow work on
`feature/cinematic-webgl-1121` changes `main.ts` in two renderer-only places
(WebGL version in the stats line, and the WebGL-unavailable message). On
2026-11-21 their uncommitted diff was checked with `git apply --check` against
`599b5ff` and applies cleanly (all three renderer files and `main.ts`).

Rules:

1. The yellow agent commits renderer work to its own branch. It does not edit `main.ts` outside the renderer construction block, the `catch` fallback and the stats line. If it needs another `main.ts` change, it writes the change in its handoff note and Kiro applies it.
2. Persistence code touches `main.ts` only in: the imports and `SessionStart` type, the `boot` signature, the persistence mount block after the timeline is created, the teardown functions, and the entry point at the bottom (`requestReboot`, `launch`).
3. Merging happens by reviewed commit with Malak's approval, in this order: this branch first, then the yellow branch merged on top (or the reverse, since the patches are independent). Neither branch is merged into `main` without approval.
4. **Renderer requirements created by Restore and Import** (the yellow agent must keep these true):
   - `SceneRenderer.dispose()` must release everything. A session reboot creates a new `SceneRenderer` on the same host, repeatedly, without leaking WebGL contexts (browsers limit them to about 16).
   - `new SceneRenderer(host, callbacks, seed)` must accept any seed. A restored world's seed comes from the file.
   - `sync(world)` must handle a world whose entity ids differ completely from the previous one.
   - Renderer callbacks must not fire after `dispose()`.
5. High-detail assets must never be written into the world or save file (see `docs/cinematic/CRYSTAL_KINGDOM_HIFI_SPEC.md`).

## Known limitations

- Local saves live in one browser profile. Clearing site data deletes them. Export is the portable copy.
- One local slot plus one backup. No named saves.
- Saves are not encrypted or signed. The checksum detects accidental damage and casual edits, not a deliberate forger who recomputes it.
- Import accepts only format version 1. Newer versions are refused with a clear message.
- A reboot recreates the WebGL context. On a machine at the context limit this could fail. The fallback then keeps the world but not the viewport.
- Persistence does not store Director history, Causal Ledger entries or Futures (planned for a later phase).

## Defects found by the browser tests and fixed (2026-11-21)

1. **Panel unreachable.** The left column (Scene, Director, World file) was taller than its grid row and spilled under the bottom row, which then intercepted clicks on Import, Restore and Cancel. Fix: `.ww-left` scrolls (`src/ui/styles.css`).
2. **Confirmation could not close.** A `display: flex` rule overrode the `hidden` attribute. Fix: the rule is scoped to `:not([hidden])`.
3. **Load notice never visible on slow GPUs.** The toast was shown before renderer start-up, which blocked the main thread for longer than the 3.8 s toast. Fix: notices show after the first frame (`showNotice` in `src/main.ts`).

## Verification (2026-11-21, Windows, installed Chrome, SwiftShader, recorded mode)

| Check | Command | Result |
|---|---|---|
| Typecheck (client, server, tests) | `npm run typecheck` | exit 0 |
| Focused persistence unit tests | `npx vitest run src/persistence src/ui/persistenceModel.test.ts` | 5 files, 52 tests passed |
| Full unit suite | `npx vitest run` | 35 files, 443 passed, 0 failed |
| Persistence browser tests | `npx playwright test tests/e2e/persistence.spec.ts` | 7 passed (10.5 min) |

The browser tests cover: the panel mounting with the history-policy note; the dirty indicator following an edit and an undo; save, reload and Restore (renamed entity back, 27 entities, pinned citadel still pinned with Remove disabled, Undo disabled, "Restored baseline" row, notice toast); Export file name `*.worldweaver.world`, then Import with confirmation listing name, count and the unsaved-changes warning, nothing applied before confirming, round trip identical, no undo history; Cancel keeping the world and history; refusal of garbage, empty, wrong-extension, 3 MB, foreign-format, newer-version, tampered and wrong-field-type files with the world, dirty state and undo history unchanged; and a full localStorage reporting the error, keeping the world, with the previous good save still restorable.

Not covered by a test: the reboot fallback when a new session throws; repeated reboots leaking WebGL contexts (needs a renderer memory probe); real-GPU rendering.
