import * as THREE from 'three';
import { createRng } from '../core/random';
import { fbm3 } from './noise';
import { mistTexture } from './textures';
import {
  MOTES_FRAGMENT,
  MOTES_VERTEX,
  SKY_FRAGMENT,
  SKY_VERTEX,
  WATER_FRAGMENT,
  WATER_VERTEX,
} from './shaders';

/**
 * Static "Luminous Night" dusk environment: sky, horizon, sea, mist, motes
 * and global lights. This is presentation, not world state; entities live in
 * the World and are built by archetypes.
 */
export const FOG_COLOR = new THREE.Color('#1d1236');
export const FOG_DENSITY = 0.0055;
export const SEA_LEVEL = -17;

export interface Environment {
  readonly group: THREE.Group;
  readonly keyLight: THREE.DirectionalLight;
  update(time: number, camera: THREE.Camera): void;
  setShadows(enabled: boolean): void;
  setPixelRatio(ratio: number): void;
  dispose(): void;
}

export function createEnvironment(seed: number): Environment {
  const group = new THREE.Group();
  group.name = 'environment';
  const rng = createRng(seed ^ 0x5eed);

  const sunDir = new THREE.Vector3(-0.66, 0.035, -0.75).normalize();
  const moonDir = new THREE.Vector3(0.45, 0.62, 0.35).normalize();
  const timed: THREE.IUniform<number>[] = [];
  const track = (material: THREE.ShaderMaterial) => {
    const u = material.uniforms.uTime;
    if (u) timed.push(u as THREE.IUniform<number>);
  };

  // --- Sky ---------------------------------------------------------------
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uSunDir: { value: sunDir },
      uMoonDir: { value: moonDir },
      uTime: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMaterial);
  sky.name = 'sky';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);
  track(skyMaterial);

  // --- Distant mountain silhouettes -------------------------------------
  group.add(mountainRing(330, 18, 70, '#120d26', seed + 11, 180));
  group.add(mountainRing(250, 4, 46, '#0d0a1d', seed + 29, 160));

  // --- Sea -----------------------------------------------------------------
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sunDir },
      uFogColor: { value: FOG_COLOR },
      uFogDensity: { value: FOG_DENSITY },
      uDeep: { value: new THREE.Color('#05040f') },
      uGlow: { value: new THREE.Color('#1d8fff') },
    },
    fog: false,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 1, 1), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA_LEVEL;
  water.name = 'sea';
  group.add(water);
  track(waterMaterial);

  // --- Low mist beneath the isles ----------------------------------------
  const mist = new THREE.Group();
  mist.name = 'mist';
  const mistTex = mistTexture();
  for (let i = 0; i < 28; i++) {
    const material = new THREE.SpriteMaterial({
      map: mistTex,
      color: rng.pick(['#6d5cff', '#8a6cff', '#3fb6ff', '#b07bff']),
      transparent: true,
      opacity: rng.range(0.05, 0.12),
      depthWrite: false,
      fog: true,
    });
    const sprite = new THREE.Sprite(material);
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(8, 130);
    sprite.position.set(Math.cos(angle) * radius, rng.range(SEA_LEVEL + 2, SEA_LEVEL + 9), Math.sin(angle) * radius);
    const s = rng.range(45, 110);
    sprite.scale.set(s, s * 0.45, 1);
    mist.add(sprite);
  }
  group.add(mist);

  // --- Drifting luminous motes -------------------------------------------
  const moteCount = 900;
  const positions = new Float32Array(moteCount * 3);
  const colors = new Float32Array(moteCount * 3);
  const seeds = new Float32Array(moteCount);
  const cyan = new THREE.Color('#40e0ff').multiplyScalar(1.6);
  const violet = new THREE.Color('#9b6bff').multiplyScalar(1.6);
  for (let i = 0; i < moteCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 75;
    positions.set([Math.cos(a) * r, rng.range(-12, 38), Math.sin(a) * r], i * 3);
    const c = rng.next() > 0.45 ? cyan : violet;
    colors.set([c.r, c.g, c.b], i * 3);
    seeds[i] = rng.next();
  }
  const motesGeometry = new THREE.BufferGeometry();
  motesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  motesGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  motesGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const motesMaterial = new THREE.ShaderMaterial({
    vertexShader: MOTES_VERTEX,
    fragmentShader: MOTES_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(motesGeometry, motesMaterial);
  motes.name = 'motes';
  motes.frustumCulled = false;
  group.add(motes);
  track(motesMaterial);

  // --- Lights ------------------------------------------------------------
  const hemi = new THREE.HemisphereLight('#4a5dff', '#080c26', 0.85);
  group.add(hemi);

  const keyLight = new THREE.DirectionalLight('#ffa855', 2.6);
  keyLight.position.copy(new THREE.Vector3(-0.66, 0.3, -0.75).normalize().multiplyScalar(140));
  keyLight.target.position.set(0, 0, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const sc = keyLight.shadow.camera;
  sc.left = -60;
  sc.right = 60;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 20;
  sc.far = 320;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.5;
  group.add(keyLight, keyLight.target);

  const moonLight = new THREE.DirectionalLight('#8fbaff', 0.65);
  moonLight.position.copy(moonDir.clone().multiplyScalar(140));
  group.add(moonLight);

  return {
    group,
    keyLight,
    update(time, camera) {
      for (const u of timed) u.value = time;
      sky.position.copy(camera.position);
      mist.rotation.y = time * 0.004;
    },
    setShadows(enabled) {
      keyLight.castShadow = enabled;
    },
    setPixelRatio(ratio) {
      motesMaterial.uniforms.uPixelRatio!.value = ratio;
    },
    dispose() {
      group.traverse((obj) => disposeObject(obj));
    },
  };
}

function mountainRing(radius: number, baseHeight: number, peak: number, color: string, seed: number, segments: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    const n = fbm3(x * 2.2, z * 2.2, 0.5, seed, 5);
    const ridge = Math.pow(n, 2.2);
    const top = baseHeight + ridge * peak;
    const r = radius * (0.94 + 0.12 * fbm3(x * 4, z * 4, 3.1, seed + 3, 2));
    positions.push(x * r, SEA_LEVEL - 4, z * r, x * r, SEA_LEVEL + top, z * r);
    if (i < segments) {
      const b = i * 2;
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true }));
  mesh.name = 'mountains';
  return mesh;
}

/** Disposes geometry, materials and non-shared textures of a single object. */
export function disposeObject(obj: THREE.Object3D): void {
  if ((obj as THREE.Light).isLight) {
    (obj as THREE.Light).dispose();
    return;
  }
  const mesh = obj as THREE.Mesh;
  // Sprites share one module-level geometry inside three.js; never dispose it.
  if (mesh.geometry && !(obj as THREE.Sprite).isSprite) mesh.geometry.dispose();
  const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
  if (!material) return;
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    for (const value of Object.values(m)) {
      if (value instanceof THREE.Texture && !value.userData.shared) value.dispose();
    }
    m.dispose();
  }
}
