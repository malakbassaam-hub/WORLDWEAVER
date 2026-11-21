import * as THREE from 'three';
import { createRng, hashString } from '../core/random';
import type { Entity, VisualComponent } from '../core/types';
import { fbm3 } from './noise';
import { BEAM_FRAGMENT, BEAM_VERTEX } from './shaders';
import { glowTexture } from './textures';

/**
 * Procedural visual recipes keyed by `VisualComponent.archetype`.
 *
 * Each factory builds geometry deterministically from the entity id, so the
 * same world always looks the same. `applyVisual` must be idempotent: the
 * renderer calls it whenever the entity's visual component changes.
 */
export interface ArchetypeInstance {
  /** Receives the entity's scale. Child entities are NOT parented to it. */
  readonly body: THREE.Object3D;
  /** Where a generic LightComponent should be attached, if not the root. */
  readonly lightAnchor?: THREE.Object3D;
  applyVisual(visual: VisualComponent): void;
  /** Presentation-only animation. Must never change world state. */
  tick?(time: number): void;
}

export type ArchetypeFactory = (entity: Entity) => ArchetypeInstance;
type Paint = (v: VisualComponent) => void;

const NO_PICK = { noPick: true };

function make(body: THREE.Object3D, paints: Paint[], extra: Partial<Pick<ArchetypeInstance, 'tick' | 'lightAnchor'>> = {}): ArchetypeInstance {
  return { body, ...extra, applyVisual: (v) => paints.forEach((p) => p(v)) };
}

function hdr(target: THREE.Color, hex: string, k: number): THREE.Color {
  return target.set(hex).multiplyScalar(k);
}

// ---------------------------------------------------------------------------
// Crystal primitive
// ---------------------------------------------------------------------------

function crystalGeometry(radius: number, height: number, sides = 8): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0, -height * 0.08),
    new THREE.Vector2(radius * 0.08, 0),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius * 0.92, height * 0.55),
    new THREE.Vector2(radius * 0.82, height * 0.72),
    new THREE.Vector2(0, height),
  ];
  return new THREE.LatheGeometry(profile, sides);
}

/**
 * A faceted translucent shell with an additive inner core. The shell does not
 * write depth so the core renders through it; both are convex, so no
 * self-sorting artefacts.
 */
function crystal(radius: number, height: number, paints: Paint[], glowScale = 1): THREE.Group {
  const group = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.08,
    metalness: 0.15,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const shell = new THREE.Mesh(crystalGeometry(radius, height), shellMat);
  shell.castShadow = true;
  shell.renderOrder = 1;

  const coreMat = new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const core = new THREE.Mesh(crystalGeometry(radius * 0.42, height * 0.84, 6), coreMat);
  core.position.y = height * 0.05;
  core.renderOrder = 2;
  core.userData = { ...NO_PICK };

  group.add(shell, core);
  paints.push((v) => {
    shellMat.color.set(v.color);
    shellMat.emissive.set(v.emissive);
    shellMat.emissiveIntensity = v.emissiveIntensity * 0.32;
    hdr(coreMat.color, v.emissive, 0.2 + v.emissiveIntensity * 0.55 * glowScale);
  });
  return group;
}

// ---------------------------------------------------------------------------
// Floating island
// ---------------------------------------------------------------------------

function islandShape(seed: number) {
  const rim = (dx: number, dz: number) => 1 + (fbm3(dx * 1.7, 0.3, dz * 1.7, seed + 3, 3) - 0.5) * 0.36;
  const topHeight = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    const dome = 0.05 * (1 - r * r);
    return dome + (fbm3(x * 2.6, 0, z * 2.6, seed, 4) - 0.5) * 0.08;
  };
  return { rim, topHeight };
}

