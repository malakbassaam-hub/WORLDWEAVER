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
export const FOG_COLOR = new THREE.Color('#1a0f2e');
export const FOG_DENSITY = 0.0045;
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

  const sunDir = new THREE.Vector3(-0.55, 0.08, -0.83).normalize();
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
  group.add(mountainRing(400, 22, 85, '#0f0a1e', seed + 11, 200));
  group.add(mountainRing(300, 8, 55, '#0c0818', seed + 29, 180));

  // --- Sea -----------------------------------------------------------------
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sunDir },
      uFogColor: { value: FOG_COLOR },
      uFogDensity: { value: FOG_DENSITY },
      uDeep: { value: new THREE.Color('#04030a') },
      uGlow: { value: new THREE.Color('#1a7fff') },
    },
    fog: false,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800, 1, 1), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA_LEVEL;
  water.name = 'sea';
  group.add(water);
  track(waterMaterial);

  // --- Low mist beneath the isles ----------------------------------------
  const mist = new THREE.Group();
  mist.name = 'mist';
  const mistTex = mistTexture();
  for (let i = 0; i < 36; i++) {
    const material = new THREE.SpriteMaterial({
      map: mistTex,
      color: rng.pick(['#5a4cff', '#7a5cff', '#3ab6ff', '#a06bff']),
      transparent: true,
      opacity: rng.range(0.04, 0.1),
      depthWrite: false,
      fog: true,
    });
    const sprite = new THREE.Sprite(material);
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(10, 160);
    sprite.position.set(Math.cos(angle) * radius, rng.range(SEA_LEVEL + 3, SEA_LEVEL + 12), Math.sin(angle) * radius);
    const s = rng.range(50, 130);
    sprite.scale.set(s, s * 0.4, 1);
    mist.add(sprite);
  }
  group.add(mist);

  // --- Drifting luminous motes -------------------------------------------
  const moteCount = 1200;
  const positions = new Float32Array(moteCount * 3);
  const colors = new Float32Array(moteCount * 3);
  const seeds = new Float32Array(moteCount);
  const warmCyan = new THREE.Color('#5ae8ff').multiplyScalar(1.4);
  const warmViolet = new THREE.Color('#b88aff').multiplyScalar(1.4);
  const warmGold = new THREE.Color('#ffd47a').multiplyScalar(1.2);
  for (let i = 0; i < moteCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 85;
    const y = rng.range(-15, 45);
    positions.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    const pick = rng.next();
    const c = pick > 0.6 ? warmCyan : (pick > 0.3 ? warmViolet : warmGold);
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

  // --- Atmospheric fog layer ----------------------------------------------
  const fogLayer = new THREE.Group();
  fogLayer.name = 'fog-layer';
  const fogTex = mistTexture();
  for (let i = 0; i < 18; i++) {
    const material = new THREE.SpriteMaterial({
      map: fogTex,
      color: rng.pick(['#2a1f4a', '#1f2a4a', '#2a2f4a']),
      transparent: true,
      opacity: rng.range(0.02, 0.06),
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(60, 220);
    sprite.position.set(Math.cos(angle) * radius, rng.range(-5, 25), Math.sin(angle) * radius);
    const s = rng.range(120, 280);
    sprite.scale.set(s, s * 0.3, 1);
    fogLayer.add(sprite);
  }
  group.add(fogLayer);

  // --- Lights ------------------------------------------------------------
  const hemi = new THREE.HemisphereLight('#5a6cff', '#06081a', 0.65);
  group.add(hemi);

  const keyLight = new THREE.DirectionalLight('#ffb36b', 2.4);
  keyLight.position.copy(new THREE.Vector3(-0.55, 0.25, -0.8).normalize().multiplyScalar(160));
  keyLight.target.position.set(0, 8, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const sc = keyLight.shadow.camera;
  sc.left = -55;
  sc.right = 55;
  sc.top = 40;
  sc.bottom = -40;
  sc.near = 20;
  sc.far = 350;
  keyLight.shadow.bias = -0.0003;
  keyLight.shadow.normalBias = 0.4;
  group.add(keyLight, keyLight.target);

  const moonLight = new THREE.DirectionalLight('#8fbaff', 0.55);
  moonLight.position.copy(moonDir.clone().multiplyScalar(160));
  group.add(moonLight);

  // Subtle fill light for shadow detail
  const fillLight = new THREE.DirectionalLight('#4080ff', 0.35);
  fillLight.position.set(60, 40, 60);
  group.add(fillLight);

  return {
    group,
    keyLight,
    update(time, camera) {
      for (const u of timed) u.value = time;
      sky.position.copy(camera.position);
      mist.rotation.y = time * 0.003;
      fogLayer.rotation.y = time * 0.0015;
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
