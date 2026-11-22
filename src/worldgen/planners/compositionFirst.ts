/**
 * Strategy B: COMPOSITION-FIRST.
 *
 * Decision order:
 *   1. design-composition  choose the camera vantage from the sun direction
 *                          (side light), put the hero on a rule-of-thirds line
 *                          at a chosen depth. Nothing else exists yet.
 *   2. sculpt-silhouette   shape the terrain FOR that shot: a plateau under the
 *                          hero, a backdrop ridge or mountains behind it,
 *                          framing hills at the frame edges, ground falling
 *                          toward the camera.
 *   3. solve-landmarks     find the nearest feasible site to each DESIGNED
 *                          position (hero, secondary landmarks on the opposite
 *                          third, reflective lakes in the midground).
 *   4. leading-lines       rivers are DESIGNED as control curves from the
 *                          backdrop toward the viewer on the side opposite the
 *                          hero, then solved against the terrain (water
 *                          surface profile, footprint clearance, outlet).
 *   5. settlements         sited near a designed midground spot, outside the
 *                          camera-to-hero corridor.
 *   6. approach-network    a processional spine from a foreground waystone to
 *                          the hero; every other place branches off the
 *                          network (spine and branch, not a spanning tree).
 *   7. framing-ecology     vegetation frames the shot (frame edges, backdrop)
 *                          and keeps the sightline corridor clear of tall plants.
 *   8. camera-paths        re-aim the designed shot at the solved hero position,
 *                          raising (not moving) the camera if the view is blocked.
 *
 * The shot decides the layout; geography is then solved to make the shot plausible.
 */
import { createRng, hashString } from '../../core/random';
import { BlueprintBuilder, type BuildContext } from '../builder';
import { FOREST_MIN_CLUSTERS, LIMITS, STRUCTURE_DEFS, lightingFor, type SpeciesDef, type StructureDef } from '../catalog';
import { DEFAULT_FOV_DEG, THIRDS_ANGLE, dollyPath, orbitPath, sightClear, thirdsLookAt } from '../composition';
import { dist2, distToSegment, round3, smoothCurve, xz } from '../geometry';
import { Occupancy, siteOk, sitingScore, type World2D } from '../placement';
import {
  farBankOutpost,
  placeSettlement,
  settlementScore,
  speciesPool,
  standNear,
  tryPlant,
  vegetationBudget,
  waterSideSpots,
} from '../populate';
import { bestRoute, bridgeCrossings, obstaclesFor } from '../routing';
import { heightAt, insideLake, rimHolds, slopeAt } from '../terrain';
import type { CameraKeyframe, CameraPath, ConceptId, Lake, PathWay, RiverMouth, Structure, Vec2, Vec3, WorldBlueprint } from '../types';

const STRATEGY_SALT = hashString('composition-first');

interface Shot {
  readonly camera: Vec2;
  readonly forward: Vec2;
  readonly right: Vec2;
  readonly side: 1 | -1;
  readonly heroDepth: number;
  readonly lateral: number;
  readonly hero: Vec2;
}