function islandGeometry(seed: number): THREE.BufferGeometry {
  const profile = [
    [0, 0], [0.5, 0], [0.86, 0], [1, -0.01], [0.97, -0.09], [0.87, -0.22], [0.72, -0.4],
    [0.55, -0.6], [0.37, -0.8], [0.2, -0.97], [0.07, -1.1], [0, -1.16],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geometry = new THREE.LatheGeometry(profile, 64);
  const { rim, topHeight } = islandShape(seed);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const topColor = new THREE.Color(1.15, 1.55, 1.7);
  const rimColor = new THREE.Color(1.0, 0.95, 1.35);
  const deepColor = new THREE.Color(0.32, 0.26, 0.5);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r > 1e-6) {
      const k = rim(v.x / r, v.z / r);
      v.x *= k;
      v.z *= k;
    }
    if (v.y > -0.005) {
      v.y = topHeight(v.x, v.z);
      c.copy(topColor).lerp(rimColor, Math.min(1, r * r));
    } else {
      const n = fbm3(v.x * 3.1, v.y * 2.4, v.z * 3.1, seed + 7, 4);
      const k = 1 + (n - 0.5) * 0.45;
      v.x *= k;
      v.z *= k;
      v.y -= Math.max(0, n - 0.52) * 0.55 * (1 + v.y * 0.4);
      const depth = Math.min(1, -v.y / 1.1);
      c.copy(rimColor).lerp(deepColor, Math.pow(depth, 0.7)).multiplyScalar(0.75 + n * 0.5);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const floatingIsland: ArchetypeFactory = (entity) => {
  const seed = hashString(entity.id);
  const rng = createRng(seed);
  const paints: Paint[] = [];
  const body = new THREE.Group();

  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.08, flatShading: true });
  const rock = new THREE.Mesh(islandGeometry(seed), rockMat);
  rock.castShadow = true;
  rock.receiveShadow = true;
  body.add(rock);
  paints.push((v) => {
    rockMat.color.set(v.color);
    rockMat.emissive.set(v.emissive);
    rockMat.emissiveIntensity = v.emissiveIntensity * 0.6;
  });

  // Scattered boulders on the top surface (instanced: one draw call).
  const { topHeight } = islandShape(seed);
  const boulderCount = 26;
  const boulders = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: '#2a2648', roughness: 0.85, flatShading: true }),
    boulderCount,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < boulderCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = 0.25 + Math.sqrt(rng.next()) * 0.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = rng.range(0.012, 0.035);
    q.setFromEuler(e.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)));
    m.compose(new THREE.Vector3(x, topHeight(x, z) + s * 0.4, z), q, new THREE.Vector3(s, s * 0.8, s));
    boulders.setMatrixAt(i, m);
  }
  boulders.castShadow = true;
  boulders.receiveShadow = true;
  body.add(boulders);

  // Glowing crystals hanging from the underside (decorative palette).
  const hanging = rng.int(3, 5);
  const palette: VisualComponent[] = [
    { archetype: '', color: '#8cf0ff', emissive: '#30d8ff', emissiveIntensity: 2.2, visible: true },
    { archetype: '', color: '#c39bff', emissive: '#9a5cff', emissiveIntensity: 2.2, visible: true },
  ];
  for (let i = 0; i < hanging; i++) {
    const local: Paint[] = [];
    const cr = crystal(0.035, rng.range(0.22, 0.42), local, 1.1);
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.05, 0.28);
    cr.position.set(Math.cos(a) * r, -0.62 - (0.28 - r) * 1.4, Math.sin(a) * r);
    cr.rotation.set(Math.PI + rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25));
    body.add(cr);
    const look = palette[i % 2];
    if (look) local.forEach((p) => p(look));
  }

  return make(body, paints);
};

// ---------------------------------------------------------------------------
// Crystals
// ---------------------------------------------------------------------------

const crystalSpire: ArchetypeFactory = (entity) => {
  const rng = createRng(hashString(entity.id));
  const paints: Paint[] = [];
  const body = new THREE.Group();
  body.add(crystal(0.85, 9, paints));
  const sides = rng.int(2, 3);
  for (let i = 0; i < sides; i++) {
    const c = crystal(rng.range(0.32, 0.5), rng.range(2.6, 4.4), paints);
    const a = (i / sides) * Math.PI * 2 + rng.range(0, 1);
    c.position.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
    c.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    body.add(c);
  }
  return make(body, paints);
};

const crystalCluster: ArchetypeFactory = (entity) => {
  const rng = createRng(hashString(entity.id));
  const paints: Paint[] = [];
  const body = new THREE.Group();
  const count = rng.int(5, 7);
  for (let i = 0; i < count; i++) {
    const center = i === 0;
    const c = crystal(center ? 0.42 : rng.range(0.16, 0.3), center ? 3.2 : rng.range(1.0, 2.2), paints);
    if (!center) {
      const a = (i / (count - 1)) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const tilt = rng.range(0.35, 0.75);
      c.position.set(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38);
      c.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    }
    body.add(c);
  }
  return make(body, paints);
};

