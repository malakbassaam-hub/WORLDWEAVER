import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Entity, EntityId, VisualComponent, World } from '../core/types';
import { createArchetype, type ArchetypeInstance } from './archetypes';
import { createEnvironment, disposeObject, FOG_COLOR, FOG_DENSITY, type Environment } from './environment';
import { disposeSharedTextures } from './textures';

export type QualityMode = 'cinematic' | 'performance';

import type { WorldTransition } from '../core/presentation';
import type { FuturePreview } from './future-preview';

interface MorphTween {
  readonly id: EntityId;
  readonly binding: Binding;
  readonly fromPos: THREE.Vector3;
  readonly toPos: THREE.Vector3;
  readonly start: number;
  readonly duration: number;
}

interface FutureTween {
  readonly id: EntityId;
  readonly binding: Binding;
  readonly fromPos: THREE.Vector3;
  readonly toPos: THREE.Vector3;
  readonly start: number;
  readonly duration: number;
}

export interface RendererCallbacks {
  onSelect(id: EntityId | null): void;
  onHover?(id: EntityId | null, clientX: number, clientY: number): void;
  onContextLost?(): void;
  onContextRestored?(): void;
}

export interface RenderStats {
  readonly fps: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly entities: number;
}

export class WebGLUnavailableError extends Error {
  override readonly name = 'WebGLUnavailableError';
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

interface Binding {
  entity: Entity;
  readonly root: THREE.Group;
  readonly instance: ArchetypeInstance;
  light: THREE.PointLight | null;
}

interface CameraTween {
  readonly fromPos: THREE.Vector3;
  readonly toPos: THREE.Vector3;
  readonly fromTarget: THREE.Vector3;
  readonly toTarget: THREE.Vector3;
  readonly start: number;
  readonly duration: number;
}

const HOME_TARGET = new THREE.Vector3(0, 9, 0);
const HOME_POSITION = new THREE.Vector3(46, 19, 52);
const INTRO_POSITION = new THREE.Vector3(118, 52, 132);
const CLICK_TOLERANCE_PX = 5;

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * Renders a World with three.js. The renderer is a pure observer of world
 * state: it never mutates the World and reports user intent (selection) via
 * callbacks. Presentation-only animation never feeds back into state.
 */
export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private environment: Environment;
  private readonly entityRoot = new THREE.Group();
  private readonly bindings = new Map<string, Binding>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private marker: THREE.Group;
  private readonly markerMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly timer = new THREE.Timer();
  private composer: EffectComposer | null = null;
  private quality: QualityMode = 'cinematic';
  private selectedId: EntityId | null = null;
  private hoveredId: EntityId | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private pendingHover: { x: number; y: number } | null = null;
  private tween: CameraTween | null = null;
  private fps = 60;
  private disposed = false;
  private contextLost = false;
  /** Last committed world snapshot, used to rebuild the scene after context restore. */
  private lastWorld: World | null = null;
  /** Canvas element owned by the renderer; exposed so the shell can re-attach it after a fallback. */
  public readonly domElement: HTMLCanvasElement;

  /** World Morph transition state (renderer side, Kilo Code). */
  private morphTweens = new Map<EntityId, MorphTween>();
  private morphStartTime = 0;
  private morphDuration = 0;
  private morphCancelled = false;

