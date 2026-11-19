/**
 * Parallel Futures (docs/architecture/PARALLEL_FUTURES.md).
 *
 * A future is an isolated alternative continuation of the world, started from
 * a verified state. It never touches the original store until the user
 * explicitly commits it, and then only as ONE atomic batch (one undo step).
 *
 * Invariants (all tested in futures.test.ts):
 * 1. Creating, changing, previewing, comparing or discarding a future never
 *    modifies the original world or its log.
 * 2. A future's state is exactly `applyEvents(base, all step events)`; every
 *    step passes the shape check, the reducer and the pinned invariant.
 * 3. Commit is refused (world unchanged) if the future is stale (the original
 *    changed since the fork, including undo/redo), if any pinned entity of the
 *    base would change (WW-031 invariant, regardless of source), or if the
 *    future is empty, closed or unknown.
 * 4. Committing applies only that future's own events; other futures become
 *    stale automatically and can be rebased or discarded.
 * 5. Steps are bounded (FUTURE_LIMITS) so memory stays proportional to
 *    maxFutures × maxSteps × changed entities (states share unchanged entity
 *    objects with the base).
 *
 * No three.js, no DOM, no network, no model calls.
 */
import { stateRef, worldFingerprint, type StateRef } from './fingerprint';
import { derivedConsequences, entityChanges, type DerivedConsequence, type LedgerEffects } from './ledger';
import { checkPinnedInvariant, pinClosure, type PinnedViolation } from './pins';
import { applyEvents } from './reducer';
import { replayLog } from './replay';
import { MAX_BATCH_EVENTS, type LogEntry, type WorldStore } from './store';
import type { EntityId, EventSource, World, WorldEvent } from './types';
import { checkEventShape } from './wellformed';

// ---------------------------------------------------------------- snapshots

/** A restorable point in a session: initial world + the first `logLength` log entries. */
export interface WorldSnapshotRef {
  readonly initial: World;
  readonly log: readonly LogEntry[];
  readonly logLength: number;
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

// ---------------------------------------------------------------- comparison

export interface EntityDifference {
  readonly id: EntityId;
  /** Name in the second world (or the first, if removed). */
  readonly name: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly fields: readonly string[];
}

export interface WorldComparison extends LedgerEffects {
  readonly identical: boolean;
  /** Field-level differences, in world order (removed last). */
  readonly differences: readonly EntityDifference[];
  /** Descendants whose world pose or visibility differs only through an ancestor (derived). */
  readonly derived: readonly DerivedConsequence[];
  readonly from: StateRef;
  readonly to: StateRef;
}

/** Deterministic comparison of two worlds (content only; seq is reported in the refs). */
export function compareWorlds(a: World, b: World): WorldComparison {
  const changes = entityChanges(a, b);
  const differences = changes.map((c) => ({ id: c.id, name: (b.entities[c.id] ?? a.entities[c.id])?.name ?? c.id, change: c.change, fields: c.fields }));
  const pick = (k: EntityDifference['change']) => changes.filter((c) => c.change === k).map((c) => c.id);
  return {
    added: pick('added'),
    removed: pick('removed'),
    changed: pick('changed'),
    identical: changes.length === 0,
    differences,
    derived: derivedConsequences(a, b, changes),
    from: stateRef(a),
    to: stateRef(b),
  };
}

// ---------------------------------------------------------------- limits and types

/**
 * Bounds, with rationale:
 * - maxFutures 4: the comparison view shows at most four alternatives; more
 *   multiplies memory without being reviewable.
 * - maxStepsPerFuture 32: each step keeps one state for undo; 32 is far above
 *   a realistic exploration and keeps memory bounded.
 * - maxEventsPerFuture = MAX_BATCH_EVENTS: a commit is one store batch.
 */
export const FUTURE_LIMITS = Object.freeze({
  maxFutures: 4,
  maxStepsPerFuture: 32,
  maxEventsPerFuture: MAX_BATCH_EVENTS,
  maxLabelLength: 80,
});

export type FutureId = string & { readonly __brand: 'FutureId' };

export type FutureErrorCode = 'UNKNOWN_FUTURE' | 'CLOSED' | 'LIMIT' | 'MALFORMED' | 'SOURCE' | 'REJECTED' | 'PINNED' | 'EMPTY' | 'STALE' | 'UNVERIFIED' | 'INVALID';

export type FutureResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: FutureErrorCode; readonly reason: string; readonly violations?: readonly PinnedViolation[] };