// ---------------------------------------------------------------------------
// Castle (focal point) — Architectural fantasy citadel
// ---------------------------------------------------------------------------

function castleWallSegment(rng: ReturnType<typeof createRng>, paints: Paint[], stoneMat: THREE.MeshStandardMaterial): THREE.Group {
  const group = new THREE.Group();
  const wallWidth = rng.range(3.5, 5.5);
  const wallHeight = rng.range(4.5, 6.5);
  const wallDepth = 0.8;

  // Main wall block
  const wallGeo = new THREE.BoxGeometry(wallWidth, wallHeight, wallDepth);
  const wall = new THREE.Mesh(wallGeo, stoneMat);
  wall.position.y = wallHeight / 2;
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  // Battlements on top
  const merlonCount = Math.floor(wallWidth / 0.7);
  for (let i = 0; i < merlonCount; i++) {
    const merlonGeo = new THREE.BoxGeometry(0.45, 1.2, 0.9);
    const merlon = new THREE.Mesh(merlonGeo, stoneMat);
    merlon.position.set((i - (merlonCount - 1) / 2) * 0.7, wallHeight + 0.6, 0);
    merlon.castShadow = true;
    group.add(merlon);
  }

  // Arrow slits / windows
  const slitCount = rng.int(2, 4);
  for (let i = 0; i < slitCount; i++) {
    const slitGeo = new THREE.BoxGeometry(0.15, 1.0, 0.9);
    const slitMat = new THREE.MeshBasicMaterial({ color: '#ffb36b', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const slit = new THREE.Mesh(slitGeo, slitMat);
    slit.position.set((i - (slitCount - 1) / 2) * 1.2, wallHeight * 0.4, wallDepth / 2 + 0.01);
    slit.userData = { ...NO_PICK };
    group.add(slit);
    paints.push((v) => {
      slitMat.color.set(v.emissive);
      slitMat.opacity = 0.6 + v.emissiveIntensity * 0.2;
    });
  }

  return group;
}

function castleTower(rng: ReturnType<typeof createRng>, paints: Paint[], stoneMat: THREE.MeshStandardMaterial, trimMat: THREE.LineBasicMaterial, isMain: boolean): THREE.Group {
  const group = new THREE.Group();
  const baseRadius = isMain ? rng.range(3.5, 4.5) : rng.range(1.8, 2.5);
  const height = isMain ? rng.range(18, 24) : rng.range(12, 16);
  const segments = 8;

  // Tower shaft (slightly tapered)
  const towerGeo = new THREE.CylinderGeometry(baseRadius * 0.75, baseRadius, height, segments);
  const tower = new THREE.Mesh(towerGeo, stoneMat);
  tower.position.y = height / 2;
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);

  // Tower edges highlight
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(towerGeo), trimMat);
  edges.userData = { ...NO_PICK };
  tower.add(edges);

  // Battlements at top
  const merlonCount = segments;
  for (let i = 0; i < merlonCount; i++) {
    const a = (i / merlonCount) * Math.PI * 2;
    const merlonGeo = new THREE.BoxGeometry(0.5, 1.4, 0.9);
    const merlon = new THREE.Mesh(merlonGeo, stoneMat);
    merlon.position.set(Math.cos(a) * (baseRadius * 0.75 + 0.25), height + 0.7, Math.sin(a) * (baseRadius * 0.75 + 0.25));
    merlon.rotation.y = a;
    merlon.castShadow = true;
    group.add(merlon);
  }

  // Conical roof
  const roofGeo = new THREE.ConeGeometry(baseRadius * 0.9, baseRadius * 1.3, segments);
  const roofMat = new THREE.MeshStandardMaterial({ color: '#1a1230', roughness: 0.4, metalness: 0.5 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = height + baseRadius * 0.65;
  roof.castShadow = true;
  group.add(roof);

  // Roof trim
  const roofEdges = new THREE.LineSegments(new THREE.EdgesGeometry(roofGeo), trimMat);
  roofEdges.userData = { ...NO_PICK };
  roof.add(roofEdges);

  // Roof finial (crystal accent)
  const finial = crystal(0.35, rng.range(1.5, 2.5), paints, 1.2);
  finial.position.y = height + baseRadius * 1.3 + rng.range(0.5, 1.0);
  group.add(finial);

  // Windows with warm glow
  const floorCount = isMain ? rng.int(5, 7) : rng.int(3, 5);
  for (let f = 0; f < floorCount; f++) {
    const y = (f + 1) / (floorCount + 1) * height;
    const windowCount = isMain ? 4 : 2;
    for (let w = 0; w < windowCount; w++) {
      const a = (w / windowCount) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const windowGeo = new THREE.BoxGeometry(0.5, 0.9, 0.15);
      const windowMat = new THREE.MeshBasicMaterial({ color: '#ffb36b', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
      const windowMesh = new THREE.Mesh(windowGeo, windowMat);
      const r = baseRadius * (0.7 + (f / floorCount) * 0.2);
      windowMesh.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      windowMesh.rotation.y = a;
      windowMesh.userData = { ...NO_PICK };
      group.add(windowMesh);
      paints.push((v) => {
        windowMat.color.set(v.emissive);
        windowMat.opacity = 0.7 + v.emissiveIntensity * 0.25;
      });
    }
  }

  // Decorative crystal accents on tower
  if (rng.next() > 0.5) {
    const accentCount = isMain ? rng.int(2, 4) : rng.int(1, 2);
    for (let i = 0; i < accentCount; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = baseRadius * 0.5;
      const accent = crystal(rng.range(0.2, 0.35), rng.range(1.0, 1.8), paints, 1.1);
      accent.position.set(Math.cos(a) * r, rng.range(height * 0.3, height * 0.8), Math.sin(a) * r);
      group.add(accent);
    }
  }

  return group;
}

function castleGate(paints: Paint[], stoneMat: THREE.MeshStandardMaterial, trimMat: THREE.LineBasicMaterial): THREE.Group {
  const group = new THREE.Group();
  const gateWidth = 5;
  const gateHeight = 7;
  const gateDepth = 2;

  // Gate arch
  const archGeo = new THREE.CylinderGeometry(gateWidth / 2, gateWidth / 2, gateDepth, 16, 1, true, 0, Math.PI);
  const arch = new THREE.Mesh(archGeo, stoneMat);
  arch.position.set(0, gateHeight / 2, 0);
  arch.rotation.z = Math.PI / 2;
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);

  // Arch trim
  const archEdges = new THREE.LineSegments(new THREE.EdgesGeometry(archGeo), trimMat);
  archEdges.userData = { ...NO_PICK };
  arch.add(archEdges);

  // Side towers flanking gate
  for (const side of [-1, 1]) {
    const towerGeo = new THREE.CylinderGeometry(1.8, 2.2, gateHeight + 4, 8);
    const tower = new THREE.Mesh(towerGeo, stoneMat);
    tower.position.set(side * (gateWidth / 2 + 1.8), (gateHeight + 4) / 2, 0);
    tower.castShadow = true;
    tower.receiveShadow = true;
    group.add(tower);

    // Battlements on gate towers
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const merlonGeo = new THREE.BoxGeometry(0.45, 1.2, 0.9);
      const merlon = new THREE.Mesh(merlonGeo, stoneMat);
      merlon.position.set(
        side * (gateWidth / 2 + 1.8) + Math.cos(a) * 1.8,
        gateHeight + 4 + 0.6,
        Math.sin(a) * 1.8
      );
      merlon.rotation.y = a;
      merlon.castShadow = true;
      group.add(merlon);
    }

    // Conical roofs on gate towers
    const roofGeo = new THREE.ConeGeometry(2.0, 3.0, 8);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#1a1230', roughness: 0.4, metalness: 0.5 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(side * (gateWidth / 2 + 1.8), gateHeight + 4 + 1.5, 0);
    roof.castShadow = true;
    group.add(roof);

    // Crystal finials
    const finial = crystal(0.3, 1.5, paints, 1.2);
    finial.position.set(side * (gateWidth / 2 + 1.8), gateHeight + 4 + 3.0, 0);
    group.add(finial);
  }

  // Portcullis suggestion (vertical bars)
  const barCount = 8;
  for (let i = 0; i < barCount; i++) {
    const barGeo = new THREE.BoxGeometry(0.08, gateHeight * 0.85, 0.15);
    const barMat = new THREE.MeshStandardMaterial({ color: '#2a1a35', roughness: 0.3, metalness: 0.7 });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set((i - (barCount - 1) / 2) * (gateWidth / barCount), gateHeight * 0.425, gateDepth / 2);
    group.add(bar);
  }

  // Glowing lanterns beside gate
  for (const side of [-1, 1]) {
    const lantern = crystal(0.2, 0.8, paints, 1.5);
    lantern.position.set(side * (gateWidth / 2 + 2.5), 3.5, gateDepth / 2 + 1.5);
    group.add(lantern);
  }

  return group;
}

function castleBridge(rng: ReturnType<typeof createRng>, stoneMat: THREE.MeshStandardMaterial): THREE.Group {
  const group = new THREE.Group();
  const length = rng.range(8, 12);
  const width = 3.5;
  const height = 0.6;

  // Bridge deck
  const deckGeo = new THREE.BoxGeometry(width, height, length);
  const deck = new THREE.Mesh(deckGeo, stoneMat);
  deck.position.set(0, height / 2, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Railings
  const railingGeo = new THREE.BoxGeometry(0.15, 1.2, length - 0.5);
  const railingMat = new THREE.MeshStandardMaterial({ color: '#1a1230', roughness: 0.5, metalness: 0.4 });
  for (const side of [-1, 1]) {
    const railing = new THREE.Mesh(railingGeo, railingMat);
    railing.position.set(side * (width / 2 + 0.075), height + 0.6, 0);
    railing.castShadow = true;
    group.add(railing);
  }

  // Support arches underneath
  const archCount = Math.floor(length / 2.5);
  for (let i = 0; i < archCount; i++) {
    const z = (i - (archCount - 1) / 2) * (length / archCount);
    const archGeo = new THREE.CylinderGeometry(width / 2 + 0.3, width / 2 + 0.3, 0.4, 12, 1, true, 0, Math.PI);
    const arch = new THREE.Mesh(archGeo, stoneMat);
    arch.position.set(0, -0.2, z);
    arch.rotation.z = Math.PI / 2;
    arch.castShadow = true;
    group.add(arch);
  }

  return group;
}

function castleKeep(rng: ReturnType<typeof createRng>, paints: Paint[], stoneMat: THREE.MeshStandardMaterial, trimMat: THREE.LineBasicMaterial): THREE.Group {
  const group = new THREE.Group();
  const keepWidth = rng.range(10, 14);
  const keepDepth = rng.range(8, 12);
  const keepHeight = rng.range(14, 18);

  // Main keep block
  const keepGeo = new THREE.BoxGeometry(keepWidth, keepHeight, keepDepth);
  const keep = new THREE.Mesh(keepGeo, stoneMat);
  keep.position.y = keepHeight / 2;
  keep.castShadow = true;
  keep.receiveShadow = true;
  group.add(keep);

  // Keep edges
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(keepGeo), trimMat);
  edges.userData = { ...NO_PICK };
  keep.add(edges);

  // Battlements on keep
  const perimeter = 2 * (keepWidth + keepDepth);
  const merlonCount = Math.floor(perimeter / 0.7);
  for (let i = 0; i < merlonCount; i++) {
    const t = i / merlonCount;
    let x, z;
    if (t < keepWidth / perimeter) {
      x = (t * perimeter - keepWidth / 2);
      z = keepDepth / 2;
    } else if (t < (keepWidth + keepDepth) / perimeter) {
      x = keepWidth / 2;
      z = ((t - keepWidth / perimeter) * perimeter - keepDepth / 2);
    } else if (t < (2 * keepWidth + keepDepth) / perimeter) {
      x = keepWidth / 2 - ((t - (keepWidth + keepDepth) / perimeter) * perimeter - keepWidth / 2);
      z = -keepDepth / 2;
    } else {
      x = -keepWidth / 2;
      z = -keepDepth / 2 + ((t - (2 * keepWidth + keepDepth) / perimeter) * perimeter - keepDepth / 2);
    }
    const merlonGeo = new THREE.BoxGeometry(0.5, 1.3, 0.9);
    const merlon = new THREE.Mesh(merlonGeo, stoneMat);
    merlon.position.set(x, keepHeight + 0.65, z);
    merlon.castShadow = true;
    group.add(merlon);
  }

  // Corner towers on keep
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      const tower = castleTower(rng, paints, stoneMat, trimMat, false);
      tower.position.set(cx * (keepWidth / 2 + 1.5), 0, cz * (keepDepth / 2 + 1.5));
      group.add(tower);
    }
  }

  // Windows on keep
  const floorCount = rng.int(4, 5);
  for (let f = 0; f < floorCount; f++) {
    const y = (f + 1) / (floorCount + 1) * keepHeight;
    for (const face of ['front', 'back', 'left', 'right']) {
      const windowCount = rng.int(2, 3);
      for (let w = 0; w < windowCount; w++) {
        let x = 0, z = 0, rotY = 0;
        const offset = (w - (windowCount - 1) / 2) * 2.5;
        if (face === 'front') { x = offset; z = keepDepth / 2 + 0.05; rotY = Math.PI; }
        else if (face === 'back') { x = -offset; z = -keepDepth / 2 - 0.05; rotY = 0; }
        else if (face === 'left') { x = -keepWidth / 2 - 0.05; z = offset; rotY = -Math.PI / 2; }
        else { x = keepWidth / 2 + 0.05; z = -offset; rotY = Math.PI / 2; }
        const windowGeo = new THREE.BoxGeometry(0.8, 1.2, 0.15);
        const windowMat = new THREE.MeshBasicMaterial({ color: '#ffb36b', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
        const windowMesh = new THREE.Mesh(windowGeo, windowMat);
        windowMesh.position.set(x, y, z);
        windowMesh.rotation.y = rotY;
        windowMesh.userData = { ...NO_PICK };
        group.add(windowMesh);
        paints.push((v) => {
          windowMat.color.set(v.emissive);
          windowMat.opacity = 0.7 + v.emissiveIntensity * 0.25;
        });
      }
    }
  }

  // Central spire on keep roof
  const spire = castleTower(rng, paints, stoneMat, trimMat, true);
  spire.position.y = keepHeight;
  group.add(spire);

  return group;
}

const castle: ArchetypeFactory = (entity) => {
  const rng = createRng(hashString(entity.id));
  const paints: Paint[] = [];

  // Warm stone for castle, cool trim for dusk contrast
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#1e1830', roughness: 0.5, metalness: 0.3 });
  const trimMat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  paints.push((v) => hdr(trimMat.color, v.emissive, 0.45 + v.emissiveIntensity * 0.75));

  const body = new THREE.Group();

  // Main keep (central palace)
  const keep = castleKeep(rng, paints, stoneMat, trimMat);
  body.add(keep);

  // Compute keep height from bounding box for spire placement
  const keepBox = new THREE.Box3().setFromObject(keep);
  const keepHeight = keepBox.max.y - keepBox.min.y;

  // Curtain walls connecting to corner towers
  const wallRadius = rng.range(16, 20);
  const wallCount = rng.int(6, 8);
  for (let i = 0; i < wallCount; i++) {
    const a = (i / wallCount) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const wall = castleWallSegment(rng, paints, stoneMat);
    wall.position.set(Math.cos(a) * wallRadius, 0, Math.sin(a) * wallRadius);
    wall.rotation.y = a + Math.PI / 2;
    body.add(wall);
  }

  // Corner towers on walls
  const towerCount = wallCount;
  for (let i = 0; i < towerCount; i++) {
    const a = (i / towerCount) * Math.PI * 2;
    const r = wallRadius + rng.range(1.5, 3.0);
    const tower = castleTower(rng, paints, stoneMat, trimMat, false);
    tower.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    body.add(tower);
  }

  // Grand gate complex
  const gateAngle = rng.range(0, Math.PI * 2);
  const gate = castleGate(paints, stoneMat, trimMat);
  gate.position.set(Math.cos(gateAngle) * (wallRadius - 1), 0, Math.sin(gateAngle) * (wallRadius - 1));
  gate.rotation.y = gateAngle + Math.PI;
  body.add(gate);

  // Bridge from gate to inner ward
  const bridge = castleBridge(rng, stoneMat);
  bridge.position.set(Math.cos(gateAngle) * (wallRadius / 2), 0.5, Math.sin(gateAngle) * (wallRadius / 2));
  bridge.rotation.y = gateAngle + Math.PI;
  body.add(bridge);

  // Inner ward buildings (smaller structures)
  const buildingCount = rng.int(3, 5);
  for (let i = 0; i < buildingCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(wallRadius * 0.2, wallRadius * 0.5);
    const bGeo = new THREE.BoxGeometry(rng.range(3, 5), rng.range(4, 7), rng.range(3, 5));
    const building = new THREE.Mesh(bGeo, stoneMat);
    building.position.set(Math.cos(a) * r, bGeo.parameters.height / 2, Math.sin(a) * r);
    building.rotation.y = rng.range(0, Math.PI * 2);
    building.castShadow = true;
    building.receiveShadow = true;
    body.add(building);

    // Roof
    const roofGeo = new THREE.ConeGeometry(Math.max(bGeo.parameters.width, bGeo.parameters.depth) / 2 * 1.2, 2.5, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#1a1230', roughness: 0.4, metalness: 0.5 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(building.position.x, building.position.y + bGeo.parameters.height / 2 + 1.25, building.position.z);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    building.add(roof);

    // Windows
    for (let f = 0; f < 2; f++) {
      const y = (f + 1) / 3 * bGeo.parameters.height;
      const windowGeo = new THREE.BoxGeometry(0.6, 0.9, 0.1);
      const windowMat = new THREE.MeshBasicMaterial({ color: '#ffb36b', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
      const windowMesh = new THREE.Mesh(windowGeo, windowMat);
      windowMesh.position.set(0, y, bGeo.parameters.depth / 2 + 0.05);
      windowMesh.userData = { ...NO_PICK };
      building.add(windowMesh);
      paints.push((v) => {
        windowMat.color.set(v.emissive);
        windowMat.opacity = 0.7 + v.emissiveIntensity * 0.25;
      });
    }
  }

  // Central spire with crystal crown (the magical heart)
  const spireBase = keepHeight + 2;
  const mainSpire = crystal(2.0, 22, paints, 1.3);
  mainSpire.position.y = spireBase;
  body.add(mainSpire);

  // Guardian spires around central spire
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const g = crystal(0.9, rng.range(10, 13), paints);
    g.position.set(Math.cos(a) * 3.5, spireBase - 0.5, Math.sin(a) * 3.5);
    g.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    body.add(g);
  }

  // Floating crown crystal
  const crownPivot = new THREE.Group();
  const crownHeight = spireBase + 24;
  crownPivot.position.y = crownHeight;
  const crownShellMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.8, depthWrite: false });
  const crown = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), crownShellMat);
  crown.scale.y = 2.0;
  const crownCoreMat = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const crownCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), crownCoreMat);
  crownCore.scale.y = 2.0;
  crownCore.userData = { ...NO_PICK };
  crownPivot.add(crown, crownCore);
  body.add(crownPivot);
  paints.push((v) => {
    crownShellMat.color.set(v.color);
    crownShellMat.emissive.set(v.emissive);
    crownShellMat.emissiveIntensity = v.emissiveIntensity * 0.5;
    hdr(crownCoreMat.color, v.emissive, 0.65 + v.emissiveIntensity * 1.1);
  });

  // Skyward beam
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uStrength: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 0.5, 110, 32, 1, true), beamMat);
  beam.position.y = crownHeight + 55;
  beam.userData = { ...NO_PICK };
  body.add(beam);
  paints.push((v) => {
    (beamMat.uniforms.uColor!.value as THREE.Color).set(v.emissive);
    beamMat.uniforms.uStrength!.value = 0.035 + v.emissiveIntensity * 0.035;
  });

  // Internal warm glow light
  const glow = new THREE.PointLight('#ffb36b', 160, 60, 2);
  glow.position.y = spireBase + 12;
  body.add(glow);
  paints.push((v) => {
    glow.color.set(v.emissive);
    glow.intensity = 65 * v.emissiveIntensity;
  });

  return make(body, paints, {
    tick: (t) => {
      crownPivot.rotation.y = t * 0.35;
      crownPivot.position.y = crownHeight + Math.sin(t * 0.8) * 0.55;
      beamMat.uniforms.uTime!.value = t;
    },
    lightAnchor: body,
  });
};

