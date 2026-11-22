/**
 * Strategy A: CONSTRAINT-FIRST.
 *
 * Decision order (each stage may only use what earlier stages produced):
 *   1. extract-constraints  expand the prompt into hard/soft constraints
 *   2. terrain-skeleton     landforms the constraints call for
 *   3. reserve-landmarks    hero, other landmarks and lakes, chosen by scoring
 *                           candidate sites against siting constraints
 *   4. water-flow           rivers WALK DOWNHILL from the highest ground, steering
 *                           around reserved footprints; sinks become lakes
 *   5. settlement-sites     villages sited against the water that now exists
 *   6. connectivity         minimum spanning tree over nodes; bridges where
 *                           paths meet rivers; a far-bank outpost if a bridge is
 *                           required but nothing lies across the river
 *   7. secondary-population houses, ecology (moisture-driven), characters
 *   8. derive-composition   camera vantage and focal points are derived LAST,
 *                           from the finished layout
 *
 * Geography decides the layout; composition is an after-the-fact reading of it.
 */
import { createRng, hashString, type Rng } from '../../core/random';
import { BlueprintBuilder, type BuildContext } from '../builder';
import { LIMITS, STRUCTURE_DEFS, type StructureDef } from '../catalog';
import { dollyPath, orbitPath, sightClear, thirdsLookAt } from '../composition';
import { dist2, distToPolyline, round3 } from '../geometry';
import { Occupancy, siteOk, sitingScore, type World2D } from '../placement';
import { farBankOutpost, placeSettlement, settlementScore, speciesPool, standNear, tryPlant, vegetationBudget } from '../populate';
import { bestRoute, bridgeCrossings, findRiverCrossings, minimumSpanningTree, obstaclesFor, routeOnLand } from '../routing';
import { distanceToWater, heightAt, insideLake, rimHolds, riverXZ, slopeAt } from '../terrain';
import type { Lake, StructureKind, Structure, Vec2, Vec3, WorldBlueprint } from '../types';

const STRATEGY_SALT = hashString('constraint-first');