export interface FutureStepMeta {
  /** Short engine- or user-written label; never prompt text. */
  readonly label: string;
  /** String details (e.g. proposalKey, kind, mode). Never secrets or prompt text. */
  readonly details?: Readonly<Record<string, string>>;
}

export interface FutureStep extends FutureStepMeta {
  readonly events: readonly WorldEvent[];
  readonly seqBefore: number;
  readonly seqAfter: number;
}

export type FutureStatus = 'open' | 'committed' | 'discarded';

export interface FutureView {
  readonly id: FutureId;
  readonly label: string;
  /** Every event in this future has this source; the commit batch uses it too. */
  readonly source: EventSource;
  readonly status: FutureStatus;
  readonly base: StateRef;
  readonly state: StateRef;
  readonly steps: readonly { readonly label: string; readonly events: number; readonly details: Readonly<Record<string, string>> }[];
  readonly eventCount: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** True if the original world changed since the fork (commit would be refused). */
  readonly stale: boolean;
  /** True if the future was forked from an older snapshot (exploration only until rebased). */
  readonly fromSnapshot: boolean;
}

export interface FutureComparison {
  readonly future: FutureView;
  readonly comparison: WorldComparison;
  /** Pinned entities of the base that this future would change (must be empty to commit). */
  readonly violations: readonly PinnedViolation[];
  readonly pinned: readonly EntityId[];
}

export interface FuturesComparison {
  readonly original: StateRef;
  readonly futures: readonly FutureComparison[];
  /** Entities changed by more than one future, in different ways. */
  readonly contested: readonly EntityId[];
}

export interface CommitOptions {
  /** Store label; defaults to `Future: <label>`. */
  readonly label?: string;
}

export interface FuturesManager {
  /** Forks from the store's current state, after verifying it replays exactly from `initial`. */
  fork(label: string, options?: { readonly source?: EventSource; readonly id?: string }): FutureResult<FutureView>;
  /** Forks from an earlier snapshot (restored by verified replay). Exploration only; commit needs a rebase. */
  forkFromSnapshot(ref: WorldSnapshotRef, label: string, options?: { readonly source?: EventSource; readonly id?: string }): FutureResult<FutureView>;
  list(): FutureView[];
  get(id: string): FutureView | null;
  /** The future's current world, for preview rendering. Read-only. */
  state(id: string): World | null;
  base(id: string): World | null;
  /** Applies one validated step atomically to the future. The original is untouched. */
  apply(id: string, events: readonly WorldEvent[], meta: FutureStepMeta): FutureResult<FutureView>;
  undo(id: string): boolean;
  redo(id: string): boolean;
  compare(id: string): FutureResult<FutureComparison>;
  compareAll(): FuturesComparison;
  /** Re-applies a stale future's steps onto the current world. On failure the future is unchanged. */
  rebase(id: string): FutureResult<FutureView>;
  /** Applies the future to the store as ONE batch. On any refusal the store is unchanged. */
  commit(id: string, options?: CommitOptions): FutureResult<{ readonly seq: number; readonly future: FutureView }>;
  discard(id: string): boolean;
  /** Discards all futures and releases their states. */
  dispose(): void;
}

// ---------------------------------------------------------------- implementation

interface FutureRecord {
  readonly id: FutureId;
  readonly label: string;
  readonly source: EventSource;
  readonly fromSnapshot: boolean;
  status: FutureStatus;
  base: World;
  baseRef: StateRef;
  /** states[0] = base; states[i] = after steps[0..i-1]. */
  states: World[];
  steps: FutureStep[];
  redo: Array<{ step: FutureStep; state: World }>;
}

const SOURCES: readonly EventSource[] = ['system', 'user', 'director'];

function cleanLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const t = label.normalize('NFC').trim();
  if (t.length === 0 || t.length > FUTURE_LIMITS.maxLabelLength) return null;
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(t)) return null;
  return t;
}

function fail(code: FutureErrorCode, reason: string, violations?: readonly PinnedViolation[]): { ok: false; code: FutureErrorCode; reason: string; violations?: readonly PinnedViolation[] } {
  return violations ? { ok: false, code, reason, violations } : { ok: false, code, reason };
}

export function createFuturesManager(store: WorldStore, initial: World): FuturesManager {
  const futures = new Map<FutureId, FutureRecord>();
  let counter = 0;
  /** Seq whose state was last verified by replay, with its fingerprint. */
  let verified: StateRef | null = null;

  const current = () => store.getState();
  const isStale = (f: FutureRecord) => {
    const now = current();
    return now.seq !== f.baseRef.seq || (now === f.base ? false : worldFingerprint(now) !== f.baseRef.fingerprint);
  };
  const stateOf = (f: FutureRecord) => f.states[f.states.length - 1]!;
  const eventCount = (f: FutureRecord) => f.steps.reduce((n, s) => n + s.events.length, 0);
  const openCount = () => [...futures.values()].filter((f) => f.status === 'open').length;

  const view = (f: FutureRecord): FutureView => ({
    id: f.id,
    label: f.label,
    source: f.source,
    status: f.status,
    base: f.baseRef,
    state: stateRef(stateOf(f)),
    steps: f.steps.map((s) => ({ label: s.label, events: s.events.length, details: { ...(s.details ?? {}) } })),
    eventCount: eventCount(f),
    canUndo: f.status === 'open' && f.steps.length > 0,
    canRedo: f.status === 'open' && f.redo.length > 0,
    stale: f.status === 'open' ? isStale(f) : false,
    fromSnapshot: f.fromSnapshot,
  });

  const open = (id: string): FutureResult<FutureRecord> => {
    const f = futures.get(id as FutureId);
    if (!f) return fail('UNKNOWN_FUTURE', 'No such future.');
    if (f.status !== 'open') return fail('CLOSED', `This future was already ${f.status}.`);
    return { ok: true, value: f };
  };

  const create = (base: World, label: string, options: { source?: EventSource; id?: string }, fromSnapshot: boolean): FutureResult<FutureView> => {
    const clean = cleanLabel(label);
    if (clean === null) return fail('INVALID', `A future needs a label of 1 to ${FUTURE_LIMITS.maxLabelLength} plain characters.`);
    const source = options.source ?? 'director';
    if (!SOURCES.includes(source)) return fail('INVALID', 'Unknown source.');
    if (options.id !== undefined && (typeof options.id !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(options.id))) return fail('INVALID', 'A future ID must be 1 to 64 letters, digits, ":", "_" or "-".');
    if (options.id !== undefined && futures.has(options.id as FutureId)) return fail('INVALID', `A future with ID ${options.id} already exists.`);
    if (openCount() >= FUTURE_LIMITS.maxFutures) return fail('LIMIT', `At most ${FUTURE_LIMITS.maxFutures} futures can be open at once. Discard one first.`);
    let id = options.id as FutureId | undefined;
    while (id === undefined || futures.has(id)) id = `future-${++counter}` as FutureId;
    const record: FutureRecord = { id, label: clean, source, fromSnapshot, status: 'open', base, baseRef: stateRef(base), states: [base], steps: [], redo: [] };
    futures.set(id, record);
    return { ok: true, value: view(record) };
  };

  /** Validates and applies events to a future world. Pure; returns the new world or a refusal. */
  const tryStep = (f: FutureRecord, from: World, events: readonly WorldEvent[]): FutureResult<World> => {
    if (!Array.isArray(events) || events.length === 0) return fail('EMPTY', 'A step must contain at least one event.');
    for (let i = 0; i < events.length; i++) {
      const problem = checkEventShape(events[i]);
      if (problem) return fail('MALFORMED', `Event ${i + 1}: ${problem}.`);
      if (events[i]!.source !== f.source) return fail('SOURCE', `Event ${i + 1} has source "${events[i]!.source}"; this future only accepts "${f.source}".`);
    }
    const r = applyEvents(from, events);
    if (!r.ok) return fail('REJECTED', `Event ${r.index + 1} of ${events.length} rejected: ${r.reason}`);
    const violations = checkPinnedInvariant(f.base, r.world, pinClosure(f.base).pinned);
    if (violations.length > 0) return fail('PINNED', violations.map((v) => v.message).join(' '), violations);
    return { ok: true, value: r.world };
  };

  const compareOne = (f: FutureRecord): FutureComparison => {
    const after = stateOf(f);
    const pinned = pinClosure(f.base).pinned;
    return { future: view(f), comparison: compareWorlds(f.base, after), violations: checkPinnedInvariant(f.base, after, pinned), pinned };
  };

  return {
    fork(label, options = {}) {
      const now = current();
      if (!verified || verified.seq !== now.seq) {
        const r = replayLog(initial, store.getLog(), { historyLimit: store.getHistoryLimit() });
        const ref = stateRef(now);
        if (r.mismatches.length > 0 || r.world.seq !== now.seq || worldFingerprint(r.world) !== ref.fingerprint) {
          return fail('UNVERIFIED', 'The current world does not replay exactly from its log; a future cannot be started from it.');
        }
        verified = ref;
      }
      return create(now, label, options, false);
    },

    forkFromSnapshot(ref, label, options = {}) {
      let base: World;
      try {
        base = restoreSnapshot(ref, { historyLimit: store.getHistoryLimit() });
      } catch (e) {
        return fail('UNVERIFIED', e instanceof Error ? e.message : 'Snapshot could not be restored.');
      }
      return create(base, label, options, true);
    },

    list: () => [...futures.values()].filter((f) => f.status === 'open').map(view),
    get: (id) => {
      const f = futures.get(id as FutureId);
      return f ? view(f) : null;
    },
    state: (id) => {
      const f = futures.get(id as FutureId);
      return f && f.status === 'open' ? stateOf(f) : null;
    },
    base: (id) => {
      const f = futures.get(id as FutureId);
      return f && f.status === 'open' ? f.base : null;
    },

    apply(id, events, meta) {
      const o = open(id);
      if (!o.ok) return o;
      const f = o.value;
      const label = cleanLabel(meta?.label);
      if (label === null) return fail('INVALID', `A step needs a label of 1 to ${FUTURE_LIMITS.maxLabelLength} plain characters.`);
      if (meta.details !== undefined && !Object.values(meta.details).every((v) => typeof v === 'string')) return fail('INVALID', 'Step details must map text to text.');
      if (f.steps.length >= FUTURE_LIMITS.maxStepsPerFuture) return fail('LIMIT', `A future can hold at most ${FUTURE_LIMITS.maxStepsPerFuture} steps.`);
      if (Array.isArray(events) && eventCount(f) + events.length > FUTURE_LIMITS.maxEventsPerFuture) return fail('LIMIT', `A future can hold at most ${FUTURE_LIMITS.maxEventsPerFuture} events.`);
      const from = stateOf(f);
      const r = tryStep(f, from, events);
      if (!r.ok) return r;
      f.steps.push({ label, ...(meta.details ? { details: { ...meta.details } } : {}), events: [...events], seqBefore: from.seq, seqAfter: r.value.seq });
      f.states.push(r.value);
      f.redo = [];
      return { ok: true, value: view(f) };
    },

    undo(id) {
      const o = open(id);
      if (!o.ok || o.value.steps.length === 0) return false;
      const f = o.value;
      const step = f.steps.pop()!;
      const state = f.states.pop()!;
      f.redo.push({ step, state });
      return true;
    },

    redo(id) {
      const o = open(id);
      if (!o.ok || o.value.redo.length === 0) return false;
      const f = o.value;
      const { step, state } = f.redo.pop()!;
      f.steps.push(step);
      f.states.push(state);
      return true;
    },

    compare(id) {
      const o = open(id);
      if (!o.ok) return o;
      return { ok: true, value: compareOne(o.value) };
    },

    compareAll() {
      const list = [...futures.values()].filter((f) => f.status === 'open').map(compareOne);
      const seen = new Map<EntityId, string>();
      const contested = new Set<EntityId>();
      for (const c of list) {
        const after = stateOf(futures.get(c.future.id)!);
        for (const d of c.comparison.differences) {
          const e = after.entities[d.id];
          const sig = d.change === 'removed' ? 'removed' : JSON.stringify(e);
          const prev = seen.get(d.id);
          if (prev === undefined) seen.set(d.id, sig);
          else if (prev !== sig) contested.add(d.id);
        }
      }
      return { original: stateRef(current()), futures: list, contested: current().order.filter((id) => contested.has(id)).concat([...contested].filter((id) => !current().entities[id])) };
    },

    rebase(id) {
      const o = open(id);
      if (!o.ok) return o;
      const f = o.value;
      if (!isStale(f)) return { ok: true, value: view(f) };
      const now = current();
      // Verify the new base like a fresh fork.
      const replay = replayLog(initial, store.getLog(), { historyLimit: store.getHistoryLimit() });
      if (replay.mismatches.length > 0 || worldFingerprint(replay.world) !== worldFingerprint(now)) {
        return fail('UNVERIFIED', 'The current world does not replay exactly from its log.');
      }
      const trial: FutureRecord = { ...f, base: now, baseRef: stateRef(now), states: [now], steps: [], redo: [] };
      for (const step of f.steps) {
        const from = stateOf(trial);
        const r = tryStep(trial, from, step.events);
        if (!r.ok) return fail(r.code, `Step “${step.label}” no longer applies: ${r.reason}`, r.violations);
        trial.steps.push({ ...step, seqBefore: from.seq, seqAfter: r.value.seq });
        trial.states.push(r.value);
      }
      f.base = trial.base;
      f.baseRef = trial.baseRef;
      f.states = trial.states;
      f.steps = trial.steps;
      f.redo = [];
      return { ok: true, value: view(f) };
    },

    commit(id, options = {}) {
      const o = open(id);
      if (!o.ok) return o;
      const f = o.value;
      if (f.steps.length === 0) return fail('EMPTY', 'This future has no changes to apply.');
      if (isStale(f)) return fail('STALE', 'The world changed after this future was created. Rebase or discard it.');
      const after = stateOf(f);
      const violations = checkPinnedInvariant(f.base, after, pinClosure(f.base).pinned);
      if (violations.length > 0) return fail('PINNED', violations.map((v) => v.message).join(' '), violations);
      const events = f.steps.flatMap((s) => s.events);
      // Dry run against the live state: the result must be exactly the previewed future.
      const dry = applyEvents(current(), events);
      if (!dry.ok || worldFingerprint(dry.world) !== worldFingerprint(after) || dry.world.seq !== after.seq) {
        return fail('REJECTED', 'The future no longer reproduces exactly on the current world.');
      }
      const proposalKeys = f.steps.map((s) => s.details?.proposalKey).filter((k): k is string => typeof k === 'string');
      const label = cleanLabel(options.label) ?? `Future: ${f.label}`.slice(0, 120);
      const result = store.dispatchBatch(events, {
        label,
        source: f.source,
        details: {
          kind: 'future',
          futureId: f.id,
          baseSeq: String(f.baseRef.seq),
          baseFingerprint: f.baseRef.fingerprint,
          futureFingerprint: worldFingerprint(after),
          steps: String(f.steps.length),
          ...(proposalKeys.length > 0 ? { proposalKeys: proposalKeys.join(',') } : {}),
        },
      });
      if (!result.ok) return fail('REJECTED', result.reason);
      f.status = 'committed';
      const done = view(f);
      f.states = [after]; // release intermediate states
      f.redo = [];
      return { ok: true, value: { seq: result.world.seq, future: done } };
    },

    discard,

    dispose() {
      for (const id of [...futures.keys()]) discard(id);
      futures.clear();
    },
  };

  function discard(id: string): boolean {
    const f = futures.get(id as FutureId);
    if (!f || f.status !== 'open') return false;
    f.status = 'discarded';
    f.states = [f.base];
    f.steps = [];
    f.redo = [];
    return true;
  }
}