const arcaneRing: ArchetypeFactory = () => {
  const paints: Paint[] = [];
  const body = new THREE.Group();
  const innerMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const outerMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const inner = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.075, 8, 180), innerMat);
  const outerPivot = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.TorusGeometry(6.1, 0.035, 6, 200), outerMat);
  outer.rotation.x = Math.PI / 2;
  inner.rotation.x = Math.PI / 2;

  const runeCount = 28;
  const runes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.5, 0.05), outerMat, runeCount);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < runeCount; i++) {
    const a = (i / runeCount) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(new THREE.Vector3(Math.cos(a) * 6.1, 0, Math.sin(a) * 6.1), q, new THREE.Vector3(1, i % 3 === 0 ? 1.6 : 1, 1));
    runes.setMatrixAt(i, m);
  }
  outerPivot.add(outer, runes);
  body.add(inner, outerPivot);
  paints.push((v) => {
    hdr(innerMat.color, v.emissive, 0.4 + v.emissiveIntensity * 0.65);
    hdr(outerMat.color, v.color, 0.25 + v.emissiveIntensity * 0.35);
  });
  return make(body, paints, {
    tick: (t) => {
      inner.rotation.z = t * 0.25;
      outerPivot.rotation.y = -t * 0.12;
    },
  });
};