export function planConstraintFirst(ctx: BuildContext): WorldBlueprint {
  const b = new BlueprintBuilder(ctx);
  const rng = createRng((ctx.seed ^ STRATEGY_SALT) >>> 0);
  const occ = new Occupancy();
  const { spec, extent } = ctx;
  const world = () => ({ terrain: b.terrainView, lakes: b.lakes, rivers: b.rivers, extent });

  // ---- 1. extract-constraints --------------------------------------------
  b.stage(
    'extract-constraints',
    `${spec.constraints.length} constraints from ${ctx.interp.requirements.length} requirements; hero landmark: ${spec.hero}${spec.heroDefaulted ? ' (defaulted)' : ''}.`,
  );
  for (const conflict of spec.conflicts) {
    b.extraConstraints.push({ id: `x${b.extraConstraints.length + 1}`, kind: 'conflict', subject: 'prompt', detail: conflict, implied: false });
  }

  // ---- 2. terrain-skeleton -----------------------------------------------
  b.stage('terrain-skeleton', 'Landforms placed from the terrain requirements; high ground first so water has somewhere to start.');
  if (spec.sea) b.terrain.islandRadius = round3(extent * 0.72);
  const mountains = spec.mountains > 0 ? spec.mountains : ctx.interp.biome === 'alpine' ? 1 : 0;
  const mountainReq = ctx.interp.requirements.find((r) => r.concept === 'mountain' && !r.negated)?.id;
  const mountainCenters: Vec2[] = [];
  const offset = rng.range(0, Math.PI * 2);
  for (let i = 0; i < mountains; i++) {
    const a = offset + (i / Math.max(mountains, 1)) * Math.PI * 2;
    const d = extent * rng.range(0.26, 0.4);
    const center: Vec2 = [round3(Math.cos(a) * d), round3(Math.sin(a) * d)];
    mountainCenters.push(center);
    b.addRegion({
      kind: 'mountain',
      center,
      radius: rng.range(24, 32),
      amplitude: rng.range(30, 40),
      requirementIds: mountainReq && spec.mountains > 0 ? [mountainReq] : [],
      rationale: spec.mountains > 0 ? 'Mountain requested by the prompt.' : 'Alpine biome default: one mountain gives rivers a source.',
    });
  }
  const hillReq = ctx.interp.requirements.find((r) => r.concept === 'hill' && !r.negated)?.id;
  for (let i = 0; i < spec.hills; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = extent * rng.range(0.15, 0.42);
    b.addRegion({
      kind: 'hill',
      center: [round3(Math.cos(a) * d), round3(Math.sin(a) * d)],
      radius: rng.range(15, 22),
      amplitude: rng.range(8, 14),
      requirementIds: hillReq ? [hillReq] : [],
      rationale: 'Hill requested by the prompt.',
    });
  }
  const valleyReq = ctx.interp.requirements.find((r) => r.concept === 'valley' && !r.negated)?.id;
  for (let i = 0; i < spec.valleys; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = extent * rng.range(0.1, 0.3);
    const center: Vec2 = [round3(Math.cos(a) * d), round3(Math.sin(a) * d)];
    // Never dig below sea level: that would create water the prompt did not ask for.
    const room = Math.max(2, Math.min(rng.range(5, 8), b.height(center[0], center[1]) - 2));
    b.addRegion({
      kind: 'valley',
      center,
      radius: 16,
      amplitude: -room,
      aspect: 2.4,
      angle: rng.range(0, Math.PI),
      requirementIds: valleyReq ? [valleyReq] : [],
      rationale: 'Valley requested by the prompt.',
    });
  }
  let cliffTop: Vec2 | null = null;
  if (spec.cliffs > 0) {
    const cliffReq = ctx.interp.requirements.find((r) => (r.concept === 'cliff' || r.concept === 'waterfall') && !r.negated)?.id;
    // The cliff is the river's source, so it goes on a mountain flank or, without
    // a mountain, near the middle of the land: water then has a long way to run.
    const anchor: Vec2 = mountainCenters[0] ?? [0, 0];
    const a = rng.range(0, Math.PI * 2);
    const offset = mountainCenters[0] ? 20 : rng.range(8, 16);
    const center: Vec2 = [round3(anchor[0] + Math.cos(a) * offset), round3(anchor[1] + Math.sin(a) * offset)];
    b.addRegion({
      kind: 'cliff',
      center,
      radius: 13,
      amplitude: 16,
      sharpness: 4,
      requirementIds: cliffReq ? [cliffReq] : [],
      rationale: 'Plateau with a steep edge: gives the river a real drop for a waterfall.',
    });
    cliffTop = center;
  }
  for (let i = 0; i < 2; i++) {
    b.addRegion({
      kind: 'undulation',
      center: [round3(rng.range(-extent * 0.5, extent * 0.5)), round3(rng.range(-extent * 0.5, extent * 0.5))],
      radius: rng.range(22, 30),
      amplitude: rng.range(2.5, 4),
      rationale: 'Low swell so the ground is not a flat plane.',
    });
  }

  // ---- 3. reserve-landmarks ----------------------------------------------
  b.stage('reserve-landmarks', 'Landmarks and lakes are sited by scoring candidate positions against their constraints, then their footprints are reserved.');
  const reserve = (kind: StructureKind, reqIds: readonly string[], isHero: boolean): Structure | null => {
    const def = STRUCTURE_DEFS[kind];
    const site = bestSite(world, rng, occ, def, extent);
    if (!site) {
      b.extraConstraints.push({ id: `x${b.extraConstraints.length + 1}`, kind: 'unsatisfied', subject: kind, detail: `No site satisfied the ${kind} constraints.`, implied: false });
      return null;
    }
    const s = b.addStructure({
      kind,
      at: site,
      yaw: rng.range(0, Math.PI * 2),
      requirementIds: reqIds,
      extraTags: isHero ? ['hero'] : [],
      rationale: isHero
        ? `Hero landmark: best of ${CANDIDATES} candidate sites for "${def.need}" siting${spec.heroDefaulted ? ' (landmark chosen by biome default)' : ''}.`
        : `Landmark reserved at the best-scoring site for "${def.need}" siting.`,
    });
    occ.add({ id: s.id, center: site, radius: def.footprint + 2 });
    return s;
  };

  const hero = reserve(spec.hero, spec.heroRequirementId ? [spec.heroRequirementId] : [], true);
  const landmarks: Structure[] = hero ? [hero] : [];
  for (const order of spec.structures) {
    const already = order.kind === spec.hero ? 1 : 0;
    for (let i = already; i < order.count; i++) {
      if (b.structures.length >= LIMITS.structures) break;
      const s = reserve(order.kind, order.requirementId ? [order.requirementId] : [], false);
      if (s) landmarks.push(s);
    }
  }

  const lakeReq = ctx.interp.requirements.find((r) => r.concept === 'lake' && !r.negated)?.id;
  for (let i = 0; i < spec.lakes; i++) {
    const site = lakeSite(b, rng, occ, extent);
    if (!site) {
      b.extraConstraints.push({ id: `x${b.extraConstraints.length + 1}`, kind: 'unsatisfied', subject: 'lake', detail: 'No flat, dry site was available for a lake.', implied: false });
      continue;
    }
    const lake = b.addLake({ center: site.center, radius: site.radius, requirementIds: lakeReq ? [lakeReq] : [], rationale: 'Lake requested by the prompt, sited on flat low ground.' });
    occ.add({ id: lake.id, center: lake.center, radius: lake.radius + 2 });
  }

  // ---- 4. water-flow ------------------------------------------------------
  b.stage('water-flow', 'Rivers start on the highest free ground and follow the steepest descent, steering around reserved footprints. A river that finds no outlet creates a lake.');
  const riverReq = ctx.interp.requirements.find((r) => r.concept === 'river' && !r.negated)?.id;
  const fallReq = ctx.interp.requirements.find((r) => r.concept === 'waterfall' && !r.negated)?.id;
  const sources: Vec2[] = [];
  for (let i = 0; i < spec.rivers; i++) {
    // A river that reaches its outlet within a few steps is a stub that can carry
    // neither a crossing nor a visible course; try other free high ground first.
    // A walk that ends in a basin needs room for a contained lake there; a walk
    // that reaches its outlet in a few steps is a stub. Either way, try other
    // free high ground (a cliff source is kept unless its outlet is impossible).
    const fixedSource = i === 0 && cliffTop !== null;
    const sinkSite = (w: Walk) => (w.end === 'sink' ? sinkLakeSite(b, occ, w.path[w.path.length - 1] as Vec2) : null);
    const acceptable = (w: Walk) => (w.end !== 'sink' || sinkSite(w) !== null) && (fixedSource || w.path.length >= MIN_RIVER_POINTS);
    let source = fixedSource && cliffTop ? plateauTop(b, cliffTop) : highestFreeGround(b, rng, occ, extent, sources);
    let walked = walkDownhill(b, rng, occ, source, extent);
    // A waterfall needs the river to leave the cliff plateau: try other points on
    // the plateau before giving the cliff up.
    if (fixedSource && cliffTop && !acceptable(walked)) {
      for (let k = 0; k < 8 && !acceptable(walked); k++) {
        const a = (k / 8) * Math.PI * 2;
        source = [round3(cliffTop[0] + Math.cos(a) * 6), round3(cliffTop[1] + Math.sin(a) * 6)];
        walked = walkDownhill(b, rng, occ, source, extent);
      }
    }
    for (let retry = 0; retry < 4 && !acceptable(walked); retry++) {
      sources.push(source);
      source = highestFreeGround(b, rng, occ, extent, sources);
      walked = walkDownhill(b, rng, occ, source, extent);
    }
    sources.push(source);
    let mouth: { type: 'sea' } | { type: 'lake'; lakeId: string } | { type: 'edge' } = { type: 'edge' };
    const path = walked.path;
    if (walked.end === 'sea') mouth = { type: 'sea' };
    else if (walked.end === 'lake' && walked.lake) mouth = { type: 'lake', lakeId: walked.lake.id };
    else if (walked.end === 'sink') {
      const site = sinkSite(walked);
      if (!site) {
        b.extraConstraints.push({ id: `x${b.extraConstraints.length + 1}`, kind: 'unsatisfied', subject: 'river', detail: 'Every river course found ended in a basin with no room for a lake.', implied: false });
        continue;
      }
      const lake = b.addLake({ center: site.center, radius: site.radius, requirementIds: [], rationale: 'The river reached a basin with no outlet, so the water collects in a lake.' });
      occ.add({ id: lake.id, center: lake.center, radius: lake.radius + 2 });
      mouth = { type: 'lake', lakeId: lake.id };
    }
    if (path.length < 3) continue;
    const river = b.addRiver({
      path,
      width: round3(rng.range(2.2, 3.4)),
      mouth,
      requirementIds: riverReq ? [riverReq] : [],
      rationale: spec.rivers > 0 && riverReq ? 'River requested by the prompt; path follows the steepest descent.' : 'River added by default or by implication; path follows the steepest descent.',
    });
    b.markWaterfalls(river, i === 0 ? spec.waterfalls : 0, fallReq ? [fallReq] : []);
  }

  // ---- 5. settlement-sites -----------------------------------------------
  b.stage('settlement-sites', 'Villages are sited on flat dry ground as close to water as possible, now that water exists.');
  const settlementReq = ctx.interp.requirements.find((r) => r.concept === 'village' && !r.negated)?.id ?? ctx.interp.requirements.find((r) => r.concept === 'house' && !r.negated)?.id;
  const settlementIds: { id: string; center: Vec2 }[] = [];
  for (let i = 0; i < spec.settlements; i++) {
    const houses = Math.max(3, Math.min(LIMITS.housesPerSettlement, spec.houses > 0 ? spec.houses : 5));
    const radius = 7 + houses * 1.4;
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (let n = 0; n < 500; n++) {
      const p: Vec2 = [round3(rng.range(-extent * 0.75, extent * 0.75)), round3(rng.range(-extent * 0.75, extent * 0.75))];
      if (occ.collides(p, radius, 2)) continue;
      const score = settlementScore(b, p);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const s =
      best && bestScore >= 0
        ? placeSettlement(b, rng, occ, best, houses, settlementReq ? [settlementReq] : [], 'Settlement on the best-scoring flat ground near water.')
        : null;
    if (s) settlementIds.push({ id: s.id, center: s.center });
    else {
      b.extraConstraints.push({ id: `x${b.extraConstraints.length + 1}`, kind: 'unsatisfied', subject: `settlement-${i + 1}`, detail: 'No flat dry site with room for houses was available.', implied: false });
    }
  }

  // ---- 6. connectivity ----------------------------------------------------
  b.stage('connectivity', 'A minimum spanning tree joins landmarks and settlements; bridges are placed where a path meets a river.');
  const bridgeReq = ctx.interp.requirements.find((r) => r.concept === 'bridge' && !r.negated)?.id;
  const roadReq = ctx.interp.requirements.find((r) => r.concept === 'road' && !r.negated)?.id;
  interface Node {
    id: string;
    at: Vec2;
  }
  const nodes: Node[] = [
    ...landmarks.map((s) => ({ id: s.id, at: [s.transform.position[0], s.transform.position[2]] as Vec2 })),
    ...settlementIds.map((s) => ({ id: s.id, at: s.center })),
  ];
  const connectTree = (list: readonly Node[]) => {
    const edges = minimumSpanningTree(list.length, (i, j) => {
      const a = (list[i] as Node).at;
      const c = (list[j] as Node).at;
      return dist2(a, c) * (1 + 2 * averageSlope(b, a, c));
    });
    for (const [i, j] of edges) joinNodes(list[i] as Node, list[j] as Node);
  };
  const joinNodes = (from: Node, to: Node, requireCrossing = false, designed?: Vec2[]) => {
    const line = designed ?? bestRoute(b, from.at, to.at, obstaclesFor(b, [from.id, to.id]), { requireCrossing });
    const path = b.addPath({
      kind: 'road',
      line,
      fromId: from.id,
      toId: to.id,
      requirementIds: roadReq ? [roadReq] : [],
      rationale: 'Edge of the minimum spanning tree over landmarks and settlements.',
    });
    bridgeCrossings(b, path, bridgeReq ? [bridgeReq] : [], 'The path crosses a river; a bridge spans it.');
  };
  if (nodes.length >= 2) connectTree(nodes);

  if (spec.bridges > b.bridges.length && b.rivers.length > 0 && nodes.length >= 1) {
    // Try existing node pairs that straddle a river before inventing a destination.
    outer: for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (b.bridges.length >= spec.bridges) break outer;
        const a = nodes[i] as Node;
        const c = nodes[j] as Node;
        if (b.paths.some((p) => (p.fromId === a.id && p.toId === c.id) || (p.fromId === c.id && p.toId === a.id))) continue;
        if (findRiverCrossings(routeOnLand(b, a.at, c.at, obstaclesFor(b, [a.id, c.id])), b.rivers).length > 0) joinNodes(a, c, true);
      }
    }
    // Still short: add a far-bank outpost. Any existing place may be the origin;
    // the first one from which a real crossing route exists is used.
    let guard = 0;
    while (b.bridges.length < spec.bridges && guard++ < spec.bridges + 2 && nodes.length > 0) {
      let joined = false;
      for (const origin of [...nodes]) {
        const crossing = farBankOutpost(b, occ, origin, world);
        if (!crossing) continue;
        const node = { id: crossing.outpost.id, at: [crossing.outpost.transform.position[0], crossing.outpost.transform.position[2]] as Vec2 };
        nodes.push(node);
        joinNodes(origin, node, true, crossing.line);
        joined = true;
        break;
      }
      if (!joined) break;
    }
    if (b.bridges.length < spec.bridges) {
      b.extraConstraints.push({ id: `x${b.extraConstraints.length + 1}`, kind: 'unsatisfied', subject: 'bridge', detail: `Requested ${spec.bridges} bridge(s); only ${b.bridges.length} river crossing(s) could be routed.`, implied: false });
    }
  }

  // ---- 7. secondary-population -------------------------------------------
  b.stage('secondary-population', 'Ecology follows moisture (near water vs dry ground); characters are attached to the places that exist.');
  const forestReq = ctx.interp.requirements.find((r) => r.concept === 'forest' && !r.negated)?.id;
  const treeReq = ctx.interp.requirements.find((r) => r.concept === 'tree' && !r.negated)?.id;
  const flowerReq = ctx.interp.requirements.find((r) => r.concept === 'flowers' && !r.negated)?.id;
  const planted = (kinds: readonly ('tree' | 'shrub' | 'flower' | 'cactus' | 'grass')[], reqIds: readonly string[], target: number, why: string) => {
    const pool = speciesPool(b, kinds);
    if (pool.length === 0) return;
    let made = 0;
    for (let attempt = 0; attempt < target * 30 && made < target; attempt++) {
      const sp = pool[(made + attempt) % pool.length] as (typeof pool)[number];
      const center = moistureSample(b, rng, extent, sp.waterWithin !== null || sp.kind === 'flower');
      if (tryPlant(b, occ, sp, center, round3(rng.range(4, 8)), reqIds, why)) made++;
    }
  };
  const budget = vegetationBudget(b);
  if (spec.forest) planted(['tree'], forestReq ? [forestReq] : [], Math.min(8, budget), 'Forest requested by the prompt: tree clusters on well-watered ground.');
  if (spec.trees) planted(['tree'], treeReq ? [treeReq] : [], 3, 'Trees requested by the prompt.');
  if (spec.flowers) planted(['flower'], flowerReq ? [flowerReq] : [], 3, 'Flowers requested by the prompt.');
  planted(['tree', 'shrub', 'cactus', 'grass', 'flower'], [], Math.max(0, budget - b.vegetation.length), 'Ambient ecology for the biome, placed by moisture.');
  // Reed beds on river banks.
  const reed = speciesPool(b).find((s) => s.id === 'reed-bed');
  if (reed) {
    for (const river of b.rivers.slice(0, 2)) {
      const mid = river.points[Math.floor(river.points.length / 2)] as Vec3;
      const center: Vec2 = [round3(mid[0] + river.width + 3), round3(mid[2])];
      tryPlant(b, occ, reed, center, 3.5, [], 'Reeds grow along the river bank.');
    }
  }

  const charReq = ctx.interp.requirements.find((r) => r.concept === 'character' && !r.negated)?.id;
  const wantedChars = spec.characters > 0 ? spec.characters : hero ? 1 : 0;
  for (let i = 0; i < wantedChars; i++) {
    const settlement = b.settlements[i % Math.max(b.settlements.length, 1)];
    const useSettlement = settlement !== undefined && (i > 0 || !hero);
    const anchor: Vec2 = useSettlement ? settlement.center : hero ? [hero.transform.position[0], hero.transform.position[2]] : [0, 0];
    const role = useSettlement ? 'villager' : hero && (hero.structureKind === 'lighthouse' || hero.structureKind === 'tower') ? 'keeper' : 'guardian';
    const at = standNear(b, rng, anchor, useSettlement ? settlement.radius * 0.5 : (hero?.footprintRadius ?? 3) + 1);
    if (!at) continue;
    b.addCharacter({
      role,
      at,
      homeId: useSettlement ? settlement.id : (hero?.id ?? null),
      requirementIds: spec.characters > 0 && charReq ? [charReq] : [],
      rationale: spec.characters > 0 ? 'Character requested by the prompt, placed where they live or work.' : 'Ambient keeper for the hero landmark; the prompt did not ask for characters.',
    });
  }
  if (hero) {
    b.addInteractable({ targetId: hero.id, at: standNear(b, rng, [hero.transform.position[0], hero.transform.position[2]], hero.footprintRadius) ?? [hero.transform.position[0] + hero.footprintRadius + 2, hero.transform.position[2]], interaction: 'enter', rationale: 'Entrance to the hero landmark.' });
  }

  // ---- 8. derive-composition ---------------------------------------------
  b.stage('derive-composition', 'Camera vantage, focal points and sightline are derived from the finished layout.');
  if (hero) deriveComposition(b, rng, hero, landmarks);

  return b.finish();
}

