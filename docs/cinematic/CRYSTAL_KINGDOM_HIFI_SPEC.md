# High-fidelity Crystal Kingdom: technical specification

Status: PROPOSAL (Kiro, 2026-11-21). Nothing here is implemented. Renderer work
belongs to the yellow agent (`src/render/**`); this document fixes the contracts
so the upgrade cannot break editing, Morph, Futures or persistence.

The deliverable is a **functional interactive 3D world**. A pre-rendered or
AI-generated still image is not an acceptable substitute, and may be used only
as concept reference in a separate, labelled document.

## 1. Principle: state stays canonical, assets are presentation

The world model (`World`, `Entity`, `VisualComponent`) does not change. An
entity names *what it is* (`kind`, `visual.archetype`, colours, glow, pin); the
renderer decides *how it looks*. High-detail assets are a second implementation
of an archetype, never new world state.

Consequences, all of which keep current tests valid:

- Save files, the Causal Ledger, Futures and Morph keep working unchanged.
- No GLB path, URL or mesh data is stored in the world or the save file.
- A world looks acceptable on any machine, because every archetype keeps its
  procedural implementation as the fallback.

## 2. Loading high-detail assets

1. **Registry, not entities.** `ARCHETYPES` (`src/render/archetypes.ts`) maps an
   archetype name to a factory returning an `ArchetypeInstance` (`body`,
   `applyVisual`, optional `tick`). Add an *asset-backed* factory per hero
   archetype (citadel, crystal cluster, spire, island rock).
2. **Synchronous placeholder, asynchronous upgrade.** The factory returns the
   existing procedural mesh immediately. In the background it loads a glTF 2.0
   binary (`.glb`) and swaps the geometry into the same `body` when ready.
   `sync()` therefore never blocks and never waits on the network.
3. **Format and compression.** glTF 2.0 `.glb`, meshes Draco or Meshopt
   compressed, textures KTX2 (Basis) with a JPEG/PNG fallback. Loaders come from
   the existing `three` package (`three/examples/jsm/loaders`); no new
   dependency is expected. Any new package needs approval.
4. **Packaging.** Assets live under `public/assets/crystal-kingdom/`, served
   same-origin, one manifest `manifest.json` listing file, byte size, SHA-256,
   triangle count, licence and source (section 8). Loaded lazily after first
   paint; the studio is interactive before any asset arrives.
5. **Safety.** Assets are first-party files shipped with the build, not user
   uploads. If user-supplied models are ever allowed, they need a separate
   review (size limits, no external texture URLs, no scripts).
6. **Failure.** A failed or hash-mismatched asset keeps the procedural mesh and
   raises one non-blocking notice. It never throws into `sync()`.
7. **Memory.** One shared `BufferGeometry` and material set per asset, reused
   by instances. `dispose()` releases GPU resources on session teardown. This
   matters because Restore and Import reboot the whole session
   (see `docs/persistence/STUDIO_INTEGRATION.md`).

## 3. Selectable and editable objects

The current renderer picks with a `Raycaster` over meshes and skips objects
flagged `userData.noPick` (`SceneRenderer.ts`, around line 423). The asset path
must preserve that behaviour:

- Every pickable mesh of an asset resolves to its owning `EntityId`. Set the
  entity id on the asset root; pick walks up to it.
- Decorative sub-meshes (glow shells, particles, sprites) set `noPick`.
- For dense meshes, picking uses a **simplified proxy** (box or low-poly hull)
  that is invisible, instead of raycasting the full triangle set.
- `applyVisual(visual)` must still honour `base`, `emissive` and
  `emissiveIntensity`. Asset materials expose these as uniforms or material
  colour/emissive on tagged materials, so the Inspector, palette swatches and
  Director recolour operations keep working with no new event types.
- Transform edits keep going through the reducer (`entity/transformed`).
  The renderer reads transforms from the world; it never owns them.

Acceptance: with assets loaded, every current Inspector edit changes the
render, hover labels and click selection work, and `tests/e2e` selection tests
pass unchanged.

## 4. World Morph keeps important structures

Morph decisions come from world state (`pinClosure`, Morph policies A to C,
WW-031), not from the renderer. The renderer rule is therefore narrow:

- A pinned entity (and its pin closure) renders identically before, during and
  after a morph. Asset swaps and transitions never animate pinned entities
  (already required by `buildMorphTransition`).
- A morph may recolour or move unpinned assets. It cannot request a different
  asset file, because it can only emit existing `WorldEvent`s.
