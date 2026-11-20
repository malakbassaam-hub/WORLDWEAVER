import { describe, expect, it } from 'vitest';
import { WorldStore } from '../core/store';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import type { ClientResult, DirectorRequestBody, HealthInfo } from './client';
import { DirectorController, PROMPT_MAX_CHARS } from './controller';
import { describeOperations, summarizeTranslation } from './describe';

const CREATE = JSON.stringify({
  summary: 'Two violet spires.',
  operations: [{ op: 'add', archetype: 'crystalSpire', name: 'Violet Watch', count: 2, placement: 'inner-ring', palette: 'Night Violet' }],
});
const PINNED = JSON.stringify({ summary: 'Recolour the citadel.', operations: [{ op: 'recolor', target: 'e2', palette: 'Orchid Flare' }] });
const EDIT = JSON.stringify({ summary: 'Hide a spire.', operations: [{ op: 'hide', target: 'e5' }] });

const ok = (text: string, extra: Partial<Extract<ClientResult, { ok: true }>> = {}): ClientResult => ({ ok: true, mode: 'recorded', requestId: 'req-1', text, recordingId: 'rec', ...extra });
const err = (code: string, extra: Partial<Extract<ClientResult, { ok: false }>> = {}): ClientResult => ({ ok: false, code, message: `${code} happened`, issues: [], ...extra });

/** A request stub whose responses are released manually, to test timing. */
function deferredRequest() {
  const calls: Array<{ body: DirectorRequestBody; signal: AbortSignal; resolve: (r: ClientResult) => void }> = [];
  const request = (body: DirectorRequestBody, signal: AbortSignal) => new Promise<ClientResult>((resolve) => calls.push({ body, signal, resolve }));
  return { calls, request };
}