// ---------------------------------------------------------------------------

const CANDIDATES = 600;
/** Walked rivers shorter than this are re-sourced (6-unit steps, so about 40 units). */
const MIN_RIVER_POINTS = 8;

function bestSite(w: () => World2D, rng: Rng, occ: Occupancy, def: StructureDef, extent: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestScore = -1;
  for (let i = 0; i < CANDIDATES; i++) {
    const p: Vec2 = [round3(rng.range(-extent * 0.78, extent * 0.78)), round3(rng.range(-extent * 0.78, extent * 0.78))];
    if (!siteOk(w(), p, def, occ, 3)) continue;
    const score = sitingScore(w(), p, def);
    if (def.need === 'coast' && score <= 0) continue;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function lakeSite(b: BlueprintBuilder, rng: Rng, occ: Occupancy, extent: number): { center: Vec2; radius: number } | null {
  let best: { center: Vec2; radius: number } | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < 400; i++) {
    const radius = round3(rng.range(9, 13));
    const p: Vec2 = [round3(rng.range(-extent * 0.7, extent * 0.7)), round3(rng.range(-extent * 0.7, extent * 0.7))];
    const h = heightAt(b.terrain, p[0], p[1]);
    if (h < b.terrain.seaLevel + 3 || occ.collides(p, radius + 3, 2)) continue;
    if (slopeAt(b.terrain, p[0], p[1], radius * 0.6) > 0.18) continue;
    if (distanceToWater(b.terrainView, b.lakes, p[0], p[1], radius + 4, 3) < radius + 4) continue;
    if (!rimHolds(b.terrainView, p, radius)) continue;
    // Prefer low ground: lakes collect water.
    if (h < bestScore) {
      bestScore = h;
      best = { center: p, radius };
    }
  }
  return best;
}

/**
 * Where a river ending at `p` (a basin) can pool: the largest of three lake
 * sizes that keeps clear of reserved footprints and other lakes (so digging
 * the basin cannot undercut a building) and whose bank holds the water.
 */
function sinkLakeSite(b: BlueprintBuilder, occ: Occupancy, p: Vec2): { center: Vec2; radius: number } | null {
  if (heightAt(b.terrain, p[0], p[1]) < b.terrain.seaLevel + 1) return null;
  for (const radius of [10, 8, 6]) {
    if (occ.collides(p, radius + 4, 2)) continue;
    if (!rimHolds(b.terrainView, p, radius)) continue;
    return { center: p, radius };
  }
  return null;
}

function plateauTop(b: BlueprintBuilder, center: Vec2): Vec2 {
  let best = center;
  let bestH = -Infinity;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    for (const r of [0, 3, 6]) {
      const p: Vec2 = [round3(center[0] + Math.cos(a) * r), round3(center[1] + Math.sin(a) * r)];
      const h = heightAt(b.terrain, p[0], p[1]);
      if (h > bestH) {
        bestH = h;
        best = p;
      }
    }
  }
  return best;
}