export function planCompositionFirst(ctx: BuildContext): WorldBlueprint {
  const b = new BlueprintBuilder(ctx);
  const rng = createRng((ctx.seed ^ STRATEGY_SALT) >>> 0);
  const occ = new Occupancy();
  const { spec, interp, extent: E } = ctx;
  const world = (): World2D => ({ terrain: b.terrainView, lakes: b.lakes, rivers: b.rivers, extent: E });
  const reqIds = (c: ConceptId): string[] => {
    const id = interp.requirements.find((r) => r.concept === c && !r.negated)?.id;
    return id ? [id] : [];
  };
  const note = (kind: string, subject: string, detail: string) =>
    b.extraConstraints.push({ id: `x${b.extraConstraints.length + 1}`, kind, subject, detail, implied: true });
  const clampXZ = (p: Vec2, lim = 0.85): Vec2 => [round3(Math.max(-E * lim, Math.min(E * lim, p[0]))), round3(Math.max(-E * lim, Math.min(E * lim, p[1])))];

  // ---- 1. design-composition ---------------------------------------------
  const light = lightingFor(interp.timeOfDay, interp.weather, interp.theme);
  const side: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
  const sunAz = (light.sun.azimuthDeg * Math.PI) / 180;
  const camAz = sunAz + side * (Math.PI / 2) + rng.range(-0.3, 0.3);
  const u: Vec2 = [Math.cos(camAz), Math.sin(camAz)];
  const forward: Vec2 = [-u[0], -u[1]];
  const right: Vec2 = [-forward[1], forward[0]];
  const camDist = E * 0.92;
  const camera: Vec2 = [round3(u[0] * camDist), round3(u[1] * camDist)];
  const heroDef = STRUCTURE_DEFS[spec.hero];
  const heroDepth = heroDef.need === 'coast' && spec.sea ? camDist - E * 0.4 : camDist * 0.95;
  const lateral = heroDepth * Math.tan(THIRDS_ANGLE);
  const at = (depth: number, lat: number): Vec2 => [
    round3(camera[0] + forward[0] * depth + right[0] * lat),
    round3(camera[1] + forward[1] * depth + right[1] * lat),
  ];
  const shot: Shot = { camera, forward, right, side, heroDepth, lateral, hero: at(heroDepth, side * lateral) };
  b.stage(
    'design-composition',
    `Camera placed for side light (sun ${Math.round(light.sun.azimuthDeg)} deg); hero ${spec.hero} designed on the ${side > 0 ? 'right' : 'left'} third at depth ${Math.round(heroDepth)}.`,
  );
  note('composition', 'hero', `Hero designed at (${shot.hero[0]}, ${shot.hero[1]}) on the ${side > 0 ? 'right' : 'left'} thirds line.`);
  for (const conflict of spec.conflicts) note('conflict', 'prompt', conflict);
  const inCorridor = (p: Vec2, radius: number): boolean => distToSegment(p, shot.camera, shot.hero) < radius + 5 && dist2(p, shot.hero) > radius + 6;

  // ---- 2. sculpt-silhouette ----------------------------------------------
  b.stage('sculpt-silhouette', 'Terrain shaped for the shot: plateau under the hero, backdrop behind it, framing hills at the frame edges, ground falling toward the camera.');
  if (spec.sea) b.terrain.islandRadius = round3(E * 0.72);
  b.terrain.tilt = { angle: round3(camAz), gradient: -0.04 };
  const rightAngle = Math.atan2(right[1], right[0]);
  b.addRegion({
    kind: 'pedestal',
    center: shot.hero,
    radius: Math.max(12, heroDef.footprint * 1.6),
    amplitude: 5,
    sharpness: 4,
    rationale: 'Raised, level plateau so the hero stands proud of its surroundings.',
  });
  const backdrop: Vec2[] = [];
  const mountainCount = spec.mountains > 0 ? spec.mountains : interp.biome === 'alpine' ? 1 : 0;
  if (mountainCount > 0) {
    for (let i = 0; i < mountainCount; i++) {
      const c = clampXZ(at(heroDepth + 52 + 8 * i, (i - (mountainCount - 1) / 2) * 34 - side * 8));
      backdrop.push(c);
      b.addRegion({
        kind: 'mountain',
        center: c,
        radius: rng.range(22, 26),
        amplitude: rng.range(30, 38),
        requirementIds: spec.mountains > 0 ? reqIds('mountain') : [],
        rationale: 'Mountain placed behind the hero as a backdrop silhouette.',
      });
    }
  } else {
    const c = clampXZ(at(heroDepth + 38, -side * 6));
    backdrop.push(c);
    b.addRegion({
      kind: 'ridge',
      center: c,
      radius: 14,
      amplitude: rng.range(20, 26),
      aspect: 3.2,
      angle: rightAngle,
      rationale: 'Long ridge behind the hero: a backdrop silhouette and a high source for water.',
    });
  }
  const framing = Math.max(spec.hills, 2);
  for (let i = 0; i < framing; i++) {
    const s = i % 2 === 0 ? -side : side;
    const depth = 34 + 12 * Math.floor(i / 2);
    const requested = i < spec.hills;
    b.addRegion({
      kind: 'hill',
      center: clampXZ(at(depth, s * depth * 0.62)),
      radius: rng.range(11, 14),
      amplitude: requested ? rng.range(8, 11) : rng.range(5, 7),
      requirementIds: requested ? reqIds('hill') : [],
      rationale: requested ? 'Requested hill, placed at a frame edge as a framing element.' : 'Framing hill at the frame edge (foreground layer).',
    });
  }
  for (let i = 0; i < spec.valleys; i++) {
    const c = clampXZ(at(heroDepth * (0.45 + 0.15 * i), -side * lateral * 0.3));
    const depthOk = Math.max(2, Math.min(6, b.height(c[0], c[1]) - 2));
    b.addRegion({
      kind: 'valley',
      center: c,
      radius: 14,
      amplitude: -depthOk,
      aspect: 2.6,
      angle: round3(camAz),
      requirementIds: reqIds('valley'),
      rationale: 'Requested valley, aligned with the view so it leads the eye toward the hero.',
    });
  }
  let cliff: Vec2 | null = null;
  if (spec.cliffs > 0) {
    cliff = clampXZ(at(heroDepth + 14, -side * 14));
    b.addRegion({
      kind: 'cliff',
      center: cliff,
      radius: 11,
      amplitude: 15,
      sharpness: 4,
      requirementIds: [...reqIds('cliff'), ...reqIds('waterfall')].slice(0, 1),
      rationale: 'Steep-edged plateau on the third opposite the hero, so a waterfall balances the frame.',
    });
  }
  b.addRegion({
    kind: 'undulation',
    center: clampXZ(at(heroDepth * 0.6, side * lateral * 1.6)),
    radius: 24,
    amplitude: rng.range(1.5, 3),
    rationale: 'Low midground swell for depth variation.',
  });

  // ---- 3. solve-landmarks ------------------------------------------------
  b.stage('solve-landmarks', 'Each landmark goes to the feasible site nearest its designed position; secondary landmarks balance the hero on the opposite third.');
  const rejectCorridor = (r: number) => (p: Vec2) => inCorridor(p, r);
  let hero: Structure | null = null;
  const heroSite = solveSite(world, occ, shot.hero, heroDef, 30) ?? solveSite(world, occ, shot.hero, heroDef, 60);
  if (heroSite) {
    const moved = round3(dist2(heroSite, shot.hero));
    hero = b.addStructure({
      kind: spec.hero,
      at: heroSite,
      yaw: Math.atan2(-forward[1], -forward[0]),
      requirementIds: spec.heroRequirementId ? [spec.heroRequirementId] : [],
      extraTags: ['hero'],
      rationale: `Hero landmark at the feasible site nearest its designed thirds position (moved ${moved} units)${spec.heroDefaulted ? '; landmark chosen by biome default' : ''}.`,
    });
    occ.add({ id: hero.id, center: heroSite, radius: heroDef.footprint + 2 });
  } else note('unsatisfied', spec.hero, 'No feasible site near the designed hero position.');

  const landmarks: Structure[] = hero ? [hero] : [];
  let k = 0;
  for (const order of spec.structures) {
    const start = order.kind === spec.hero ? 1 : 0;
    for (let i = start; i < order.count; i++) {
      if (b.structures.length >= LIMITS.structures) break;
      const def = STRUCTURE_DEFS[order.kind];
      const designed = clampXZ(at(heroDepth * (0.72 + 0.18 * (k % 3)), -side * (lateral * 0.8 + 12 * Math.floor(k / 3) + 6 * (k % 3))));
      k++;
      const site = solveSite(world, occ, designed, def, 36, rejectCorridor(def.footprint)) ?? solveSite(world, occ, designed, def, 70, rejectCorridor(def.footprint));
      if (!site) {
        note('unsatisfied', order.kind, `No feasible site near the designed position for ${order.kind}.`);
        continue;
      }
      const s = b.addStructure({
        kind: order.kind,
        at: site,
        yaw: Math.atan2(-forward[1], -forward[0]),
        requirementIds: order.requirementId ? [order.requirementId] : [],
        rationale: 'Secondary landmark solved near its designed spot on the third opposite the hero.',
      });
      occ.add({ id: s.id, center: site, radius: def.footprint + 2 });
      landmarks.push(s);
    }
  }

  for (let i = 0; i < spec.lakes; i++) {
    const designed = clampXZ(at(heroDepth * 0.5 + 14 * i, side * lateral * (0.35 - 0.9 * i)));
    const site = solveLake(b, occ, designed, 30);
    if (!site) {
      note('unsatisfied', 'lake', 'No flat dry ground near the designed midground lake position.');
      continue;
    }
    const lake = b.addLake({ center: site.center, radius: site.radius, requirementIds: reqIds('lake'), rationale: 'Lake in the midground, between camera and hero, to reflect the scene.' });
    occ.add({ id: lake.id, center: lake.center, radius: lake.radius + 2 });
  }

  // ---- 4. leading-lines --------------------------------------------------
  b.stage('leading-lines', 'Rivers are designed as curves from the backdrop toward the viewer on the side opposite the hero, then solved against the terrain.');
  const lakeIds = new Set(b.lakes.map((l) => l.id));
  for (let i = 0; i < spec.rivers; i++) {
    const s = i === 0 ? -side : side;
    const src = backdrop[i % backdrop.length] as Vec2;
    const control: Vec2[] = [];
    const source = clampXZ([src[0] - forward[0] * 6 + right[0] * s * 14, src[1] - forward[1] * 6 + right[1] * s * 14], 0.9);
    control.push(source);
    if (i === 0 && cliff) {
      control.push(cliff);
      control.push(clampXZ([cliff[0] - forward[0] * 16, cliff[1] - forward[1] * 16], 0.9));
    }
    const latMid = s === side ? side * (lateral + heroDef.footprint + 16) : s * lateral * 0.7;
    control.push(clampXZ(at(heroDepth * 0.55, latMid), 0.9));
    const firstLake = b.lakes[0];
    const toLake = !spec.sea && firstLake !== undefined && i === 0;
    if (toLake) control.push(firstLake.center);
    else {
      const fg = clampXZ(at(heroDepth * 0.22, s * lateral * 0.25), 0.9);
      control.push(fg);
      // Carry on toward the camera until the river reaches the sea or the edge.
      for (let step = 1; step <= 12; step++) {
        const p = clampXZ([fg[0] - forward[0] * 8 * step, fg[1] - forward[1] * 8 * step], 0.98);
        control.push(p);
        if (heightAt(b.terrain, p[0], p[1]) < b.terrain.seaLevel || Math.abs(p[0]) >= E * 0.97 || Math.abs(p[1]) >= E * 0.97) break;
      }
    }
    const solved = solveRiverPath(b, occ, smoothCurve(dedupe(control), 6), lakeIds);
    if (solved.path.length < 3) {
      note('unsatisfied', 'river', 'The designed river curve collapsed when solved against the terrain.');
      continue;
    }
    const river = b.addRiver({
      path: solved.path,
      width: round3(rng.range(2.2, 3.2)),
      mouth: solved.mouth,
      requirementIds: reqIds('river'),
      rationale: 'River designed as a leading line toward the viewer; surface solved downhill from the terrain.',
    });
    const falls = b.markWaterfalls(river, i === 0 ? spec.waterfalls : 0, reqIds('waterfall'));
    if (i === 0 && spec.waterfalls > falls.length) note('unsatisfied', 'waterfall', `Requested ${spec.waterfalls} waterfall(s); the solved river has ${falls.length} drop(s) large enough.`);
  }

  // ---- 5. settlements ----------------------------------------------------
  b.stage('settlements', 'Settlements solved near designed midground spots, outside the camera-to-hero corridor.');
  const settlementReq = [...reqIds('village'), ...reqIds('house')].slice(0, 1);
  for (let i = 0; i < spec.settlements; i++) {
    const houses = Math.max(3, Math.min(LIMITS.housesPerSettlement, spec.houses > 0 ? spec.houses : 5));
    const radius = 7 + houses * 1.4;
    const designed = clampXZ(at(heroDepth * (0.62 - 0.25 * i), (i === 0 ? side : -side) * lateral * 1.1));
    const center = solveSettlement(b, occ, designed, radius, 45, (p) => inCorridor(p, radius));
    const settlement = center ? placeSettlement(b, rng, occ, center, houses, settlementReq, 'Settlement solved near its designed midground spot.') : null;
    if (!settlement) note('unsatisfied', `settlement-${i + 1}`, 'No flat dry ground near the designed settlement spot.');
  }

  // ---- 6. approach-network -----------------------------------------------
  b.stage('approach-network', 'A processional path leads from a foreground waystone to the hero; every other place branches off that network.');
  const roadReq = reqIds('road');
  const bridgeReq = reqIds('bridge');
  const bridgeWhy = 'A path crosses a river here; a bridge carries it over.';
  const network: PathWay[] = [];
  let arrival: Structure | null = null;
  if (hero) {
    const lateralArrival = spec.bridges > 0 && b.rivers.length > 0 ? -side * lateral * 0.9 : side * lateral * 0.2;
    const designed = clampXZ(at(heroDepth * 0.25, lateralArrival));
    const site = solveSite(world, occ, designed, STRUCTURE_DEFS.monument, 40) ?? solveSite(world, occ, designed, STRUCTURE_DEFS.monument, 80);
    if (site) {
      arrival = b.addStructure({ kind: 'monument', at: site, nameKey: 'waystone', rationale: 'Foreground waystone where the processional approach begins.', extraTags: ['arrival'] });
      occ.add({ id: arrival.id, center: site, radius: STRUCTURE_DEFS.monument.footprint + 1 });
      const spine = b.addPath({
        kind: 'road',
        line: bestRoute(b, site, xz(hero.transform.position), obstaclesFor(b, [arrival.id, hero.id]), { requireCrossing: spec.bridges > 0 && b.rivers.length > 0 }),
        fromId: arrival.id,
        toId: hero.id,
        width: 2.6,
        requirementIds: roadReq,
        rationale: 'Processional approach: the main leading line from the foreground to the hero.',
      });
      network.push(spine);
      bridgeCrossings(b, spine, bridgeReq, bridgeWhy);
    } else note('unsatisfied', 'approach', 'No dry foreground ground for the approach waystone.');
  }
  const branchTo = (node: { id: string; at: Vec2 }, requireCrossing = false) => {
    if (network.length === 0) return;
    let best: { path: PathWay; point: Vec2 } | null = null;
    let bestD = Infinity;
    // Join the network outside every other building, so the branch does not cut through one.
    const blocked = (q: Vec2) => b.structures.some((s) => s.id !== node.id && dist2(q, xz(s.transform.position)) < s.footprintRadius + 2);
    for (const p of network) {
      for (const q of p.points) {
        if (blocked(xz(q))) continue;
        const d = dist2(node.at, xz(q));
        if (d < bestD) {
          bestD = d;
          best = { path: p, point: xz(q) };
        }
      }
    }
    if (!best) return;
    const branch = b.addPath({
      kind: 'trail',
      line: bestRoute(b, node.at, best.point, obstaclesFor(b, [node.id]), { requireCrossing }),
      fromId: node.id,
      toId: best.path.id,
      width: 1.8,
      requirementIds: roadReq,
      rationale: 'Branch from this place to the nearest point of the approach network.',
    });
    network.push(branch);
    bridgeCrossings(b, branch, bridgeReq, bridgeWhy);
  };
  const others = [
    ...landmarks.filter((s) => s.id !== hero?.id).map((s) => ({ id: s.id, at: xz(s.transform.position) })),
    ...b.settlements.map((s) => ({ id: s.id, at: s.center })),
  ];
  if (hero) others.sort((a, c) => dist2(a.at, xz(hero.transform.position)) - dist2(c.at, xz(hero.transform.position)) || (a.id < c.id ? -1 : 1));
  for (const node of others) branchTo(node);
  let guard = 0;
  while (hero && b.bridges.length < spec.bridges && guard++ < spec.bridges + 2) {
    const crossing = farBankOutpost(b, occ, { id: hero.id, at: xz(hero.transform.position) }, world);
    if (!crossing) break;
    const trail = b.addPath({
      kind: 'trail',
      line: crossing.line,
      fromId: hero.id,
      toId: crossing.outpost.id,
      width: 1.8,
      requirementIds: roadReq,
      rationale: 'Designed crossing from the hero to a far-bank waypoint.',
    });
    network.push(trail);
    bridgeCrossings(b, trail, bridgeReq, bridgeWhy);
  }
  if (b.bridges.length < spec.bridges) note('unsatisfied', 'bridge', `Requested ${spec.bridges} bridge(s); ${b.bridges.length} crossing(s) were needed by the network.`);

  // ---- 7. framing-ecology ------------------------------------------------
  b.stage('framing-ecology', 'Vegetation frames the shot at the frame edges and behind the hero; tall plants are kept out of the sightline corridor.');
  const tall = new Set<SpeciesDef['kind']>(['tree', 'cactus']);
  const plant = (sp: SpeciesDef, center: Vec2, radius: number, ids: readonly string[], why: string) =>
    tryPlant(b, occ, sp, clampXZ(center, 0.9), radius, ids, why, tall.has(sp.kind) ? (p, r) => inCorridor(p, r) : undefined);
  const trees = speciesPool(b, ['tree', 'cactus']);
  const low = speciesPool(b, ['flower', 'grass', 'shrub']);
  const budget = vegetationBudget(b);
  const forestIds = reqIds('forest');
  const treeIds = reqIds('tree');
  // Frame edges (foreground layer).
  for (const s of [-1, 1]) {
    for (let j = 0; j < 4; j++) {
      const sp = trees[j % Math.max(trees.length, 1)];
      if (!sp) break;
      const depth = 28 + j * 9;
      if (plant(sp, at(depth, s * depth * (0.55 + rng.range(0, 0.1))), round3(rng.range(5, 7)), spec.trees ? treeIds : [], 'Framing vegetation at the frame edge.')) break;
    }
  }
  // Backdrop band behind the hero (forest silhouette when requested).
  const backdropTarget = spec.forest ? 8 : 3;
  let made = 0;
  for (let j = 0; j < backdropTarget * 6 && made < backdropTarget; j++) {
    const sp = trees[j % Math.max(trees.length, 1)];
    if (!sp) break;
    const p = at(heroDepth + rng.range(12, 30), side * lateral + rng.range(-45, 45));
    if (plant(sp, p, round3(rng.range(5, 8)), spec.forest ? forestIds : [], spec.forest ? 'Requested forest, massed behind the hero as a backdrop silhouette.' : 'Backdrop vegetation behind the hero.')) made++;
  }
  // Foreground flowers and grasses around the approach.
  const flowerIds = reqIds('flowers');
  const flowers = speciesPool(b, ['flower']);
  if (arrival) {
    const base = xz(arrival.transform.position);
    for (let j = 0; j < 10 && flowers.length > 0; j++) {
      const sp = flowers[j % flowers.length] as SpeciesDef;
      const a = rng.range(0, Math.PI * 2);
      if (plant(sp, [base[0] + Math.cos(a) * 9, base[1] + Math.sin(a) * 9], 4, spec.flowers ? flowerIds : [], 'Foreground flowers beside the approach.') && j > 1) break;
    }
  }
  if (spec.flowers && !b.vegetation.some((v) => v.vegetationKind === 'flower')) {
    for (let j = 0; j < 30 && flowers.length > 0; j++) {
      const sp = flowers[j % flowers.length] as SpeciesDef;
      if (plant(sp, at(rng.range(20, heroDepth), rng.range(-1, 1) * 40), 4, flowerIds, 'Requested flowers in the visible midground.')) break;
    }
  }
  if (spec.trees && !b.vegetation.some((v) => v.vegetationKind === 'tree')) {
    for (let j = 0; j < 30 && trees.length > 0; j++) {
      const sp = trees[j % trees.length] as SpeciesDef;
      if (plant(sp, at(rng.range(25, heroDepth * 1.3), rng.range(-1, 1) * 55), 5, treeIds, 'Requested trees in the visible scene.')) break;
    }
  }
  // Requested trees or forest still short (for example desert palms, which need
  // water): plant on the banks of the water that exists.
  const treeTarget = spec.forest ? FOREST_MIN_CLUSTERS : spec.trees ? 1 : 0;
  const treeCount = () => b.vegetation.filter((v) => v.vegetationKind === 'tree').length;
  if (treeCount() < treeTarget && trees.length > 0) {
    for (const spot of waterSideSpots(b)) {
      if (treeCount() >= treeTarget) break;
      for (const sp of trees) {
        if (plant(sp, spot, 4.5, spec.forest ? forestIds : treeIds, 'Requested trees planted on a bank, where the species can grow.')) break;
      }
    }
  }
  // Reeds on the river banks, in view.
  const reed = speciesPool(b).find((s) => s.id === 'reed-bed');
  if (reed) {
    for (const river of b.rivers.slice(0, 2)) {
      const mid = river.points[Math.floor(river.points.length * 0.6)] as Vec3;
      plant(reed, [mid[0] + right[0] * (river.width + 3), mid[2] + right[1] * (river.width + 3)], 3.5, [], 'Reeds along the river bank in the midground.');
    }
  }
  // Ambient fill inside the view frustum.
  const ambient = [...low, ...trees];
  for (let j = 0; j < budget * 12 && b.vegetation.length < budget && ambient.length > 0; j++) {
    const sp = ambient[j % ambient.length] as SpeciesDef;
    const depth = rng.range(20, heroDepth * 1.4);
    plant(sp, at(depth, rng.range(-0.6, 0.6) * depth), round3(rng.range(3.5, 6.5)), [], 'Ambient ecology inside the view.');
  }

  // ---- characters --------------------------------------------------------
  const charIds = reqIds('character');
  const spine = network[0];
  const wanted = spec.characters > 0 ? spec.characters : hero ? 1 : 0;
  for (let i = 0; i < wanted; i++) {
    const settlement = b.settlements[i % Math.max(b.settlements.length, 1)];
    const inVillage = settlement !== undefined && i % 2 === 1;
    let anchor: Vec2 | null = null;
    let homeId: string | null = hero?.id ?? null;
    let role = hero && (hero.structureKind === 'lighthouse' || hero.structureKind === 'tower') ? 'keeper' : 'guardian';
    if (inVillage) {
      anchor = settlement.center;
      homeId = settlement.id;
      role = 'villager';
    } else if (spine && i > 0) {
      anchor = xz(spine.points[Math.floor((spine.points.length - 1) * (i / (wanted + 1)))] as Vec3);
      role = 'wanderer';
    } else if (hero) anchor = xz(hero.transform.position);
    if (!anchor) continue;
    const minR = inVillage ? settlement.radius * 0.5 : role === 'wanderer' ? 2 : (hero?.footprintRadius ?? 3) + 1;
    const stand = standNear(b, rng, anchor, minR);
    if (!stand) continue;
    b.addCharacter({
      role,
      at: stand,
      homeId,
      requirementIds: spec.characters > 0 ? charIds : [],
      rationale: spec.characters > 0 ? 'Requested character, placed in view along the approach or at home.' : 'Ambient keeper for the hero landmark; the prompt did not ask for characters.',
    });
  }
  if (hero) {
    const heroXZ = xz(hero.transform.position);
    const entry = spine ? nearestPoint(spine.points.map(xz), heroXZ, hero.footprintRadius + 1) : null;
    const where = entry ?? standNear(b, rng, heroXZ, hero.footprintRadius) ?? [heroXZ[0] + hero.footprintRadius + 2, heroXZ[1]];
    b.addInteractable({ targetId: hero.id, at: where, interaction: 'enter', rationale: 'Entrance where the approach meets the hero.' });
  }

  // ---- 8. camera-paths ---------------------------------------------------
  b.stage('camera-paths', 'The designed shot is re-aimed at the solved hero; the camera rises, not moves, if terrain or structures block the view.');
  if (hero) finishShot(b, shot, hero, landmarks, arrival, spine ?? null);
  else b.setComposition({ basis: 'designed-first', focalPoints: [], cameraPaths: [], sightlines: [] });

  return b.finish();
}

