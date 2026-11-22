# WorldGen API (Phase 1: planning and validation foundation)

Branch: `feature/worldgen-engine-1122`. Code: `src/worldgen/`. Import only from
`src/worldgen/index.ts`.

WorldGen turns a natural-language description (English, Arabic or mixed) into
validated, scored `WorldBlueprint` candidates. This phase is the generation
foundation only. **It does not render anything, and no claim is made about how
a blueprint will look on screen.** The Studio UI and renderer are not changed.

## Honesty about "AI"

- Without a provider, prompts are interpreted by a **deterministic bilingual
  keyword lexicon**. Every blueprint then says so:
  `identity.generator = { mode: 'deterministic-fallback', aiInference: false, note: '... This is not AI inference.' }`.
- Layout planning is **always deterministic**, whichever provider interprets
  the prompt.
- `aiInference: true` is set only when an `InterpretationProvider` with
  `kind: 'ai-model'` returned output that passed validation.
- No module in `src/worldgen/` makes network calls, reads environment
  variables or handles credentials (checked by `provider.test.ts`).

## Quick start

```ts
import { generateWorldDeterministic, preferredCandidate, blueprintToEvents } from './worldgen';

const result = generateWorldDeterministic({
  prompt: 'منارة على جرف بجانب البحر مع قرية صغيرة وشلال وجسر',
  seed: 42, // optional; defaults to a hash of the normalised prompt
});
if (!result.ok) {
  showError(result.code, result.message); // INVALID_PROMPT | INVALID_SEED | INVALID_STRATEGY | ALL_CANDIDATES_FAILED | ABORTED
} else {
  const best = preferredCandidate(result);
  showReasons(result.comparison.reasons); // plain-English explanation
  store.dispatchBatch(blueprintToEvents(best.blueprint, { idPrefix: 'gen1/', source: 'user' }), {
    label: 'WorldGen blueprint',
    source: 'user',
  }); // one undo step, all or nothing
}
```

Async, with an optional provider:

```ts
const result = await generateWorld({ prompt, provider, signal, providerTimeoutMs: 30_000 });
```

## Entry points

| Function | Purpose |
|---|---|
| `generateWorldDeterministic(req)` | Sync. Keyword interpretation, both strategies, validation, scoring, comparison. |
| `generateWorld(req)` | Async. Same, but asks `req.provider` to interpret first, with explicit fallback. |
| `planCandidate(prompt, interpretation, strategy, seed)` | One strategy, no validation. For tooling and tests. |
| `validateBlueprint(bp)` | Deterministic diagnostics, requirement coverage, composition metrics. |
| `scoreBlueprint(bp, report)` / `compareCandidates(list)` | Explainable scores and ranking. |
| `candidateDiversity(a, b)` | How different two candidates are (0..1) and why. |
| `serializeBlueprint(bp)` / `parseBlueprint(text)` | Canonical JSON; strict parsing of untrusted input. |
| `blueprintToEvents(bp, opts)` / `blueprintToWorld(bp, opts)` | Adapter to the existing core `WorldEvent` / `World` model. |
| `sampleHeightfield(bp, resolution)` | Regular height grid for a terrain mesh. |
| `heightAt(terrain, x, z)` | Analytic ground height at any point. |

Request rules (`GenerateRequest`): `prompt` is untrusted text of 1 to 2000
characters with no control characters; `seed` is an integer from 0 to
4294967295; `strategies` is a non-empty list of distinct `StrategyId`s
(default: both). Invalid input returns `{ ok: false, code, message }` and never
throws. A planner exception is caught and reported as a `CandidateFailure`
rather than crashing generation.

## WorldBlueprint (version 1)

`schema: 'worldweaver.blueprint'`, `version: 1`. All coordinates are world
units, `+y` up, ground plane `x/z`, world spans `[-space.extent, space.extent]`
(default extent 120). Reuses core `Vec3`, `ColorHex` and `Transform`.