function highestFreeGround(b: BlueprintBuilder, rng: Rng, occ: Occupancy, extent: number, taken: readonly Vec2[]): Vec2 {
  let best: Vec2 = [0, 0];
  let bestH = -Infinity;
  for (let i = 0; i < 500; i++) {
    const p: Vec2 = [round3(rng.range(-extent * 0.65, extent * 0.65)), round3(rng.range(-extent * 0.65, extent * 0.65))];
    if (occ.collides(p, 3, 2) || taken.some((t) => dist2(t, p) < 30)) continue;
    const h = heightAt(b.terrain, p[0], p[1]);
    if (h > bestH) {
      bestH = h;
      best = p;
    }
  }
  return best;
}

interface Walk {
  path: Vec2[];
  end: 'sea' | 'lake' | 'sink' | 'edge';
  lake: Lake | null;
}

function walkDownhill(b: BlueprintBuilder, rng: Rng, occ: Occupancy, source: Vec2, extent: number): Walk {
  const step = 6;
  const path: Vec2[] = [source];
  let pos = source;
  let heading = Number.NaN;
  for (let i = 0; i < 90; i++) {
    const h0 = heightAt(b.terrain, pos[0], pos[1]);
    const gx = heightAt(b.terrain, pos[0] + 1, pos[1]) - heightAt(b.terrain, pos[0] - 1, pos[1]);
    const gz = heightAt(b.terrain, pos[0], pos[1] + 1) - heightAt(b.terrain, pos[0], pos[1] - 1);
    if (Math.hypot(gx, gz) > 0.02) heading = Math.atan2(-gz, -gx);
    if (Number.isNaN(heading)) heading = rng.range(0, Math.PI * 2);
    let next: Vec2 | null = null;
    let nextScore = Infinity;
    for (let k = -3; k <= 3; k++) {
      const a = heading + k * 0.35;
      const p: Vec2 = [round3(pos[0] + Math.cos(a) * step), round3(pos[1] + Math.sin(a) * step)];
      if (Math.abs(p[0]) > extent * 0.95 || Math.abs(p[1]) > extent * 0.95) continue;
      if (occ.all().some((f) => dist2(p, f.center) < f.radius + 3)) continue;
      const h = heightAt(b.terrain, p[0], p[1]);
      if (h >= h0 - 0.02) continue;
      const score = h + rng.range(0, 0.6) + Math.abs(k) * 0.05;
      if (score < nextScore) {
        nextScore = score;
        next = p;
      }
    }
    if (!next) {
      const atEdge = Math.abs(pos[0]) > extent * 0.85 || Math.abs(pos[1]) > extent * 0.85;
      return { path, end: atEdge ? 'edge' : 'sink', lake: null };
    }
    path.push(next);
    pos = next;
    heading = Math.atan2(next[1] - path[path.length - 2]![1], next[0] - path[path.length - 2]![0]);
    const lake = insideLake(b.lakes, pos[0], pos[1], 0);
    if (lake) return { path, end: 'lake', lake };
    if (heightAt(b.terrain, pos[0], pos[1]) < b.terrain.seaLevel + 0.3) return { path, end: 'sea', lake: null };
  }
  return { path, end: 'sink', lake: null };
}

