import { applyEvent } from './reducer';
import type { World, WorldEvent } from './types';

export interface ReplayResult {
  readonly world: World;
  readonly applied: number;
  readonly rejected: ReadonlyArray<{ readonly index: number; readonly reason: string }>;
}

/**
 * Deterministically re-applies events to an initial world.
 * Same initial world + same events => structurally identical result.
 */
export function replay(initial: World, events: readonly WorldEvent[]): ReplayResult {
  let world = initial;
  let applied = 0;
  const rejected: Array<{ index: number; reason: string }> = [];
  events.forEach((event, index) => {
    const result = applyEvent(world, event);
    if (result.ok) {
      world = result.world;
      applied += 1;
    } else {
      rejected.push({ index, reason: result.reason });
    }
  });
  return { world, applied, rejected };
}