- The hero structure (Aurelion Citadel) stays pinned by default
  (`crystalKingdom.ts`), so its high-detail asset is protected by the same
  mechanism that protects it today.

## 5. Parallel Futures can preview alternative appearances

`FuturePreview` (`src/render/future-preview.ts`) already carries a complete
alternative `World`. The renderer syncs it and animates changed, non-pinned
entities. High-fidelity needs nothing new, with two rules:

- A preview may only reuse assets that are already loaded or already in the
  manifest. It must not trigger a download that would delay `cancelFuture()`.
- Preview material changes use cloned materials or uniforms, and `cancelFuture`
  restores the baseline in one `sync()`. No GPU resources outlive the preview.

An "alternative appearance" is expressed as a different `VisualComponent` or
`archetype` in the future world, for example the same isle in an `ember`
palette. It is not a separate asset pipeline.

## 6. Performance budgets and graceful degradation

Budgets are for the Cinematic setting on a mid-range discrete GPU or recent
integrated GPU at 1920x1080. They are **targets to measure on real hardware**.
No real-GPU measurement exists yet (docs/REAL_GPU_VERIFICATION.md); SwiftShader
numbers must not be used to claim compliance.

| Budget | Cinematic | Performance |
|---|---|---|
| Frame time | 16.7 ms (60 fps) target, 33 ms floor | 16.7 ms |
| Draw calls | at most 600 | at most 300 |
| Triangles on screen | at most 1.5 M | at most 400 k |
| Texture memory | at most 256 MB | at most 96 MB |
| Download for first interactive view | none (procedural) | none |
| Total optional assets | at most 40 MB compressed | at most 12 MB |
| Per hero asset | at most 150 k triangles, 2048 px textures | LOD1 at most 30 k, 1024 px |

Degradation order, applied automatically and reported in the stats line:

1. Distance LODs (`THREE.LOD`) for every asset, with a procedural impostor as
   the last level.
2. Drop shadows, then bloom (already the Performance mode behaviour).
3. Lower pixel ratio (currently 1.5 maximum in Cinematic).
4. Swap to Performance asset set (LOD1 only, 1024 px textures).
5. Fall back to the procedural archetypes entirely.
6. No WebGL: the existing fallback message; panels, saves and editing still
   work (verified in the persistence tests).

Rules: sustained frame time above 33 ms for 3 seconds steps one level down;
`prefers-reduced-motion` disables ambient camera and particle motion; WebGL
context loss must restore assets from the already loaded cache without refetch.

## 7. Verification plan

- Unit: manifest schema and hash checks; asset registry fallbacks.
- Browser (SwiftShader, correctness only): selection, Inspector edit, Morph
  with the pinned citadel, Futures preview and cancel, context loss and
  restore, session reboot after Restore with no leaked GPU objects
  (`renderer.info.memory` returns to baseline).
- Real GPU (BLOCKED today): frame time, draw calls, triangles, texture memory
  against section 6, recorded with GPU model and driver. Until this runs, the
  budgets are unverified targets.

## 8. Asset licensing and provenance

Every asset needs a manifest record before it is committed. A file without a
complete record is rejected in review.

| Field | Requirement |
|---|---|
| `id`, `file`, `sha256`, `bytes`, `triangles` | Required, checked at load |
| `licence` | SPDX id or "original work". Allowed: CC0, CC-BY 4.0 (with attribution text), MIT, or original work by the project |
| `source` | URL of the original or "created in-house" with the tool and version |
| `author` and `attribution` | Required for CC-BY; shown in an About or credits view |
| `aiGenerated` | `true` or `false`. If true: the tool, the terms of service version, and confirmation that output may be used commercially and redistributed |
| `modifications` | What was changed from the source |
| `approvedBy`, `approvedOn` | Malak approves each external or AI-generated asset |

Not allowed: assets with NonCommercial or NoDerivatives terms, ripped game or
film assets, assets of unknown origin, and models whose licence cannot be
shown. The project is MIT licensed, so redistributed assets must be compatible
with MIT redistribution, or be excluded from the repository and fetched under
their own terms. Kiroween submission rules for third-party content must be
checked against the official rules before submission.

## 9. Suggested order

1. Manifest, loader with procedural fallback, and the budget readout in the
   stats line (no art yet). Gate: all existing tests unchanged.
2. One hero asset (Aurelion Citadel) end to end, including LOD, picking proxy,
   `applyVisual` and licence record.
3. Remaining hero archetypes, then ambient detail.
4. Real-GPU measurement pass, then tune section 6.

Out of scope for this document: authoring the art, choosing specific models,
and any change to `World` or the save format.