function averageSlope(b: BlueprintBuilder, a: Vec2, c: Vec2): number {
  let sum = 0;
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    sum += slopeAt(b.terrain, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, 2);
  }
  return sum / (n + 1);
}

/** Position biased toward wet ground (near water) when `wet`, otherwise anywhere dry. */
function moistureSample(b: BlueprintBuilder, rng: Rng, extent: number, wet: boolean): Vec2 {
  let best: Vec2 = [0, 0];
  let bestScore = -Infinity;
  const tries = wet ? 10 : 1;
  for (let i = 0; i < tries; i++) {
    const p: Vec2 = [round3(rng.range(-extent * 0.85, extent * 0.85)), round3(rng.range(-extent * 0.85, extent * 0.85))];
    let score = rng.next();
    if (wet) {
      const d = Math.min(distanceToWater(b.terrainView, b.lakes, p[0], p[1], 40, 4), ...b.rivers.map((r) => distToPolyline(p, riverXZ(r))));
      score = -d;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function deriveComposition(b: BlueprintBuilder, rng: Rng, hero: Structure, landmarks: readonly Structure[]): void {
  const hx = hero.transform.position[0];
  const hz = hero.transform.position[2];
  const target: Vec3 = [hx, hero.transform.position[1] + hero.height * 0.6, hz];
  const start = rng.range(0, Math.PI * 2);
  let chosen: Vec3 | null = null;
  let fallback: Vec3 | null = null;
  const limit = b.ctx.extent * 0.98;
  for (let k = 0; k < 12 && !chosen; k++) {
    const a = start + (k / 12) * Math.PI * 2;
    for (const d of [58, 48, 70]) {
      const x = Math.max(-limit, Math.min(limit, hx + Math.cos(a) * d));
      const z = Math.max(-limit, Math.min(limit, hz + Math.sin(a) * d));
      const y = round3(Math.max(heightAt(b.terrain, x, z), b.terrain.seaLevel) + 10);
      const pos: Vec3 = [round3(x), y, round3(z)];
      fallback ??= pos;
      if (sightClear(b.terrainView, b.structures, pos, target, [hero.id]).clear) {
        chosen = pos;
        break;
      }
    }
  }
  const vantage = chosen ?? (fallback as Vec3);
  // The thirds side is read from the finished layout: the hero goes on the line
  // opposite the other landmarks, so they fill the rest of the frame.
  const fx = hx - vantage[0];
  const fz = hz - vantage[2];
  const lateral = landmarks
    .filter((s) => s.id !== hero.id)
    .reduce((sum, s) => sum + ((s.transform.position[0] - vantage[0]) * -fz + (s.transform.position[2] - vantage[2]) * fx), 0);
  const side: 1 | -1 = lateral > 0 ? -1 : 1;
  const lookAt = thirdsLookAt(vantage, target, side);
  const near: Vec3 = [round3(hx + (vantage[0] - hx) * 0.7), round3(vantage[1] - 2), round3(hz + (vantage[2] - hz) * 0.7)];
  b.setComposition({
    basis: 'derived-after-layout',
    focalPoints: [
      { id: 'focus-hero', targetId: hero.id, role: 'hero', weight: 1 },
      ...landmarks.filter((s) => s.id !== hero.id).slice(0, 3).map((s, i) => ({ id: `focus-secondary-${i + 1}`, targetId: s.id, role: 'secondary' as const, weight: 0.5 })),
      ...b.waterfalls.slice(0, 1).map((w) => ({ id: 'focus-accent-1', targetId: w.id, role: 'accent' as const, weight: 0.3 })),
    ],
    cameraPaths: [
      dollyPath('cam-establishing', 'establishing', vantage, near, lookAt, 14),
      orbitPath('cam-orbit', [hx, hero.transform.position[1] + hero.height * 0.5, hz], hero.footprintRadius * 3 + 28, 10, 24, start),
    ],
    sightlines: [{ id: 'sight-hero', from: vantage, toId: hero.id }],
  });
}
