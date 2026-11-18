import { applyEvent } from './reducer';
import { WorldStore, type LogEntry } from './store';
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

export interface LogReplayResult {
  readonly world: World;
  /** Number of entries whose replayed outcome differed from the recorded one. */
  readonly mismatches: ReadonlyArray<{ readonly index: number; readonly expected: boolean; readonly actual: boolean }>;
}

/**
 * Re-executes a complete store log (events, batches, undo, redo) in a fresh
 * store. Same initial world + same log => identical world, including seq.
 * This never calls Gemini: Director proposals are logged as their events.
 */
export function replayLog(initial: World, log: readonly LogEntry[], options: { historyLimit?: number } = {}): LogReplayResult {
  const store = new WorldStore(initial, options);
  const mismatches: Array<{ index: number; expected: boolean; actual: boolean }> = [];
  log.forEach((entry, index) => {
    let actual: boolean;
    switch (entry.kind) {
      case 'event':
        actual = entry.event ? store.dispatch(entry.event).ok : false;
        break;
      case 'batch':
        actual = entry.events && entry.meta ? store.dispatchBatch(entry.events, entry.meta).ok : false;
        break;
      case 'undo':
        actual = store.undo();
        break;
      case 'redo':
        actual = store.redo();
        break;
    }
    if (actual !== entry.ok) mismatches.push({ index, expected: entry.ok, actual });
  });
  return { world: store.getState(), mismatches };
}
