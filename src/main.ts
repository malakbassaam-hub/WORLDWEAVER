import './ui/styles.css';
import { applyEvent } from './core/reducer';
import { WorldStore } from './core/store';
import type { EntityId, WorldEventBody } from './core/types';
import { SceneRenderer, WebGLUnavailableError } from './render/SceneRenderer';
import { buildMorphTransition, createTransitionCoordinator } from './core/presentation';
import { pinClosure } from './director/morph';
import { fetchHealth, requestProposal } from './director/client';
import { DirectorController } from './director/controller';
import type { StudioActions } from './ui/actions';
import { DirectorPanel } from './ui/director';
import { isTypingTarget } from './ui/dom';
import { HierarchyPanel } from './ui/hierarchy';
import { InspectorPanel } from './ui/inspector';
import { SelectionModel } from './ui/selection';
import { StudioShell } from './ui/shell';
import { TimelinePanel } from './ui/timeline';
import { buildCrystalKingdom } from './worlds/crystalKingdom';

/**
 * Composition root. Data flow is one-directional:
 *   UI intent -> StudioActions.edit -> WorldStore.dispatch -> reducer
 *   WorldStore change -> renderer.sync + panel.update
 */
async function boot(host: HTMLElement) {
  const genesis = buildCrystalKingdom();
  const store = new WorldStore(genesis);
  const selection = new SelectionModel();
  let renderer: SceneRenderer | null = null;

  // World Morph activation is server-side only. Never read import.meta.env in
  // client code (steering rule). The /api/director/health endpoint reports
  // morphEnabled from DIRECTOR_MORPH on the server process. Default off.
  const health = await fetchHealth();
  const MORPH_ENABLED = health?.morphEnabled === true;

  const shell = new StudioShell(host, genesis, {
    undo: () => actions.undo(),
    redo: () => actions.redo(),
    resetCamera: () => actions.resetCamera(),
    toggleQuality: () => {
      if (!renderer) return;
      const next = renderer.getQuality() === 'cinematic' ? 'performance' : 'cinematic';
      renderer.setQuality(next);
      shell.setQualityLabel(next);
    },
  });

  const actions: StudioActions = {
    store,
    selection,
    edit(event: WorldEventBody) {
      const probe = applyEvent(store.getState(), { ...event, source: 'user' });
      if (!probe.ok && probe.reason === 'No change.') {
        if ('id' in event) renderer?.revertPreview(event.id);
        return false;
      }
      const result = store.dispatch({ ...event, source: 'user' });
      if (!result.ok && result.reason !== 'No change.') shell.toast(result.reason, 'warn');
      if (!result.ok && 'id' in event) renderer?.revertPreview(event.id);
      return result.ok;
    },
    undo() {
      if (!store.undo()) shell.toast('Nothing to undo.');
    },
    redo() {
      if (!store.redo()) shell.toast('Nothing to redo.');
    },
    select(id: EntityId | null) {
      selection.set(id && store.getState().entities[id] ? id : null);
    },
    focus(id: EntityId) {
      renderer?.focus(id);
    },
    resetCamera() {
      renderer?.resetCamera();
    },
    preview(id, visual) {
      renderer?.previewVisual(id, visual);
    },
    revertPreview(id) {
      renderer?.revertPreview(id);
    },
    notify(message, tone = 'info') {
      shell.toast(message, tone);
    },
  };

  const hierarchy = new HierarchyPanel(actions);
  const inspector = new InspectorPanel(actions);
  const timeline = new TimelinePanel(actions, { seq: genesis.seq, entities: genesis.order.length, seed: genesis.seed });

  // AI World Director: talks only to the same-origin proxy at /api/director.
  const director = new DirectorController({
    store,
    request: (body, signal) => requestProposal(body, { signal }),
    health: (signal) => fetchHealth({ signal }),
    morph: { enabled: MORPH_ENABLED },
  });
  const directorPanel = new DirectorPanel(director, store, {
    onApplied: (entityIds, label) => {
      const first = entityIds.find((id) => store.getState().entities[id]);
      if (first) {
        actions.select(first);
        actions.focus(first);
      }
      shell.toast(`${label} · Undo with Ctrl+Z.`);
    },
    focusEntity: (id) => {
      actions.select(id);
      actions.focus(id);
    },
  });
  void director.refreshHealth();
  shell.left.append(hierarchy.element, directorPanel.element);
  shell.right.append(inspector.element);
  shell.bottom.append(timeline.element);

  const render = () => {
    const world = store.getState();
    renderer?.sync(world);
    renderer?.setSelection(selection.get());
    hierarchy.update(world);
    inspector.update(world);
    timeline.update(world, store.getLog());
    shell.setHistory(store.canUndo(), store.canRedo());
  };

  // World Morph transition coordinator (renderer side, Kilo Code).
  // Wired per docs/world-morph/KILO_HANDOFF.md §2b. Assigned after the
  // renderer exists so the presenter is wired immediately.
  let transitions: ReturnType<typeof createTransitionCoordinator> | null = null;

  try {
    renderer = new SceneRenderer(
      shell.viewport,
      {
        onSelect: (id) => actions.select(id),
        onHover: (id, x, y) => shell.showTooltip(id ? (store.getState().entities[id]?.name ?? null) : null, x, y),
        onContextLost: () => {
          shell.showFallback('The 3D context was lost', 'The GPU reset or ran out of memory. The viewport will restore automatically.');
          transitions?.cancel();
        },
        onContextRestored: () => {
          if (!renderer) return;
          renderer.sync(store.getState());
          renderer.setSelection(selection.get());
          shell.hideFallback(renderer.domElement);
          shell.setQualityLabel(renderer.getQuality());
        },
      },
      genesis.seed,
    );
    shell.setQualityLabel(renderer.getQuality());

    transitions = createTransitionCoordinator(
      { play: (t) => renderer!.playTransition(t), cancel: () => renderer!.cancelTransition() },
      {
        reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        performanceMode: () => renderer!.getQuality() === 'performance',
      },
    );

    let previous = store.getState();
    const unsubscribeStore = store.subscribe((world, log) => {
      const id = selection.get();
      if (id && !store.getState().entities[id]) selection.set(null);
      const entry = log.at(-1);
      if (entry?.kind === 'batch' && entry.ok && entry.meta?.details?.kind === 'morph' && entry.events) {
        void transitions!.play(buildMorphTransition(previous, world, entry.events, pinClosure(previous).pinned));
      } else {
        transitions!.cancel(); // undo, redo, any edit or rejected entry
      }
      previous = world;
      render();
    });
    const unsubscribeSelection = selection.subscribe((id) => renderer?.setSelection(id));
    render();

    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
      } else if (mod && key === 'y') {
        event.preventDefault();
        actions.redo();
      } else if (!mod && key === 'escape') {
        actions.select(null);
      } else if (!mod && key === 'f') {
        const id = selection.get();
        if (id) actions.focus(id);
      } else if (!mod && key === 'home') {
        actions.resetCamera();
      }
    };
    window.addEventListener('keydown', onKey);

    const statsTimer = window.setInterval(() => {
      if (!renderer) return;
      const s = renderer.getStats();
      shell.setStats(`${s.fps} fps · ${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · ${s.entities} entities`);
    }, 500);

    requestAnimationFrame(() => requestAnimationFrame(() => shell.ready()));

    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearInterval(statsTimer);
      directorPanel.dispose();
      director.dispose();
      unsubscribeStore();
      unsubscribeSelection();
      renderer?.dispose();
      host.replaceChildren();
    };
  } catch (error) {
    renderer = null;
    const message = error instanceof WebGLUnavailableError ? error.message : `The renderer failed to start: ${(error as Error).message}`;
    shell.showFallback('3D viewport unavailable', message);
    shell.setQualityLabel('unavailable');
    console.error(error);
    // Still render without a renderer so panels work.
    render();
    return () => {
      directorPanel.dispose();
      director.dispose();
      host.replaceChildren();
    };
  }
}

const host = document.getElementById('app');
if (!host) throw new Error('#app element missing');
boot(host).then((teardown) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(teardown);
  }
});