function setup(request: (b: DirectorRequestBody, s: AbortSignal) => Promise<ClientResult>, opts: { now?: () => number; health?: HealthInfo | null } = {}) {
  const store = new WorldStore(buildCrystalKingdom());
  const controller = new DirectorController({
    store,
    request,
    ...(opts.health !== undefined ? { health: async () => opts.health ?? null } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { store, controller };
}

describe('DirectorController: happy path', () => {
  it('goes idle → loading → preview without touching the world, then applies as one step', async () => {
    const d = deferredRequest();
    const { store, controller } = setup(d.request);
    const before = store.getState();
    const seen: string[] = [];
    let everStale = false;
    controller.subscribe((s) => {
      if (seen.at(-1) !== s.status) seen.push(s.status);
      if (s.preview?.stale) everStale = true;
    });

    const run = controller.generate('Add two violet spires');
    expect(controller.getState().status).toBe('loading');
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]!.body).toMatchObject({ mode: 'create', prompt: 'Add two violet spires', world: { entityCount: 27 } });
    d.calls[0]!.resolve(ok(CREATE));
    await run;

    const s = controller.getState();
    expect(s.status).toBe('preview');
    expect(s.preview?.translation.applicable).toBe(true);
    expect(s.preview?.mode).toBe('recorded');
    expect(store.getState()).toBe(before); // explicit approval required

    expect(controller.apply()).toBe(true);
    expect(controller.getState().status).toBe('applied');
    expect(store.getState().order.length).toBe(before.order.length + 2);
    expect(controller.getState().lastApplied?.entityIds).toHaveLength(2);
    expect(store.getLog().at(-1)).toMatchObject({ kind: 'batch', ok: true });
    expect(store.undo()).toBe(true);
    expect(store.getState().order).toEqual(before.order);
    expect(seen).toEqual(['loading', 'preview', 'applied']);
    expect(everStale).toBe(false); // applying must not flag its own preview as stale
  });

  it('sends the selected task and edit context', async () => {
    const d = deferredRequest();
    const { controller } = setup(d.request);
    controller.setTask('edit');
    const run = controller.generate('Hide a spire');
    expect(d.calls[0]!.body.mode).toBe('edit');
    const entities = d.calls[0]!.body.world.entities as Array<{ ref: string; pinned: boolean }>;
    expect(entities.find((e) => e.ref === 'e2')?.pinned).toBe(true);
    d.calls[0]!.resolve(ok(EDIT));
    await run;
    expect(controller.getState().preview?.translation.applicable).toBe(true);
  });

  it('discard leaves the world unchanged', async () => {
    const { store, controller } = setup(async () => ok(CREATE));
    const before = store.getState();
    await controller.generate('anything');
    controller.discard();
    expect(controller.getState().status).toBe('idle');
    expect(store.getState()).toBe(before);
    expect(store.getLog()).toHaveLength(0);
  });

  it('reports health and labels recorded mode', async () => {
    const { controller } = setup(async () => ok(CREATE), { health: { mode: 'recorded', model: 'gemini-3.5-flash-lite', keyConfigured: false, liveReady: false, modeReason: 'GEMINI_API_KEY is not set', morphEnabled: false } });
    expect(controller.getState().health.mode).toBe('checking');
    await controller.refreshHealth();
    expect(controller.getState().health).toMatchObject({ mode: 'recorded', liveReady: false, reason: 'GEMINI_API_KEY is not set' });
  });

  it('marks the proxy offline when health fails', async () => {
    const { controller } = setup(async () => ok(CREATE), { health: null });
    await controller.refreshHealth();
    expect(controller.getState().health.mode).toBe('offline');
  });
});

describe('DirectorController: duplicates, cancellation and stale responses', () => {
  it('ignores duplicate submissions while a request is running', async () => {
    const d = deferredRequest();
    const { controller } = setup(d.request);
    const first = controller.generate('one');
    void controller.generate('two');
    void controller.generate('three');
    expect(d.calls).toHaveLength(1);
    expect(controller.getState().requestCount).toBe(1);
    d.calls[0]!.resolve(ok(CREATE));
    await first;
    expect(controller.getState().prompt).toBe('one');
  });

  it('cancel aborts the request and ignores its late response', async () => {
    const d = deferredRequest();
    const { store, controller } = setup(d.request);
    const run = controller.generate('slow request');
    controller.cancel();
    expect(d.calls[0]!.signal.aborted).toBe(true);
    expect(controller.getState().status).toBe('idle');
    d.calls[0]!.resolve(ok(CREATE)); // arrives after cancel
    await run;
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().preview).toBeNull();
    expect(store.getLog()).toHaveLength(0);
  });

  it('a superseded response never overwrites the newer one', async () => {
    const d = deferredRequest();
    const { controller } = setup(d.request);
    const a = controller.generate('first');
    controller.cancel();
    const b = controller.generate('second');
    d.calls[1]!.resolve(ok(EDIT, { requestId: 'req-2' }));
    await b;
    d.calls[0]!.resolve(ok(CREATE, { requestId: 'req-1' }));
    await a;
    expect(controller.getState().preview?.requestId).toBe('req-2');
  });

  it('a CANCELLED result from the client returns to idle', async () => {
    const { controller } = setup(async () => err('CANCELLED'));
    await controller.generate('x');
    expect(controller.getState().status).toBe('idle');
  });
});

describe('DirectorController: errors and retry', () => {
  it('rejects empty and oversized prompts without sending anything', async () => {
    let calls = 0;
    const { controller } = setup(async () => {
      calls += 1;
      return ok(CREATE);
    });
    await controller.generate('   ');
    expect(controller.getState().error?.code).toBe('PROMPT_INVALID');
    await controller.generate('x'.repeat(PROMPT_MAX_CHARS + 1));
    expect(controller.getState().error?.code).toBe('PROMPT_INVALID');
    expect(calls).toBe(0);
  });

  it('blocks retry until retry-after has elapsed, then retries the same request', async () => {
    let t = 1_000;
    const responses = [err('RATE_LIMITED', { retryAfterSec: 8, mode: 'live' }), ok(CREATE, { mode: 'live', model: 'gemini-3.5-flash-lite' })];
    const bodies: DirectorRequestBody[] = [];
    const { controller } = setup(async (body) => {
      bodies.push(body);
      return responses.shift()!;
    }, { now: () => t });
    await controller.generate('Add spires');
    expect(controller.getState().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true, retryAt: 9_000 });
    expect(controller.getState().health.mode).toBe('live');
    await controller.retry();
    await controller.generate('something else');
    expect(bodies).toHaveLength(1); // still waiting
    t = 9_001;
    await controller.retry();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.prompt).toBe('Add spires');
    expect(controller.getState().status).toBe('preview');
  });

  it.each(['NO_KEY', 'AUTH', 'BLOCKED_SAFETY', 'BAD_REQUEST'])('%s is not retryable', async (code) => {
    let calls = 0;
    const { controller } = setup(async () => {
      calls += 1;
      return err(code);
    });
    await controller.generate('x');
    expect(controller.getState().error?.retryable).toBe(false);
    await controller.retry();
    expect(calls).toBe(1);
  });

  it('surfaces network failures and thrown errors as retryable NETWORK errors', async () => {
    const { controller } = setup(async () => {
      throw new Error('boom');
    });
    await controller.generate('x');
    expect(controller.getState().error).toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('re-validates proxy output: malformed and hostile text never reaches the world', async () => {
    for (const text of ['{"summary":', '{"summary":"x","operations":[{"op":"exec","target":"e1"}]}', '{"summary":"x","operations":[{"op":"hide","target":"e1"}],"__proto__":{"p":1}}']) {
      const { store, controller } = setup(async () => ok(text));
      await controller.generate('x');
      expect(controller.getState().error?.code).toBe('INVALID_PROPOSAL');
      expect(controller.getState().error?.issues.length).toBeGreaterThan(0);
      expect(controller.apply()).toBe(false);
      expect(store.getLog()).toHaveLength(0);
    }
  });

  it('passes proxy validation issues through to the UI', async () => {
    const { controller } = setup(async () => err('INVALID_PROPOSAL', { issues: [{ path: 'operations[0].op', code: 'invalid_enum', message: 'Unknown operation' }] }));
    await controller.generate('x');
    expect(controller.getState().error?.issues).toHaveLength(1);
  });
});

