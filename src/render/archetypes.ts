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

function crystalGeometry(radius: number, height: number, sides = 6): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0, -height * 0.1),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius * 0.88, height * 0.7),
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
    roughness: 0.12,
    metalness: 0.25,
    transparent: true,
    opacity: 0.74,
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

  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05, flatShading: true });
  const rock = new THREE.Mesh(islandGeometry(seed), rockMat);
  rock.castShadow = true;
  rock.receiveShadow = true;
  body.add(rock);
  paints.push((v) => {
    rockMat.color.set(v.color);
    rockMat.emissive.set(v.emissive);
    rockMat.emissiveIntensity = v.emissiveIntensity;
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
// Citadel (focal point)
// ---------------------------------------------------------------------------

const crystalCitadel: ArchetypeFactory = (entity) => {
  const rng = createRng(hashString(entity.id));
  const paints: Paint[] = [];
  const body = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: '#1c1934', roughness: 0.42, metalness: 0.55 });
  const trimMat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  paints.push((v) => hdr(trimMat.color, v.emissive, 0.6 + v.emissiveIntensity * 0.9));

  const tiers: Array<[number, number, number, number]> = [
    // radiusTop, radiusBottom, height, y
    [6.4, 7.2, 0.9, 0.2],
    [4.9, 5.6, 0.8, 1.05],
    [3.3, 3.9, 0.7, 1.8],
  ];
  for (const [rt, rb, h, y] of tiers) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, 6);
    const tier = new THREE.Mesh(geo, stoneMat);
    tier.position.y = y + h / 2 - 0.2;
    tier.castShadow = true;
    tier.receiveShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), trimMat);
    edges.userData = { ...NO_PICK };
    tier.add(edges);
    body.add(tier);
  }

  // Lantern pillars on the lowest tier.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 6), stoneMat);
    pillar.position.set(Math.cos(a) * 6.0, 2.2, Math.sin(a) * 6.0);
    pillar.castShadow = true;
    body.add(pillar);
    const tip = crystal(0.24, 1.1, paints, 1.2);
    tip.position.set(pillar.position.x, 3.5, pillar.position.z);
    body.add(tip);
  }

  // Central spire and four guardians.
  const spireBase = 2.3;
  const main = crystal(1.7, 17, paints, 1.15);
  main.position.y = spireBase;
  body.add(main);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const g = crystal(0.75, rng.range(7.5, 9.5), paints);
    g.position.set(Math.cos(a) * 2.7, spireBase - 0.2, Math.sin(a) * 2.7);
    g.rotation.set(Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16);
    body.add(g);
  }

  // Floating crown crystal above the spire.
  const crownPivot = new THREE.Group();
  crownPivot.position.y = 22.6;
  const crownShellMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.8, depthWrite: false });
  const crown = new THREE.Mesh(new THREE.OctahedronGeometry(1.25, 0), crownShellMat);
  crown.scale.y = 1.6;
  const crownCoreMat = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const crownCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crownCoreMat);
  crownCore.scale.y = 1.6;
  crownCore.userData = { ...NO_PICK };
  crownPivot.add(crown, crownCore);
  body.add(crownPivot);
  paints.push((v) => {
    crownShellMat.color.set(v.color);
    crownShellMat.emissive.set(v.emissive);
    crownShellMat.emissiveIntensity = v.emissiveIntensity * 0.5;
    hdr(crownCoreMat.color, v.emissive, 0.6 + v.emissiveIntensity * 1.1);
  });

  // Skyward beam of light.
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uStrength: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.5, 90, 32, 1, true), beamMat);
  beam.position.y = 22.6 + 45;
  beam.userData = { ...NO_PICK };
  body.add(beam);
  paints.push((v) => {
    (beamMat.uniforms.uColor!.value as THREE.Color).set(v.emissive);
    beamMat.uniforms.uStrength!.value = 0.03 + v.emissiveIntensity * 0.03;
  });

  // Internal light that makes the citadel illuminate its island.
  const glow = new THREE.PointLight('#40e0ff', 120, 46, 2);
  glow.position.y = 9;
  body.add(glow);
  paints.push((v) => {
    glow.color.set(v.emissive);
    glow.intensity = 50 * v.emissiveIntensity;
  });

  return make(body, paints, {
    tick: (t) => {
      crownPivot.rotation.y = t * 0.45;
      crownPivot.position.y = 22.6 + Math.sin(t * 0.9) * 0.45;
      beamMat.uniforms.uTime!.value = t;
    },
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
  crystalCitadel,
  arcaneRing,
  lightOrb,
  obelisk,
};

export function createArchetype(entity: Entity): ArchetypeInstance {
  const key = entity.components.visual?.archetype ?? '';
  return (ARCHETYPES[key] ?? fallback)(entity);
}