// ---------------------------------------------------------------------------

function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.length || dist2(out[out.length - 1] as Vec2, p) > 1) out.push(p);
  return out;
}

function solveSite(w: () => World2D, occ: Occupancy, designed: Vec2, def: StructureDef, maxR: number, reject?: (p: Vec2) => boolean): Vec2 | null {
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (let ring = 0; ring * 3 <= maxR; ring++) {
    const rad = ring * 3;
    const n = ring === 0 ? 1 : ring * 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p: Vec2 = [round3(designed[0] + Math.cos(a) * rad), round3(designed[1] + Math.sin(a) * rad)];
      if (reject?.(p)) continue;
      if (!siteOk(w(), p, def, occ, 3)) continue;
      const s = sitingScore(w(), p, def);
      if (def.need === 'coast' && s <= 0) continue;
      const score = s * 0.6 + (1 - rad / Math.max(maxR, 1)) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}

function solveLake(b: BlueprintBuilder, occ: Occupancy, designed: Vec2, maxR: number): { center: Vec2; radius: number } | null {
  const radius = 10;
  for (let ring = 0; ring * 3 <= maxR; ring++) {
    const rad = ring * 3;
    const n = ring === 0 ? 1 : ring * 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p: Vec2 = [round3(designed[0] + Math.cos(a) * rad), round3(designed[1] + Math.sin(a) * rad)];
      if (heightAt(b.terrain, p[0], p[1]) < b.terrain.seaLevel + 3) continue;
      if (occ.collides(p, radius + 3, 2)) continue;
      if (slopeAt(b.terrain, p[0], p[1], radius * 0.6) > 0.2) continue;
      if (!rimHolds(b.terrainView, p, radius)) continue;
      let dry = true;
      for (let j = 0; j < 8 && dry; j++) {
        const t = (j / 8) * Math.PI * 2;
        if (heightAt(b.terrain, p[0] + Math.cos(t) * (radius + 4), p[1] + Math.sin(t) * (radius + 4)) < b.terrain.seaLevel + 1) dry = false;
      }
      if (dry) return { center: p, radius };
    }
  }
  return null;
}