describe('DirectorController: protections', () => {
  it('refuses to apply a proposal that touches a pinned entity, and applies nothing', async () => {
    const { store, controller } = setup(async () => ok(PINNED));
    controller.setTask('edit');
    await controller.generate('recolour the citadel');
    const p = controller.getState().preview!;
    expect(p.translation.applicable).toBe(false);
    expect(p.translation.outcomes[0]?.reason).toMatch(/pinned/);
    expect(controller.apply()).toBe(false);
    expect(store.getLog()).toHaveLength(0);
  });

  it('marks the preview stale when the world changes, and refresh makes it applicable again', async () => {
    const { store, controller } = setup(async () => ok(EDIT));
    await controller.generate('hide e5');
    const spire = Object.values(store.getState().entities).find((e) => e.name === 'Sentinel Spire III')!;
    store.dispatch({ type: 'entity/renamed', id: spire.id, name: 'Edited meanwhile', source: 'user' });
    expect(controller.getState().preview?.stale).toBe(true);
    expect(controller.apply()).toBe(false);
    controller.refreshPreview();
    expect(controller.getState().preview?.stale).toBe(false);
    expect(controller.apply()).toBe(true);
  });

  it('cannot apply twice', async () => {
    const { store, controller } = setup(async () => ok(CREATE));
    await controller.generate('x');
    expect(controller.apply()).toBe(true);
    expect(controller.apply()).toBe(false);
    expect(store.getLog().filter((e) => e.kind === 'batch')).toHaveLength(1);
  });

  it('task cannot change during loading', async () => {
    const d = deferredRequest();
    const { controller } = setup(d.request);
    void controller.generate('x');
    controller.setTask('edit');
    expect(controller.getState().task).toBe('create');
  });
});

describe('describe', () => {
  it('produces readable lines and a change summary', async () => {
    const { store, controller } = setup(async () => ok(JSON.stringify({
      summary: 'Mixed.',
      operations: [
        { op: 'add', archetype: 'crystalCluster', name: 'Garden', count: 3, placement: 'on-target', target: 'e1', palette: 'Aurora Mint' },
        { op: 'recolor', target: 'e4', palette: 'Night Violet' },
        { op: 'move', target: 'e5', direction: 'up', steps: 2 },
        { op: 'hide', target: 'e6' },
      ],
    })));
    await controller.generate('x');
    const p = controller.getState().preview!;
    const lines = describeOperations(store.getState(), p.proposal.operations);
    expect(lines).toEqual([
      'Add 3 × crystal clusters “Garden” on “Isle of Aurelion” (Aurora Mint)',
      'Recolour “Sentinel Spire I” to Night Violet',
      'Move “Sentinel Spire II” up × 2',
      'Hide “Sentinel Spire III”',
    ]);
    expect(summarizeTranslation(p.translation)).toEqual({ operations: 4, accepted: 4, rejected: 0, added: 3, changed: 3, removed: 0 });
  });
});
