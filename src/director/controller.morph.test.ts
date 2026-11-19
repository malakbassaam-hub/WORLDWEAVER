import { describe, expect, it } from 'vitest';
import { WorldStore } from '../core/store';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import type { ClientResult, DirectorRequestBody } from './client';
import { DirectorController } from './controller';
import { checkPinnedInvariant, APPROVED_MORPH_POLICY, type MorphTranslation } from './morph';

const VIOLET = JSON.stringify({
  summary: 'Violet dusk.',
  operations: [
    { op: 'recolor', target: 'e4', palette: 'Night Violet' },
    { op: 'recolor', target: 'e1', palette: 'Night Violet' },
    { op: 'hide', target: 'e3' },
  ],
});
const SHIFT = JSON.stringify({ summary: 'Lift the isle.', operations: [{ op: 'move', target: 'e1', direction: 'up' }, { op: 'glow', target: 'e4', glow: 4 }] });

const ok = (text: string): ClientResult => ({ ok: true, mode: 'recorded', requestId: 'r1', text, recordingId: 'rec' });

function setup(text: string | (() => ClientResult), morph?: { enabled: boolean }) {
  const store = new WorldStore(buildCrystalKingdom());
  const bodies: DirectorRequestBody[] = [];
  const controller = new DirectorController({
    store,
    request: async (body) => {
      bodies.push(body);
      return typeof text === 'string' ? ok(text) : text();
    },
    ...(morph ? { morph } : {}),
  });
  return { store, controller, bodies };
}

describe('DirectorController: World Morph', () => {
  it('is disabled unless explicitly enabled, and sends nothing', async () => {
    const { controller, bodies, store } = setup(VIOLET);
    expect(controller.isMorphEnabled()).toBe(false);
    await controller.generateMorph('violet dusk');
    expect(controller.getState().error).toMatchObject({ code: 'MORPH_DISABLED', retryable: false });
    expect(bodies).toHaveLength(0);
    expect(store.getLog()).toHaveLength(0);
  });

  it('when enabled: sends mode "morph", previews with pin rules, applies as one morph batch', async () => {
    const { controller, bodies, store } = setup(VIOLET, { enabled: true });
    const before = store.getState();
    await controller.generateMorph('violet dusk');
    expect(bodies[0]!.mode).toBe('morph');
    const p = controller.getState().preview!;
    expect(p.kind).toBe('morph');
    const t = p.translation as MorphTranslation;
    expect(t.kind).toBe('morph');
    expect(t.policy).toEqual(APPROVED_MORPH_POLICY);
    expect(t.applicable).toBe(true);
    expect(store.getState()).toBe(before); // nothing applied before explicit approval

    expect(controller.apply()).toBe(true);
    expect(store.getLog().at(-1)?.meta?.details?.kind).toBe('morph');
    expect(checkPinnedInvariant(before, store.getState())).toEqual([]);
    expect(store.undo()).toBe(true);
    expect(store.getState().entities).toEqual(before.entities);
  });

  it('refuses a morph that would move a pinned entity\'s ancestor', async () => {
    const { controller, store } = setup(SHIFT, { enabled: true });
    await controller.generateMorph('lift the isle');
    const t = controller.getState().preview!.translation as MorphTranslation;
    expect(t.applicable).toBe(false);
    expect(t.outcomes[0]).toMatchObject({ status: 'rejected', rule: 'pinned-ancestor' });
    expect(controller.apply()).toBe(false);
    expect(store.getLog()).toHaveLength(0);
  });

  it('the same proposal in Edit mode keeps Phase 2 rules (morph rules apply to morphs only)', async () => {
    const { controller } = setup(SHIFT, { enabled: true });
    controller.setTask('edit');
    await controller.generate('lift the isle');
    const p = controller.getState().preview!;
    expect(p.kind).toBe('proposal');
    expect(p.translation.applicable).toBe(true);
  });

  it('refresh after a manual edit re-translates with morph rules; retry repeats a morph', async () => {
    let calls = 0;
    const { controller, store, bodies } = setup(() => {
      calls += 1;
      return calls === 1 ? { ok: false, code: 'UPSTREAM', message: 'boom', issues: [] } : ok(VIOLET);
    }, { enabled: true });
    await controller.generateMorph('violet dusk');
    expect(controller.getState().error?.code).toBe('UPSTREAM');
    await controller.retry();
    expect(bodies.map((b) => b.mode)).toEqual(['morph', 'morph']);
    const spire = Object.values(store.getState().entities).find((e) => e.name === 'Sentinel Spire II')!;
    store.dispatch({ type: 'entity/renamed', id: spire.id, name: 'Meanwhile', source: 'user' });
    expect(controller.getState().preview?.stale).toBe(true);
    controller.refreshPreview();
    const refreshed = controller.getState().preview!;
    expect(refreshed.kind).toBe('morph');
    expect((refreshed.translation as MorphTranslation).kind).toBe('morph');
    expect(controller.apply()).toBe(true);
  });

  it('duplicate morph requests while loading send one request', async () => {
    let release!: (r: ClientResult) => void;
    const store = new WorldStore(buildCrystalKingdom());
    const bodies: DirectorRequestBody[] = [];
    const controller = new DirectorController({
      store,
      request: (body) => {
        bodies.push(body);
        return new Promise((r) => (release = r));
      },
      morph: { enabled: true },
    });
    const first = controller.generateMorph('violet');
    void controller.generateMorph('again');
    void controller.generate('and a create');
    expect(bodies).toHaveLength(1);
    release(ok(VIOLET));
    await first;
    expect(controller.getState().preview?.kind).toBe('morph');
  });
});