function solveSettlement(b: BlueprintBuilder, occ: Occupancy, designed: Vec2, radius: number, maxR: number, reject: (p: Vec2) => boolean): Vec2 | null {
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (let ring = 0; ring * 4 <= maxR; ring++) {
    const rad = ring * 4;
    const n = ring === 0 ? 1 : ring * 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p: Vec2 = [round3(designed[0] + Math.cos(a) * rad), round3(designed[1] + Math.sin(a) * rad)];
      if (reject(p) || occ.collides(p, radius, 2)) continue;
      const s = settlementScore(b, p);
      if (s < 0) continue;
      const score = s * 0.6 + (1 - rad / maxR) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}

/**
 * Solves a designed river curve against the world: pushes points out of
 * structure footprints, stops at the first lake or sea it reaches, and decides
 * the outlet. The horizontal path is the design; the water surface is computed
 * later by `profileRiver`.
 */
function solveRiverPath(b: BlueprintBuilder, occ: Occupancy, curve: readonly Vec2[], lakeIds: ReadonlySet<string>): { path: Vec2[]; mouth: RiverMouth } {
  const MAX_STEP = 5;
  const push = (p: Vec2): Vec2 => {
    let q = p;
    for (const f of occ.all()) {
      if (lakeIds.has(f.id)) continue;
      const clear = f.radius + 4.5;
      const d = dist2(q, f.center);
      if (d < clear) {
        const dx = d === 0 ? 1 : (q[0] - f.center[0]) / d;
        const dz = d === 0 ? 0 : (q[1] - f.center[1]) / d;
        q = [round3(f.center[0] + dx * clear), round3(f.center[1] + dz * clear)];
      }
    }
    return q;
  };
  const densify = (line: readonly Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i] as Vec2;
      const c = line[i + 1] as Vec2;
      const steps = Math.max(1, Math.ceil(dist2(a, c) / MAX_STEP));
      for (let k = 0; k < steps; k++) out.push([round3(a[0] + ((c[0] - a[0]) * k) / steps), round3(a[1] + ((c[1] - a[1]) * k) / steps)]);
    }
    if (line.length) out.push(line[line.length - 1] as Vec2);
    return out;
  };
  // Pushing points out of footprints can open gaps; densify and push again until
  // the spacing is small everywhere (a short chord cannot cut back into a footprint).
  let pushed: Vec2[] = curve.map(push);
  for (let pass = 0; pass < 6; pass++) {
    pushed = densify(pushed).map(push);
    let maxGap = 0;
    for (let i = 0; i + 1 < pushed.length; i++) maxGap = Math.max(maxGap, dist2(pushed[i] as Vec2, pushed[i + 1] as Vec2));
    if (maxGap <= MAX_STEP + 0.5) break;
  }
  const path: Vec2[] = [];
  for (const p of pushed) {
    if (path.length && dist2(path[path.length - 1] as Vec2, p) < 1.5) continue;
    path.push(p);
    if (path.length < 2) continue;
    const lake: Lake | null = insideLake(b.lakes, p[0], p[1], 0);
    if (lake) return { path, mouth: { type: 'lake', lakeId: lake.id } };
    if (heightAt(b.terrain, p[0], p[1]) < b.terrain.seaLevel + 0.3) return { path, mouth: { type: 'sea' } };
  }
  // No lake or sea reached: the river leaves the map. The validator checks
  // that an 'edge' mouth really is near the map boundary.
  return { path, mouth: { type: 'edge' } };
}

