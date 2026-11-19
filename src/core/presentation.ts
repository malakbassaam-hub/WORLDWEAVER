/**
 * Renderer transition CONTRACT for World Morph (docs/WORLD_MORPH_PLAN.md §6).
 *
 * Types and a small coordinator only. No three.js, no DOM. Kilo Code
 * implements `TransitionPresenter` in `src/render/**`; the studio wiring (one
 * call in `src/main.ts`) is an integration hook listed in
 * docs/world-morph/KILO_HANDOFF.md. Not wired yet.
 *
 * Rules:
 * 1. World state is the truth. The renderer is synced to `after` first and
 *    stays correct with or without a transition.
 * 2. No presenter, reduced motion, performance mode or a failing presenter all
 *    mean "instant": the change simply appears.
 * 3. A new transition, undo, redo, any edit, context loss and dispose cancel
 *    the running transition; the next frame must show `after` exactly.
 * 4. Pinned entities are never animated.
 */
import type { EntityId, World, WorldEvent } from './types';

export const MAX_TRANSITION_MS = 1200; // D-WM-4 (proposed; WW-031)

export interface WorldTransition {
  readonly kind: 'morph';
  readonly before: World;
  readonly after: World;
  /** Entities created, changed or removed by the batch, excluding pinned ones. */
  readonly changed: readonly EntityId[];
  /** Never animated. */
  readonly pinned: readonly EntityId[];
  readonly maxDurationMs: number;
}

export interface TransitionPresenter {
  /** Presentation only. Must never mutate World or dispatch events. */
  play(transition: WorldTransition): Promise<void>;
  /** Stop at once and show `after` exactly. */
  cancel(): void;
}

export type TransitionResult = 'played' | 'instant' | 'failed' | 'cancelled';

export interface TransitionEnvironment {
  readonly reducedMotion: () => boolean;
  readonly performanceMode: () => boolean;
}

export function buildMorphTransition(before: World, after: World, events: readonly WorldEvent[], pinned: readonly EntityId[]): WorldTransition {
  const pinnedSet = new Set(pinned);
  const ids = new Set<EntityId>();
  for (const e of events) ids.add(e.type === 'entity/added' ? e.entity.id : e.id);
  return {
    kind: 'morph',
    before,
    after,
    changed: [...ids].filter((id) => !pinnedSet.has(id)),
    pinned: [...pinned],
    maxDurationMs: MAX_TRANSITION_MS,
  };
}

export interface TransitionCoordinator {
  play(transition: WorldTransition): Promise<TransitionResult>;
  /** Call on undo, redo, any edit, context loss and dispose. */
  cancel(): void;
  isPlaying(): boolean;
}

export function createTransitionCoordinator(presenter: TransitionPresenter | null, env: TransitionEnvironment): TransitionCoordinator {
  let running = 0; // token of the running transition, 0 = none
  let next = 0;
  const stop = () => {
    if (running !== 0) {
      running = 0;
      try {
        presenter?.cancel();
      } catch {
        /* a failing cancel must not break the studio */
      }
    }
  };
  return {
    async play(transition) {
      stop();
      if (!presenter || env.reducedMotion() || env.performanceMode() || transition.changed.length === 0) return 'instant';
      const token = ++next;
      running = token;
      const bounded: WorldTransition = { ...transition, maxDurationMs: Math.min(transition.maxDurationMs, MAX_TRANSITION_MS) };
      try {
        await presenter.play(bounded);
      } catch {
        if (running === token) {
          running = 0;
          try {
            presenter.cancel();
          } catch {
            /* ignore */
          }
        }
        return 'failed';
      }
      if (running !== token) return 'cancelled';
      running = 0;
      return 'played';
    },
    cancel: stop,
    isPlaying: () => running !== 0,
  };
}