| Section | Contents |
|---|---|
| `identity` | id, title, description (prompt language), prompt, language, seed, strategy, `generator` |
| `theme` | theme, biome, palette |
| `atmosphere` | timeOfDay, weather, lighting (sun, ambient, fog, accent lights), ambience |
| `motion` | descriptors for water, vegetation, clouds, particles |
| `terrain` | sea level, base height, island radius, tilt, analytic `regions` (mountain, hill, valley, cliff, ridge, basin, pedestal, undulation) |
| `water` | `rivers` (points source to mouth, water-surface y, mouth: sea, lake or edge), `waterfalls` (river + segment + drop), `lakes` |
| `structures`, `settlements` | buildings with footprint, height, landmark flag, settlement membership, material |
| `vegetation` | species clusters with ecosystem, centre, radius, count |
| `paths`, `bridges` | ground routes between places; bridges belong to a path and span a river |
| `characters`, `interactables` | roles, homes, neutral greeting text (not generated dialogue), entrances |
| `composition` | focal points (hero, secondary, accent), camera paths, sightlines, `basis` |
| `relations` | semantic links: flows-into, spans, connects, part-of, inhabits, falls-from |
| `requirements` | what the prompt asked for (or excluded), with the matched words |
| `planning` | ordered planner stages and constraints, including anything unsatisfied |

Every element has a stable id (`wg:<slug>-<n>`), a bilingual `labels`
object, a `transform`, `tags`, scalar `properties` and `provenance`:
strategy, planner stage, satisfied requirement ids, a plain-English rationale
and the seed. Same prompt + seed + strategy gives byte-identical output.

## The two strategies

Both read the same expanded requirements (`expandRequirements`) and use the
same element constructors. They differ in the order of decisions, which
changes what each can and cannot do well.

**constraint-first** (`src/worldgen/planners/constraintFirst.ts`)
1. extract constraints, including implications (a waterfall needs a river and
   a drop; a lighthouse needs open water; a bridge needs something to cross)
2. landforms the constraints call for
3. reserve landmarks at the best-scoring of 600 sampled sites for their siting
   rule (coast, high ground, flat ground)
4. rivers **walk downhill** from the highest free ground; a basin becomes a
   contained lake
5. settlements on flat ground near the water that now exists
6. **minimum spanning tree** of roads, with designed far-bank crossings when a
   bridge is required but no road needs one
7. moisture-driven ecology, characters
8. camera **derived last** from the finished layout

**composition-first** (`src/worldgen/planners/compositionFirst.ts`)
1. choose a side-lit camera vantage from the sun direction and **design** the
   hero's position on a rule-of-thirds line
2. **sculpt terrain for the shot**: hero plateau, backdrop ridge or
   mountains, framing hills at the frame edges, ground falling toward the camera
3. solve each landmark to the feasible site nearest its designed spot
4. rivers **designed as leading lines** from the backdrop toward the viewer,
   then solved against the terrain (surface profile, footprint clearance, outlet)
5. settlements outside the camera-to-hero corridor
6. a **processional spine** from a foreground waystone to the hero; other
   places branch off it (spine and branch, not a spanning tree)
7. vegetation framing the shot, tall plants kept out of the sightline corridor
8. re-aim the designed shot at the solved hero; raise the camera if blocked

Observable differences (asserted in `generate.test.ts`): different stage
lists, `composition.basis` (`derived-after-layout` vs `designed-first`), a
hero pedestal and arrival waystone only in composition-first, and candidate
diversity of at least 0.15 on every test prompt.

## Validation and scoring

`validateBlueprint` reports `Diagnostic { code, category, severity, message, elementIds }`
in eight categories:

