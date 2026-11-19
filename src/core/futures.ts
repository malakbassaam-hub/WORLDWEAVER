/**
 * Parallel Futures — CONTRACT and reference helpers
 * (docs/architecture/PARALLEL_FUTURES.md).
 *
 * A future is a branch that starts from a known snapshot: the initial world
 * plus a prefix of the session log. Snapshots are restored by deterministic
 * replay (`replayLog`), never by calling Gemini. Branch state is independent
 * of the original store; nothing here mutates the original.
 *
 * NOT IMPLEMENTED: branch persistence, a BranchManager service, timeline UI
 * and viewport comparison. These helpers exist to fix and test the contract.
 */
import { replayLog } from './replay';
import { WorldStore, type LogEntry } from './store';
import type { EntityId, World } from './types';
import { diffWorlds } from './ledger';

export type BranchId = string & { readonly __brand: 'BranchId' };

/** A restorable point in a session: initial world + the first `logLength` log entries. */
export interface WorldSnapshotRef {
  readonly initial: World;
  readonly log: readonly LogEntry[];
  readonly logLength: number;
}

export interface FutureBranch {
  readonly id: BranchId;
  readonly label: string;
  readonly from: WorldSnapshotRef;
  readonly store: WorldStore;
}

export interface WorldComparison {
  readonly added: readonly EntityId[];
  readonly removed: readonly EntityId[];
  readonly changed: readonly EntityId[];
  readonly identical: boolean;
}

export function snapshotRef(initial: World, log: readonly LogEntry[], logLength = log.length): WorldSnapshotRef {
  if (!Number.isInteger(logLength) || logLength < 0 || logLength > log.length) throw new RangeError(`logLength must be 0..${log.length}`);
  return { initial, log: log.slice(0, logLength), logLength };
}

/** Deterministically restores the world at a snapshot. Throws if the log no longer replays identically. */
export function restoreSnapshot(ref: WorldSnapshotRef, options: { historyLimit?: number } = {}): World {
  const r = replayLog(ref.initial, ref.log, options);
  if (r.mismatches.length > 0) throw new Error(`Snapshot does not replay identically (${r.mismatches.length} mismatches).`);
  return r.world;
}

/** Starts an independent branch at a snapshot. Its undo history starts empty. */
export function forkFuture(id: string, label: string, ref: WorldSnapshotRef): FutureBranch {
  return { id: id as BranchId, label, from: ref, store: new WorldStore(restoreSnapshot(ref)) };
}

export function compareWorlds(a: World, b: World): WorldComparison {
  const d = diffWorlds(a, b);
  return { ...d, identical: d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0 };
}