  /** Parallel Futures preview state (renderer side, Kilo Code). */
  private futureTweens = new Map<EntityId, FutureTween>();
  private futureStartTime = 0;
  private futureDuration = 0;
  private futureCancelled = false;
  private futureBaseline: World | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: RendererCallbacks,
    private readonly seed: number,
  ) {
    if (!isWebGLAvailable()) {
      throw new WebGLUnavailableError('WebGL 2 is not available in this browser or has been disabled.');
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    } catch (error) {
      throw new WebGLUnavailableError(`Could not create a WebGL context: ${(error as Error).message}`);
    }
    this.renderer = renderer;
    this.domElement = renderer.domElement;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was removed in three r0.18x; PCF is the supported soft-edged option.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    renderer.domElement.className = 'ww-canvas';
    renderer.domElement.setAttribute('aria-label', 'WORLDWEAVER 3D viewport');
    container.appendChild(renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1400);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY);
    this.scene.background = FOG_COLOR.clone();

    this.environment = createEnvironment(seed);
    this.scene.add(this.environment.group);
    this.entityRoot.name = 'entities';
    this.scene.add(this.entityRoot);
    this.marker = this.createMarker();
    this.scene.add(this.marker);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 190;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.screenSpacePanning = true;
    this.controls.target.copy(HOME_TARGET);
    this.controls.addEventListener('start', this.cancelTween);

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.camera.position.copy(reducedMotion ? HOME_POSITION : INTRO_POSITION);
    this.camera.lookAt(HOME_TARGET);
    if (!reducedMotion) this.flyTo(HOME_POSITION, HOME_TARGET, 3.4);

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.setQuality('cinematic');
    renderer.setAnimationLoop(this.frame);
  }

  // ---------------------------------------------------------------- public API

  /** Reconciles the scene with a world snapshot. Cheap for unchanged entities. */
  sync(world: World): void {
    this.lastWorld = world;
    const seen = new Set<string>();
    for (const id of world.order) {
      const entity = world.entities[id];
      if (!entity) continue;
      seen.add(id);
      let binding = this.bindings.get(id);
      if (!binding) {
        binding = this.createBinding(entity);
        this.bindings.set(id, binding);
        this.applyEntity(binding, entity, true);
      } else if (binding.entity !== entity) {
        this.applyEntity(binding, entity, false);
      }
      const parent = (entity.parentId && this.bindings.get(entity.parentId)?.root) || this.entityRoot;
      if (binding.root.parent !== parent) parent.add(binding.root);
    }
    for (const [id, binding] of this.bindings) {
      if (!seen.has(id)) {
        this.destroyBinding(binding);
        this.bindings.delete(id);
      }
    }
    if (this.selectedId && !this.bindings.has(this.selectedId)) this.selectedId = null;
    this.refreshMarker();
  }

  setSelection(id: EntityId | null): void {
    this.selectedId = id && this.bindings.has(id) ? id : null;
    this.refreshMarker();
  }

  /** Temporarily shows a visual without changing world state (e.g. while dragging a slider). */
  previewVisual(id: EntityId, visual: VisualComponent): void {
    this.bindings.get(id)?.instance.applyVisual(visual);
  }

  /** Restores the committed visual after a cancelled or rejected preview. */
  revertPreview(id: EntityId): void {
    const binding = this.bindings.get(id);
    const visual = binding?.entity.components.visual;
    if (binding && visual) binding.instance.applyVisual(visual);
  }

  focus(id: EntityId): void {
    const binding = this.bindings.get(id);
    if (!binding) return;
    const box = this.entityBounds(binding);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = THREE.MathUtils.clamp(sphere.radius * 2.8, 10, 130);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (direction.y < 0.15) direction.setY(0.15).normalize();
    this.flyTo(sphere.center.clone().addScaledVector(direction, distance), sphere.center, 1.1);
  }

  resetCamera(): void {
    this.flyTo(HOME_POSITION, HOME_TARGET, 1.4);
  }

  setQuality(mode: QualityMode): void {
    this.quality = mode;
    const ratio = mode === 'cinematic' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
    this.renderer.setPixelRatio(ratio);
    this.environment.setPixelRatio(ratio);
    this.environment.setShadows(mode === 'cinematic');
    if (mode === 'cinematic' && !this.composer) this.composer = this.buildComposer();
    if (mode === 'performance' && this.composer) {
      this.disposeComposer(this.composer);
      this.composer = null;
    }
    this.resize();
  }

  getQuality(): QualityMode {
    return this.quality;
  }

  getStats(): RenderStats {
    return {
      fps: Math.round(this.fps),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      entities: this.bindings.size,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTransition();
    this.cancelFuture();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.removeEventListener('start', this.cancelTween);
    this.controls.dispose();
    for (const binding of this.bindings.values()) this.destroyBinding(binding);
    this.bindings.clear();
    this.environment.dispose();
    this.marker.traverse(disposeObject);
    if (this.composer) this.disposeComposer(this.composer);
    disposeSharedTextures();
    this.renderer.dispose();
    canvas.remove();
  }

  // ---------------------------------------------------------------- bindings

  private createBinding(entity: Entity): Binding {
    const root = new THREE.Group();
    root.name = entity.name;
    root.userData.entityId = entity.id;
    const instance = createArchetype(entity);
    root.add(instance.body);
    return { entity, root, instance, light: null };
  }

  private applyEntity(binding: Binding, entity: Entity, initial: boolean): void {
    const { transform, visual, light } = entity.components;
    binding.root.position.set(...transform.position);
    binding.root.rotation.set(...transform.rotation);
    binding.instance.body.scale.set(...transform.scale);
    binding.root.name = entity.name;
    if (visual && (initial || visual !== binding.entity.components.visual)) {
      binding.instance.applyVisual(visual);
    }
    binding.root.visible = visual ? visual.visible : true;

    if (light && !binding.light) {
      binding.light = new THREE.PointLight(light.color, light.intensity, light.range, 2);
      (binding.instance.lightAnchor ?? binding.root).add(binding.light);
    } else if (!light && binding.light) {
      binding.light.removeFromParent();
      binding.light.dispose();
      binding.light = null;
    }
    if (light && binding.light) {
      // Presentation rule: a light is tinted by the entity's glow colour and
      // scales with glow intensity, so visual edits are visible in the lighting.
      binding.light.color.set(visual?.emissive ?? light.color);
      binding.light.intensity = light.intensity * (visual ? visual.emissiveIntensity / 4 : 1);
      binding.light.distance = light.range;
    }
    binding.entity = entity;
  }

  private destroyBinding(binding: Binding): void {
    binding.root.removeFromParent();
    binding.instance.body.traverse(disposeObject);
    binding.light?.dispose();
  }

  // ---------------------------------------------------------------- selection

  private createMarker(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'selection-marker';
    group.visible = false;
    const make = (hex: string, k: number) => {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex).multiplyScalar(k),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.markerMaterials.push(m);
      return m;
    };
    const cyan = make('#40e0ff', 2.4);
    const violet = make('#9b6bff', 2.0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 128), cyan);
    const arc = new THREE.Mesh(new THREE.RingGeometry(1.07, 1.1, 128, 1, 0, Math.PI * 1.35), violet);
    ring.rotation.x = arc.rotation.x = -Math.PI / 2;
    group.add(ring, arc);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), cyan);
      const a = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0);
      tick.rotation.set(-Math.PI / 2, 0, -a + Math.PI / 2);
      group.add(tick);
    }
    group.traverse((o) => (o.renderOrder = 999));
    return group;
  }

  private refreshMarker(): void {
    const binding = this.selectedId ? this.bindings.get(this.selectedId) : undefined;
    if (!binding || !isShown(binding.root)) {
      this.marker.visible = false;
      return;
    }
    const box = this.entityBounds(binding);
    if (box.isEmpty()) {
      this.marker.visible = false;
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const origin = binding.root.getWorldPosition(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.56 + 0.9;
    this.marker.position.set(center.x, origin.y + 0.12, center.z);
    this.marker.scale.setScalar(radius);
    this.marker.visible = true;
  }

  /** World-space bounds of an entity's own body, ignoring glows and beams. */
  private entityBounds(binding: Binding): THREE.Box3 {
    binding.root.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    const visit = (obj: THREE.Object3D) => {
      if (obj.userData.noPick || (obj as THREE.Sprite).isSprite || (obj as THREE.Light).isLight) return;
      const geometry = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (geometry && !(obj as THREE.InstancedMesh).isInstancedMesh) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (geometry.boundingBox) box.union(part.copy(geometry.boundingBox).applyMatrix4(obj.matrixWorld));
      }
      obj.children.forEach(visit);
    };
    visit(binding.instance.body);
    return box;
  }

  // ---------------------------------------------------------------- picking

  private pick(clientX: number, clientY: number): EntityId | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    for (const hit of this.raycaster.intersectObject(this.entityRoot, true)) {
      const id = pickableEntityId(hit.object);
      if (id) return id;
    }
    return null;
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerDown = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };

  private onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || event.button !== 0) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
    this.callbacks.onSelect(this.pick(event.clientX, event.clientY));
  };

  private onPointerMove = (event: PointerEvent) => {
    this.pendingHover = event.buttons === 0 ? { x: event.clientX, y: event.clientY } : null;
  };

  private onPointerLeave = () => {
    this.pendingHover = null;
    this.setHover(null, 0, 0);
  };

  private setHover(id: EntityId | null, x: number, y: number) {
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    }
    this.callbacks.onHover?.(id, x, y);
  }

  // ---------------------------------------------------------------- camera

  private flyTo(position: THREE.Vector3, target: THREE.Vector3, seconds: number) {
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now() / 1000,
      duration: seconds,
    };
  }

  private cancelTween = () => {
    this.tween = null;
  };

  // ---------------------------------------------------------------- loop

  private frame = (timestamp: number) => {
    if (this.disposed || this.contextLost) return;
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const time = this.timer.getElapsed();
    if (dt > 0) this.fps = this.fps * 0.93 + (1 / dt) * 0.07;

    if (this.tween) {
      const k = Math.min(1, (performance.now() / 1000 - this.tween.start) / this.tween.duration);
      const e = easeInOutCubic(k);
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update(dt);
    this.environment.update(time, this.camera);
    for (const binding of this.bindings.values()) binding.instance.tick?.(time);

    if (this.marker.visible) {
      this.marker.rotation.y = time * 0.5;
      const pulse = 0.7 + 0.3 * Math.sin(time * 3);
      for (const m of this.markerMaterials) m.opacity = pulse;
    }
    if (this.pendingHover) {
      const { x, y } = this.pendingHover;
      this.pendingHover = null;
      this.setHover(this.pick(x, y), x, y);
    }

    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
  }

  private buildComposer(): EffectComposer {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold sits above the sky's brightest values so only emissive elements bloom.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.8, 0.55, 0.9));
    composer.addPass(new OutputPass());
    return composer;
  }

  private disposeComposer(composer: EffectComposer) {
    for (const pass of composer.passes) pass.dispose();
    composer.dispose();
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost?.();
  };

  private onContextRestored = () => {
    this.rebuildResources();
    this.callbacks.onContextRestored?.();
  };

  /**
   * Rebuilds WebGL resources after a context restore, preserving world state,
   * selection and undo/redo history (which live outside the renderer).
   *
   * Three.js r0.187 re-initialises GL management state on restore
   * (`WebGLRenderer.onContextRestore` → `initGLContext()`) but does not
   * recreate context-bound GPU resources: the bloom composer's render-target
   * framebuffers, shared canvas textures and entity archetype materials all
   * hold invalid WebGL handles after a context loss. This method rebuilds
   * them from the last committed world snapshot.
   */
  public rebuildResources(): void {
    if (this.disposed) return;
    this.cancelTransition();
    this.cancelFuture();
    try {
      // The bloom composer's render target is context-bound; rebuild it on next setQuality.
      if (this.composer) {
        this.disposeComposer(this.composer);
        this.composer = null;
      }
      // Shared textures lose their GPU objects on context loss.
      disposeSharedTextures();
      // Drop stale bindings so archetypes rebuild with fresh GL objects.
      for (const binding of this.bindings.values()) this.destroyBinding(binding);
      this.bindings.clear();
      // Rebuild the environment from the original seed.
      this.scene.remove(this.environment.group);
      this.environment.dispose();
      this.environment = createEnvironment(this.seed);
      this.scene.add(this.environment.group);
      // Rebuild the selection marker (meshes/materials lost their GL objects).
      this.marker.traverse(disposeObject);
      this.scene.remove(this.marker);
      this.markerMaterials.length = 0;
      this.marker = this.createMarker();
      this.scene.add(this.marker);
      // Re-sync the last committed world; recreates bindings and fresh archetype resources.
      if (this.lastWorld) this.sync(this.lastWorld);
      // Restore quality mode (rebuilds the composer if cinematic), pixel ratio and size.
      this.setQuality(this.quality);
      this.contextLost = false;
      this.refreshMarker();
    } catch (error) {
      this.contextLost = true;
      this.callbacks.onContextLost?.();
      throw error;
    }
  }

  /**
   * Plays a World Morph transition: animates changed, non-pinned entities from
   * `before` to `after` over `maxDurationMs`. World state is the truth —
   * `sync(after)` runs first and stays correct with or without a transition.
   *
   * Rules:
   *   - Pinned entities are never animated.
   *   - Instant under prefers-reduced-motion or Performance quality mode.
   *   - Presentation only: never mutates World or dispatches events.
   *   - If `cancel()` is called, the frame after must match `after`.
   *   - No new GPU resources survive the transition; dispose() cleans up.
   */
  public async playTransition(transition: WorldTransition): Promise<void> {
    // World state is the truth: sync first, always correct.
    this.sync(transition.after);

    // Instant under reduced motion or Performance mode.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion || this.quality === 'performance') {
      this.refreshMarker();
      return;
    }

    const pinned = new Set(transition.pinned);
    const start = performance.now();
    const duration = Math.max(1, transition.maxDurationMs) / 1000;
    this.morphStartTime = start;
    this.morphDuration = duration;
    this.morphCancelled = false;
    this.morphTweens.clear();

    // Build tweens for changed, non-pinned entities that have bindings.
    for (const id of transition.changed) {
      if (pinned.has(id)) continue;
      const binding = this.bindings.get(id);
      if (!binding) continue;
      const beforeEntity = transition.before.entities[id];
      const afterEntity = transition.after.entities[id];
      if (!beforeEntity || !afterEntity) continue;
      const fromPos = new THREE.Vector3(...beforeEntity.components.transform.position);
      const toPos = new THREE.Vector3(...afterEntity.components.transform.position);
      if (fromPos.equals(toPos)) continue;
      this.morphTweens.set(id, {
        id,
        binding,
        fromPos,
        toPos,
        start: start / 1000,
        duration,
      });
    }

    if (this.morphTweens.size === 0) {
      this.refreshMarker();
      return;
    }

    // Drive the tweens through the animation frame loop.
    await new Promise<void>((resolve) => {
      const step = () => {
        if (this.morphCancelled) {
          this.morphTweens.clear();
          this.sync(transition.after);
          this.refreshMarker();
          resolve();
          return;
        }
        const now = performance.now() / 1000;
        const k = Math.min(1, (now - this.morphStartTime / 1000) / this.morphDuration);
        const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

        for (const tween of this.morphTweens.values()) {
          tween.binding.root.position.lerpVectors(tween.fromPos, tween.toPos, ease);
        }

        if (k >= 1) {
          this.morphTweens.clear();
          this.refreshMarker();
          resolve();
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** Stops the morph at once and shows `after` exactly. Called on undo, redo,
   *  new edit, new morph, context loss and dispose. */
  public cancelTransition(): void {
    this.morphCancelled = true;
    this.morphTweens.clear();
    this.refreshMarker();
  }

  /**
   * Preview a Parallel Future without mutating the canonical world.
   * Syncs the future state first (always correct), then animates changed,
   * non-pinned entities from baseline to future positions over maxDurationMs.
   * Pinned entities are never animated. Instant under reduced motion or
   * Performance mode. Presentation only: never mutates World or dispatches
   * events.
   */
  public async previewFuture(preview: FuturePreview): Promise<void> {
    // World state is the truth: sync the future first, always correct.
    this.sync(preview.future);

    // Instant under reduced motion or Performance mode.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion || this.quality === 'performance') {
      this.refreshMarker();
      return;
    }

    const pinned = new Set(preview.pinned);
    const start = performance.now();
    const duration = Math.max(1, preview.maxDurationMs) / 1000;
    this.futureStartTime = start;
    this.futureDuration = duration;
    this.futureCancelled = false;
    this.futureBaseline = preview.baseline;
    this.futureTweens.clear();

    // Build tweens for changed, non-pinned entities that have bindings.
    for (const id of preview.changed) {
      if (pinned.has(id)) continue;
      const binding = this.bindings.get(id);
      if (!binding) continue;
      const beforeEntity = preview.baseline.entities[id];
      const afterEntity = preview.future.entities[id];
      if (!beforeEntity || !afterEntity) continue;
      const fromPos = new THREE.Vector3(...beforeEntity.components.transform.position);
      const toPos = new THREE.Vector3(...afterEntity.components.transform.position);
      if (fromPos.equals(toPos)) continue;
      this.futureTweens.set(id, {
        id,
        binding,
        fromPos,
        toPos,
        start: start / 1000,
        duration,
      });
    }

    if (this.futureTweens.size === 0) {
      this.refreshMarker();
      return;
    }

    // Drive the tweens through the animation frame loop.
    await new Promise<void>((resolve) => {
      const step = () => {
        if (this.futureCancelled) {
          this.futureTweens.clear();
          this.sync(this.futureBaseline!);
          this.refreshMarker();
          resolve();
          return;
        }
        const now = performance.now() / 1000;
        const k = Math.min(1, (now - this.futureStartTime / 1000) / this.futureDuration);
        const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

        for (const tween of this.futureTweens.values()) {
          tween.binding.root.position.lerpVectors(tween.fromPos, tween.toPos, ease);
        }

        if (k >= 1) {
          this.futureTweens.clear();
          this.refreshMarker();
          resolve();
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** Stops a future preview at once and restores the canonical baseline world
   *  exactly. Called on cancel, new edit, new preview, context loss and
   *  dispose. */
  public cancelFuture(): void {
    this.futureCancelled = true;
    this.futureTweens.clear();
    if (this.futureBaseline) {
      this.sync(this.futureBaseline);
      this.futureBaseline = null;
    }
    this.refreshMarker();
  }

  /** Returns whether a future preview is currently active. */
  public futurePreviewActive(): boolean {
    return this.futureTweens.size > 0 || this.futureBaseline !== null;
  }
}

function isShown(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Nearest entity id above a hit object, or null if the hit should be ignored. */
function pickableEntityId(obj: THREE.Object3D): EntityId | null {
  let id: EntityId | null = null;
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (!o.visible || o.userData.noPick) return null;
    if (!id && typeof o.userData.entityId === 'string') id = o.userData.entityId as EntityId;
  }
  return id;
}