| Category | Examples of codes |
|---|---|
| integrity | ID_DUPLICATE, ID_FORMAT, TRANSFORM_INVALID, OUT_OF_BOUNDS, REF_MISSING |
| terrain | STRUCTURE_UNDERWATER, STRUCTURE_SLOPE, STRUCTURE_FLOATING, UNPLANNED_WATER |
| water | RIVER_UPHILL, RIVER_GAP, RIVER_ABOVE_GROUND, RIVER_MOUTH, RIVER_THROUGH_STRUCTURE, RIVER_SHORT, WATERFALL_SEGMENT, WATERFALL_NO_DROP, LAKE_DRY, LAKE_SPILL |
| placement | COLLISION, COLLISION_LAKE, LANDMARK_SITE, LANDMARK_LOW, SETTLEMENT_MEMBERSHIP |
| connectivity | PATH_ENDPOINT, PATH_IN_WATER, PATH_RIVER_UNBRIDGED, PATH_STEEP, UNREACHABLE, BRIDGE_OFF_PATH, BRIDGE_NOT_OVER_WATER |
| consistency | SPECIES_BIOME, WEATHER_BIOME, MATERIAL_BIOME, PALETTE, LIGHTING |
| requirements | REQUIREMENT_MISSING, REQUIREMENT_PARTIAL, REQUIREMENT_FORBIDDEN |
| composition | NO_HERO, NO_CAMERA, CAMERA_INVALID, HERO_OUT_OF_FRAME, SIGHTLINE_BLOCKED |

A candidate is `valid` when it has no errors. Each category scores 0 to 100
(35 points per error, 8 per warning; requirements score the satisfied
fraction; composition scores hero in frame, thirds placement, depth layers and
sightline). The total is a fixed weighted sum (`CATEGORY_WEIGHTS`).
`compareCandidates` ranks valid before invalid, then by total, then by
strategy order, and returns plain-English `reasons` naming the categories that
differ and the diversity between the top two.

The composition metrics are geometry (projection of the hero into the opening
camera frame, line-of-sight sampling). They are **not** a measure of rendered
visual quality.

## Providers (future AI integration)

```ts
interface InterpretationProvider {
  readonly id: string;                       // recorded in provenance
  readonly kind: 'ai-model' | 'rule-based';  // only 'ai-model' sets aiInference
  readonly model?: string;
  interpret(request: InterpretationRequest, signal: AbortSignal): Promise<unknown>;
}
```

- The request carries only the prompt, its detected language and the closed
  vocabularies (`buildInterpretationRequest`). `INTERPRETATION_RESPONSE_SCHEMA`
  is the matching structured-output schema.
- Output is untrusted and must pass `parseInterpretation` (closed enums,
  bounded counts, no unknown fields).
- If the provider throws, times out (default 30 s) or returns invalid output,
  generation uses the keyword interpreter. The reason is recorded in
  `generator.note` and in `warnings`, and `aiInference` stays false. This
  fallback is never silent.
- If the caller's `AbortSignal` fires, the result is `ABORTED`, with no fallback.
- A Gemini provider should call the existing server-side Director proxy
  (`/api/director`) so the key stays on the server. It is not implemented in
  this phase.

## Renderer and Studio integration

- `blueprintToEvents` emits `entity/added` events for structures, bridges,
  vegetation clusters and characters. They pass the core reducer,
  `checkEventShape`, `replay()` and `WorldStore.dispatchBatch` (tested), so
  undo, the log, persistence and the ledger work unchanged.
- **Archetypes:** in `legacy-proxy` mode (default) elements map onto archetypes
  the current renderer already draws (a lighthouse becomes `crystalSpire`).
  These are placeholders. `semantic` mode emits `wg.<kind>`; the current
  renderer draws its generic fallback body for those until matching recipes
  exist.
- Terrain, water and paths have no core entity type, so they are not emitted
  as entities. A renderer reads them directly from the blueprint:
  `sampleHeightfield` for the ground, `water.rivers[].points` (surface y
  included), `water.lakes[]` discs, `paths[].points`, `bridges[]` deck
  height and orientation, and `composition.cameraPaths` for camera moves.

## Known limitations

- Keyword interpretation misses phrasing outside the lexicon. Spatial phrases
  such as "north of" or "behind" are not interpreted.
- Roads are straight segments with detours; steep grades are reported
  (PATH_STEEP) but not solved with switchbacks.
- Composition metrics model a 45 degree, 16:9 pinhole camera. They do not see
  vegetation height or terrain texture.
- Not integrated into the Studio UI or renderer in this phase.
