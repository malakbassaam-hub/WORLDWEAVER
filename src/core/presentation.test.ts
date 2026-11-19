import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { buildMorphTransition, createTransitionCoordinator, MAX_TRANSITION_MS, type TransitionPresenter, type WorldTransition } from './presentation';
import { asEntityId, type WorldEvent } from './types';

const env = (reduced = false, perf = false) => ({ reducedMotion: () => reduced, performanceMode: () => perf });

function transition(changed = ['a']): WorldTransition {
  const w = buildCrystalKingdom();
  return { kind: 'morph', before: w, after: w, changed: changed.map(asEntityId), pinned: [], maxDurationMs: 5000 };
}

function mockPresenter(opts: { fail?: boolean } = {}) {
  const calls = { play: [] as WorldTransition[], cancel: 0 };
  let finish: () => void = () => undefined;
  const presenter: TransitionPresenter = {
    play: (t) => {
      calls.play.push(t);
      if (opts.fail) return Promise.reject(new Error('gpu'));
      return new Promise<void>((r) => (finish = r));
    },
    cancel: () => {
      calls.cancel += 1;
      finish();
    },
  };
  return { presenter, calls, finish: () => finish() };
}

describe('buildMorphTransition', () => {
  it('lists changed entities from the batch events, excluding pinned ones', () => {
    const w = buildCrystalKingdom();
    const [a, b, p] = ['a', 'b', 'p'].map(asEntityId) as [ReturnType<typeof asEntityId>, ReturnType<typeof asEntityId>, ReturnType<typeof asEntityId>];
    const events: WorldEvent[] = [
      { type: 'entity/renamed', id: a, name: 'x', source: 'director' },
      { type: 'entity/visualChanged', id: a, patch: { visible: false }, source: 'director' },
      { type: 'entity/transformed', id: b, transform: { position: [1, 2, 3] }, source: 'director' },
      { type: 'entity/renamed', id: p, name: 'y', source: 'director' },
    ];
    const t = buildMorphTransition(w, w, events, [p]);
    expect(t.changed).toEqual([a, b]);
    expect(t.pinned).toEqual([p]);
    expect(t.maxDurationMs).toBe(MAX_TRANSITION_MS);
  });
});

describe('TransitionCoordinator', () => {
  it('is instant without a presenter, under reduced motion, in performance mode and with nothing to animate', async () => {
    expect(await createTransitionCoordinator(null, env()).play(transition())).toBe('instant');
    const m = mockPresenter();
    expect(await createTransitionCoordinator(m.presenter, env(true)).play(transition())).toBe('instant');
    expect(await createTransitionCoordinator(m.presenter, env(false, true)).play(transition())).toBe('instant');
    expect(await createTransitionCoordinator(m.presenter, env()).play(transition([]))).toBe('instant');
    expect(m.calls.play).toHaveLength(0);
  });

  it('plays with a bounded duration and reports completion', async () => {
    const m = mockPresenter();
    const c = createTransitionCoordinator(m.presenter, env());
    const run = c.play(transition());
    expect(c.isPlaying()).toBe(true);
    expect(m.calls.play[0]!.maxDurationMs).toBe(MAX_TRANSITION_MS);
    m.finish();
    expect(await run).toBe('played');
    expect(c.isPlaying()).toBe(false);
  });

  it('cancel (undo, edit, dispose) stops the presenter and reports cancelled', async () => {
    const m = mockPresenter();
    const c = createTransitionCoordinator(m.presenter, env());
    const run = c.play(transition());
    c.cancel();
    expect(await run).toBe('cancelled');
    expect(m.calls.cancel).toBe(1);
    c.cancel(); // idempotent
    expect(m.calls.cancel).toBe(1);
  });

  it('a new transition cancels the running one first', async () => {
    const m = mockPresenter();
    const c = createTransitionCoordinator(m.presenter, env());
    const first = c.play(transition(['a']));
    const second = c.play(transition(['b']));
    expect(await first).toBe('cancelled');
    expect(m.calls.cancel).toBe(1);
    m.finish();
    expect(await second).toBe('played');
  });

  it('a failing presenter yields "failed" and never throws into the studio', async () => {
    const m = mockPresenter({ fail: true });
    const c = createTransitionCoordinator(m.presenter, env());
    expect(await c.play(transition())).toBe('failed');
    expect(c.isPlaying()).toBe(false);
  });
});
