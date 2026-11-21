# World Persistence — Architecture and Save Format

Status (2026-11-20, branch `feature/world-persistence-1120`): **implemented
and unit-tested; not mounted in the studio yet** (needs `src/main.ts`, Kilo
Code). This is the provisional, approved approach for WW-016: local browser
storage plus explicit JSON export and import. There is no cloud sync and no
paid service.

## Modules

| File | Role | DOM |
|---|---|---|
| `src/persistence/saveFile.ts` | Save format v1: serialise, parse, validate, migrate | No |
| `src/persistence/localSave.ts` | Browser save slots with verified write and backup (`StorageLike` injected) | Storage only |
| `src/persistence/controller.ts` | Save, Restore, Export, Import, unsaved indicator, restore policy, startup helper | No |
| `src/ui/persistenceModel.ts` | Pure view state for the controls | No |
| `src/ui/persistencePanel.ts` | DOM controls (not browser-tested yet) | Yes |

## Save format, version 1

```json
{"format":"worldweaver.world","version":1,"savedAt":"2026-11-20T10:00:00.000Z","checksum":"<16 hex>","world":{ ...World... }}
```

- `world` is the canonical `World` from `src/core/types.ts`, written as
  canonical JSON (sorted keys).
- `checksum` is the 64-bit fingerprint of that canonical text. It detects
  damage and accidental edits; it is **not** a cryptographic signature.
- `savedAt` is informational and not part of the checksum.
- **Deterministic:** the same world and `savedAt` give byte-identical files;
  parse then serialise is idempotent (tested).

### Data preserved

| Data | Preserved | Notes |
|---|---|---|
| World id, name, biome, seed | Yes | |
| `seq` | Yes | Keeps provenance stamps meaningful |
| Entity IDs | Yes, unchanged | Including Director IDs (`ai-…`) |
| Entity order and hierarchy (`parentId`) | Yes | A parent must precede its children |
| Name, kind, tags | Yes | |
| Pinned state | Yes | Pins protect exactly as before after restore (tested) |
| Transform (position, rotation, scale) | Yes | |
| Visual (archetype, colour, glow colour and intensity, visibility) | Yes | |
| Light | Yes | |
| Provenance (created/modified by and seq) | Yes | |

### Data excluded (not claimed)

Undo/redo history, the session log, the Causal Ledger, Parallel Futures and
their previews, Director state and pending proposals, selection, camera,
quality mode and other renderer settings, and any credential or key. Futures
and previews are never read by the persistence code: only
`store.getState()` is saved (tested with an open future that has steps).

## Validation of imported or loaded files

All checks happen before anything is applied. Any failure returns an error
and no world (atomic).

1. **Size:** at most 2 MB (UTF-8 bytes), checked before parsing. The UI
   checks `File.size` before reading.
2. **Parsing:** `JSON.parse` only; nothing is evaluated.
3. **Unsafe content:** `__proto__`, `constructor` and `prototype` keys,
   nesting deeper than 32, and text that looks like a Google API key are
   refused.
4. **Envelope:** format name, integer version, version not newer than
   supported, valid checksum shape.
5. **World, field by field:** unknown fields are rejected.
   - Every ID appears once in `order` and in `entities`, with the key equal to
     the ID, and an ID character set of letters, digits, `: . _ -`.
   - Parents exist, are not the entity itself, and come first in `order`, so
     there are no cycles.
   - Names are trimmed, 1 to 80 characters, with no control or bidi-override
     characters.
   - Vectors are finite, and scale is positive.
   - Colours are `#rrggbb`; glow is 0 to 20; the archetype is one of the 7
     known ones.
   - Provenance sources are valid and their seqs do not exceed the world's seq.
   - At most 1000 entities.
6. **Reducer rebuild:** the world is rebuilt from an empty world with one
   `entity/added` per entity through the real reducer, so a loaded world
   obeys the same rules as live edits. Saved provenance and seq are then
   restored. Only fresh objects are returned.
7. **Checksum** of the rebuilt world must match the file.

## Version compatibility and migration policy

- A reader accepts versions `1..SAVE_VERSION`. Newer files are refused with
  "saved by a newer WORLDWEAVER (format version N)".
- Any format change bumps `SAVE_VERSION` and adds `MIGRATIONS[n]`
  (n → n+1), applied in sequence, then fully validated. Migrations never run
  on unvalidated data paths that skip the checks above.
- `World.schemaVersion` (currently 1) is checked independently. A change to
  the world model requires a save-format version bump.

## Local storage, backup and recovery

The keys are `worldweaver.save.v1.current`, `.backup` and `.pending`. The
values are save-file text only.

**Save:**
1. Write `pending`, then read it back and fully validate it.
2. Copy the old valid `current` to `backup`.
3. Write `current` and read it back.
4. Remove `pending`.

A quota or write error at any step leaves the previous `current` intact; the
user is told to Export instead.

**Restore:** a valid `current` is used; otherwise a valid `backup`, with a
warning. Damaged slots are never deleted automatically; `rawText()` lets
them be exported for inspection.

## Restore policy (undo/redo, ledger, futures, selection)

- Restore and Import never mutate the running store. The controller calls
  `replaceWorld(world)`, and the studio **rebuilds its session** with that
  world as the starting world: a new `WorldStore`, ledger recorder and
  futures manager, renderer sync, and an empty selection.
- Undo/redo history, the ledger and open futures of the old session are
  therefore discarded. Restore and Import require confirmation when the
  session has unsaved changes or undo history.
- This avoids stale references: no old entity ID, selection or future can
  point into the new world.
- The unsaved indicator compares content fingerprints (seq ignored). An edit
  that is undone back to the saved content counts as saved.
- Startup default: boot the built-in world and **offer** the local save
  (`startupWorld(..., autoRestore = false)`). Auto-restore is supported but
  off by default, so the recorded demo stays deterministic.

## Security notes

- No credentials are stored. Save files hold world data only, and API-key-like
  text is refused on both save and load.
- Imported files cannot execute code: no evaluation, no HTML injection (all
  text is rendered with `textContent`), and no network access (enforced by
  `src/persistence/safety.test.ts`).
- The checksum is not tamper-proof against a deliberate editor. A
  hand-crafted file still has to pass every validation rule above, so it can
  only describe a world that live edits could also produce.

## Tests

| File | Tests |
|---|---|
| `src/persistence/saveFile.test.ts` | 18 |
| `src/persistence/localSave.test.ts` | 9 |
| `src/persistence/controller.test.ts` | 12 |
| `src/persistence/safety.test.ts` | 9 |
| `src/ui/persistenceModel.test.ts` | 4 |

Mutation checks: 11 of 11 deliberate breakages caught (checksum, duplicate
IDs, prototype keys, parent order, unknown fields, newer versions, write
verification, backup fallback, backup rotation, unsaved indicator, invalid
import).

## Limitations

- Not browser-tested: localStorage behaviour, the file picker, the download
  and real reload were simulated with an in-memory storage in unit tests.
  Browser tests were not run because Kilo Code was running browser suites.
- One local slot plus one backup; no multiple named saves.
- localStorage is typically about 5 MB per origin, shared with anything else
  on the origin; the 27-entity Crystal Kingdom saves to 14,553 bytes
  (measured).
- Ledger, futures and camera are not persisted (see "Data excluded").
- The checksum is non-cryptographic.