// ---------------------------------------------------------------------------
// Lights and monuments
// ---------------------------------------------------------------------------

const lightOrb: ArchetypeFactory = (entity) => {
  const phase = (hashString(entity.id) % 1000) / 159;
  const paints: Paint[] = [];
  const body = new THREE.Group();
  const bob = new THREE.Group();
  body.add(bob);

  const coreMat = new THREE.MeshBasicMaterial();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), coreMat);
  const cageMat = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), cageMat);
  const haloMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(5.5);
  halo.userData = { ...NO_PICK };
  bob.add(core, cage, halo);
  paints.push((v) => {
    hdr(coreMat.color, v.emissive, 0.6 + v.emissiveIntensity * 0.6);
    hdr(cageMat.color, v.color, 0.4 + v.emissiveIntensity * 0.25);
    haloMat.color.set(v.emissive);
    haloMat.opacity = Math.min(0.95, 0.15 + v.emissiveIntensity * 0.12);
  });
  return make(body, paints, {
    lightAnchor: bob,
    tick: (t) => {
      bob.position.y = Math.sin(t * 0.8 + phase) * 0.7;
      cage.rotation.set(t * 0.3 + phase, t * 0.45, 0);
    },
  });
};

const obelisk: ArchetypeFactory = (entity) => {
  const seed = hashString(entity.id);
  const paints: Paint[] = [];
  const body = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.65, flatShading: true });
  const geo = new THREE.CylinderGeometry(0.55, 1.45, 15, 4);
  const shaft = new THREE.Mesh(geo, stoneMat);
  shaft.position.y = 7.5;
  shaft.rotation.y = Math.PI / 4;
  shaft.castShadow = true;
  const edgeMat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
  edges.userData = { ...NO_PICK };
  shaft.add(edges);
  body.add(shaft);

  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#2b2650', roughness: 0.95, flatShading: true });
  const rock = new THREE.Mesh(islandGeometry(seed), rockMat);
  rock.scale.set(3.4, 2.6, 3.4);
  rock.position.y = 0.1;
  rock.castShadow = true;
  body.add(rock);

  const capPivot = new THREE.Group();
  capPivot.position.y = 17.2;
  capPivot.add(crystal(0.45, 1.6, paints, 1.3));
  body.add(capPivot);

  paints.push((v) => {
    stoneMat.color.set(v.color);
    hdr(edgeMat.color, v.emissive, 0.4 + v.emissiveIntensity * 0.9);
  });
  return make(body, paints, {
    tick: (t) => {
      capPivot.rotation.y = t * 0.6;
      capPivot.position.y = 17.2 + Math.sin(t * 1.1 + seed) * 0.25;
    },
  });
};

/** Used for unknown archetypes so new world types never crash the renderer. */
const fallback: ArchetypeFactory = () => {
  const paints: Paint[] = [];
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.4 });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), mat);
  mesh.position.y = 1;
  mesh.castShadow = true;
  paints.push((v) => {
    mat.color.set(v.color);
    mat.emissive.set(v.emissive);
    mat.emissiveIntensity = v.emissiveIntensity * 0.4;
  });
  return make(mesh, paints);
};

export const ARCHETYPES: Readonly<Record<string, ArchetypeFactory>> = {
  floatingIsland,
  crystalSpire,
  crystalCluster,
  crystalCitadel: castle,
  castle,
  arcaneRing,
  lightOrb,
  obelisk,
};

export function createArchetype(entity: Entity): ArchetypeInstance {
  const key = entity.components.visual?.archetype ?? '';
  return (ARCHETYPES[key] ?? fallback)(entity);
}