function nearestPoint(line: readonly Vec2[], target: Vec2, minDist: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const p of line) {
    const d = dist2(p, target);
    if (d >= minDist && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function finishShot(b: BlueprintBuilder, shot: Shot, hero: Structure, landmarks: readonly Structure[], arrival: Structure | null, spine: PathWay | null): void {
  const hp = hero.transform.position;
  const top: Vec3 = [hp[0], hp[1] + hero.height * 0.6, hp[2]];
  const cx = shot.camera[0];
  const cz = shot.camera[1];
  const ground = Math.max(heightAt(b.terrain, cx, cz), b.terrain.seaLevel);
  let camera: Vec3 = [cx, round3(ground + 10), cz];
  for (let lift = 0; lift <= 24; lift += 4) {
    const candidate: Vec3 = [cx, round3(ground + 10 + lift), cz];
    camera = candidate;
    if (sightClear(b.terrainView, b.structures, candidate, top, [hero.id]).clear) break;
  }
  // Re-aim so the solved hero sits on the designed thirds line.
  const lookAt = thirdsLookAt(camera, top, shot.side);
  const establishing: CameraPath = {
    id: 'cam-establishing',
    kind: 'establishing',
    durationSec: 12,
    keyframes: [0, 1, 2, 3].map(
      (i): CameraKeyframe => ({
        t: i * 4,
        position: [round3(cx + (lookAt[0] - cx) * 0.08 * i), round3(camera[1] - 0.5 * i), round3(cz + (lookAt[2] - cz) * 0.08 * i)],
        lookAt,
        fovDeg: DEFAULT_FOV_DEG,
      }),
    ),
  };
  const paths: CameraPath[] = [establishing];
  if (spine && spine.points.length >= 4) {
    const pts = spine.points;
    const picks = [0, Math.floor(pts.length / 3), Math.floor((2 * pts.length) / 3), pts.length - 2].map((i) => pts[Math.max(0, i)] as Vec3);
    paths.push({
      id: 'cam-reveal',
      kind: 'reveal',
      durationSec: 18,
      keyframes: picks.map((p, i) => ({ t: i * 6, position: [p[0], round3(p[1] + 3), p[2]], lookAt: top, fovDeg: DEFAULT_FOV_DEG })),
    });
  } else paths.push(dollyPath('cam-reveal', 'dolly', camera, [round3((cx + hp[0]) / 2), round3(camera[1] - 3), round3((cz + hp[2]) / 2)], top, 12));
  paths.push(orbitPath('cam-orbit', [hp[0], hp[1] + hero.height * 0.5, hp[2]], hero.footprintRadius * 3 + 28, 10, 24, Math.atan2(cz - hp[2], cx - hp[0])));

  b.setComposition({
    basis: 'designed-first',
    focalPoints: [
      { id: 'focus-hero', targetId: hero.id, role: 'hero', weight: 1 },
      ...landmarks.filter((s) => s.id !== hero.id).slice(0, 3).map((s, i) => ({ id: `focus-secondary-${i + 1}`, targetId: s.id, role: 'secondary' as const, weight: 0.5 })),
      ...b.waterfalls.slice(0, 1).map((w) => ({ id: 'focus-accent-1', targetId: w.id, role: 'accent' as const, weight: 0.35 })),
      ...(arrival ? [{ id: 'focus-accent-2', targetId: arrival.id, role: 'accent' as const, weight: 0.2 }] : []),
    ],
    cameraPaths: paths,
    sightlines: [
      { id: 'sight-hero', from: camera, toId: hero.id },
      ...(arrival ? [{ id: 'sight-arrival', from: [arrival.transform.position[0], round3(arrival.transform.position[1] + 1.7), arrival.transform.position[2]] as Vec3, toId: hero.id }] : []),
    ],
  });
}
