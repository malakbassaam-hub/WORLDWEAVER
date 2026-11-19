/**
 * Causal Ledger (docs/architecture/CAUSAL_LEDGER.md).
 *
 * A deterministic, inspectable projection of the WorldStore log. The store log
 * stays the single source of truth; the ledger adds stable entry IDs, a hash
 * chain, before/after state references, exact field-level effects and a
 * strict separation between three kinds of statement:
 *
 *   recorded  what the log says happened: the actions (events) of an entry
 *             and its cause (source, proposal metadata, undo/redo target);
 *   observed  what changed, computed exactly by comparing the world before and
 *             after the entry (`changes`, `effects`);
 *   derived   consequences that follow from fixed engine rules, never from a
 *             model: a child's world pose and effective visibility follow its
 *             ancestors (`consequences`, rule names in `DerivedRule`).
 *
 * Nothing is inferred beyond these. Model text (Director summaries) is kept
 * only as a label marked `summaryOrigin: 'model'`, never as an explanation.
 * Prompt text is never stored.
 *
 * Memory: entries hold IDs, field names and fingerprints, never World
 * objects. A state is materialised on demand by replay (`restoreSnapshot` in
 * futures.ts). The hash chain is NOT cryptographic (see fingerprint.ts).
 *
 * Not implemented here: persistence (WW-016) and UI (Kilo Code).
 */
import { canonical, fingerprint, stateRef, type StateRef } from './fingerprint';
import { effectiveVisible, posesEqual, worldPose } from './pose';
import { WorldStore, type LogEntry } from './store';
import type { Entity, EntityId, EventSource, World, WorldEvent } from './types';
import { checkLogEntryShape } from './wellformed';

export type { StateRef } from './fingerprint';

export type LedgerEntryId = string & { readonly __brand: 'LedgerEntryId' };

export const LEDGER_FORMAT = 'worldweaver-ledger-v1';

// ---------------------------------------------------------------- types

/** RECORDED: why the entry exists, as stated by the log. */
export type LedgerCause =
  | { readonly type: 'event'; readonly source: EventSource }
  | {
      readonly type: 'proposal';
      readonly source: EventSource;
      readonly proposalKey: string;
      readonly kind: string;
      readonly mode: string;
      readonly requestId?: string;
      readonly recordingId?: string;
      /** Batch details as logged (never secrets or prompt text). */
      readonly details: Readonly<Record<string, string>>;
    }
  | {
      readonly type: 'future';
      readonly source: EventSource;
      readonly futureId: string;
      readonly baseSeq: number;
      readonly steps: number;
      readonly details: Readonly<Record<string, string>>;
    }
  | { readonly type: 'batch'; readonly source: EventSource; readonly details: Readonly<Record<string, string>> }
  | { readonly type: 'undo'; readonly reverses: number; readonly reversesId: LedgerEntryId | null }
  | { readonly type: 'redo'; readonly reapplies: number; readonly reappliesId: LedgerEntryId | null }
  | { readonly type: 'unknown' };

/** RECORDED: one event of an entry. The payload itself stays in the store log. */
export interface LedgerAction {
  /** `<log index in base 36>/<n>`, stable for the same log. */
  readonly id: string;
  readonly type: WorldEvent['type'];
  readonly target: EntityId;
  readonly source: EventSource;
  /** Seq this event produced, or null if the entry was rejected. */
  readonly seq: number | null;
  /** Fingerprint of the canonical event payload. */
  readonly payload: string;
}

/** OBSERVED: an exact difference between the world before and after. */
export interface EntityChange {
  readonly id: EntityId;
  readonly change: 'added' | 'removed' | 'changed';
  /** Changed fields, e.g. `name`, `transform.position`, `visual.color`. Empty for added/removed. */
  readonly fields: readonly string[];
  /** IDs of recorded actions in this entry that targeted the entity. Empty for undo/redo. */
  readonly recordedBy: readonly string[];
}

export type DerivedRule = 'inherited-world-pose' | 'inherited-visibility';

/**
 * DERIVED: an entity whose own data did not change but whose world pose or
 * effective visibility did, because an ancestor changed (fixed engine rules,
 * see pose.ts). `via` is the nearest changed ancestor.
 */
export interface DerivedConsequence {
  readonly id: EntityId;
  readonly rule: DerivedRule;
  readonly via: EntityId;
  readonly basis: 'derived';
}

export interface LedgerEffects {
  readonly added: readonly EntityId[];
  readonly removed: readonly EntityId[];
  readonly changed: readonly EntityId[];
}

export interface LedgerEntry {
  readonly id: LedgerEntryId;
  /** Index of the source log entry. */
  readonly index: number;
  readonly kind: LogEntry['kind'] | 'malformed';
  readonly status: 'applied' | 'rejected' | 'malformed';
  /** Same as `status === 'applied'`. */
  readonly accepted: boolean;
  readonly summary: string;
  /** Who wrote `summary`: the engine, the user, or a model (unverified text). */
  readonly summaryOrigin: 'engine' | 'user' | 'model';
  readonly reason?: string;
  readonly seqBefore: number;
  readonly seqAfter: number;
  readonly before: StateRef;
  readonly after: StateRef;
  readonly cause: LedgerCause;
  readonly actions: readonly LedgerAction[];
  /** Observed entity IDs; empty for rejected and malformed entries. */
  readonly effects: LedgerEffects;
  readonly changes: readonly EntityChange[];
  readonly consequences: readonly DerivedConsequence[];
  /** Integrity notes: malformed input, replay mismatches, unexplained changes. */
  readonly issues: readonly string[];
  readonly prevHash: string;
  readonly hash: string;
}

export interface LedgerIssue {
  readonly index: number;
  readonly message: string;
}

export interface CausalLedgerView {
  readonly format: typeof LEDGER_FORMAT;
  /** Hash binding the chain to the initial world. */
  readonly genesis: string;
  readonly entries: readonly LedgerEntry[];
  /** Hash of the last entry (or `genesis`). */
  readonly head: string;
  readonly initial: StateRef;
  readonly final: StateRef;
  /** Indices of applied change entries (event/batch) not currently undone, oldest first. */
  readonly inEffect: readonly number[];
  /** True if every entry was well formed and replayed exactly as recorded. */
  readonly consistent: boolean;
  readonly issues: readonly LedgerIssue[];
}

// ---------------------------------------------------------------- diff

const NO_EFFECTS: LedgerEffects = Object.freeze({ added: [], removed: [], changed: [] });

const FIELD_GETTERS: ReadonlyArray<readonly [string, (e: Entity) => unknown]> = [
  ['name', (e) => e.name],
  ['kind', (e) => e.kind],
  ['parentId', (e) => e.parentId],
  ['tags', (e) => e.tags],
  ['pinned', (e) => e.pinned],
  ['transform.position', (e) => e.components.transform.position],
  ['transform.rotation', (e) => e.components.transform.rotation],
  ['transform.scale', (e) => e.components.transform.scale],
  ['visual.archetype', (e) => e.components.visual?.archetype],
  ['visual.color', (e) => e.components.visual?.color?.toLowerCase()],
  ['visual.emissive', (e) => e.components.visual?.emissive?.toLowerCase()],
  ['visual.emissiveIntensity', (e) => e.components.visual?.emissiveIntensity],
  ['visual.visible', (e) => e.components.visual?.visible],
  ['light', (e) => e.components.light],
  ['provenance', (e) => e.provenance],
];

/** Names of the fields that differ between two versions of one entity. */
export function changedFields(a: Entity, b: Entity): string[] {
  if (a === b) return [];
  const out: string[] = [];
  for (const [field, get] of FIELD_GETTERS) {
    const x = get(a);
    const y = get(b);
    if (x !== y && canonical(x) !== canonical(y)) out.push(field);
  }
  return out;
}

/** Exact entity-level changes from `before` to `after`, in world order (removed last). */
export function entityChanges(before: World, after: World): Array<Omit<EntityChange, 'recordedBy'>> {
  const out: Array<Omit<EntityChange, 'recordedBy'>> = [];
  if (before.entities === after.entities && before.order === after.order) return out;
  for (const id of after.order) {
    const b = before.entities[id];
    const a = after.entities[id]!;
    if (!b) out.push({ id, change: 'added', fields: [] });
    else if (b !== a) {
      const fields = changedFields(b, a);
      if (fields.length > 0) out.push({ id, change: 'changed', fields });
    }
  }
  for (const id of before.order) if (!after.entities[id]) out.push({ id, change: 'removed', fields: [] });
  return out;
}

export function diffWorlds(before: World, after: World): LedgerEffects {
  const added: EntityId[] = [];
  const removed: EntityId[] = [];
  const changed: EntityId[] = [];
  for (const c of entityChanges(before, after)) (c.change === 'added' ? added : c.change === 'removed' ? removed : changed).push(c.id);
  return { added, removed, changed };
}

const INHERITED = new Set(['parentId', 'transform.position', 'transform.rotation', 'visual.visible']);

/** DERIVED consequences of `changes` for descendants whose own data did not change. */
export function derivedConsequences(before: World, after: World, changes: ReadonlyArray<Omit<EntityChange, 'recordedBy'>>): DerivedConsequence[] {
  const roots = changes.filter((c) => c.change === 'changed' && c.fields.some((f) => INHERITED.has(f))).map((c) => c.id);
  if (roots.length === 0) return [];
  const touched = new Set(changes.map((c) => c.id));
  const children = new Map<EntityId, EntityId[]>();
  for (const id of after.order) {
    const p = after.entities[id]?.parentId;
    if (p) (children.get(p) ?? children.set(p, []).get(p)!).push(id);
  }
  const out: DerivedConsequence[] = [];
  const seen = new Set<EntityId>();
  const visit = (id: EntityId, via: EntityId) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      // A descendant that changed itself is attributed to its own change; its subtree is attributed to it.
      const nextVia = touched.has(child) ? child : via;
      if (!touched.has(child) && before.entities[child]) {
        const pa = worldPose(before, child);
        const pb = worldPose(after, child);
        if (pa && pb && !posesEqual(pa, pb)) out.push({ id: child, rule: 'inherited-world-pose', via, basis: 'derived' });
        if (effectiveVisible(before, child) !== effectiveVisible(after, child)) out.push({ id: child, rule: 'inherited-visibility', via, basis: 'derived' });
      }
      visit(child, nextVia);
    }
  };
  for (const root of roots) {
    seen.add(root);
    visit(root, root);
  }
  return out;
}

// ---------------------------------------------------------------- hashing

export function genesisHash(initial: StateRef): string {
  return fingerprint(`${LEDGER_FORMAT}\n${initial.fingerprint}`);
}

type EntryBody = Omit<LedgerEntry, 'id' | 'hash'>;

function hashEntry(body: EntryBody): string {
  return fingerprint(`${body.prevHash}\n${canonical(body)}`);
}

function entryId(index: number, hash: string): LedgerEntryId {
  return `le-${index.toString(36)}-${hash.slice(0, 8)}` as LedgerEntryId;
}

/** Recomputes every hash and ID. Detects any edit to any entry, or reordering. */
export function verifyLedgerChain(view: Pick<CausalLedgerView, 'genesis' | 'entries' | 'head'>): { readonly ok: true } | { readonly ok: false; readonly brokenAt: number; readonly reason: string } {
  let prev = view.genesis;
  for (let i = 0; i < view.entries.length; i++) {
    const e = view.entries[i]!;
    const { id, hash, ...body } = e;
    if (e.index !== i) return { ok: false, brokenAt: i, reason: 'Entry index does not match its position.' };
    if (body.prevHash !== prev) return { ok: false, brokenAt: i, reason: 'Entry does not link to the previous entry.' };
    const expected = hashEntry(body);
    if (hash !== expected) return { ok: false, brokenAt: i, reason: 'Entry content does not match its hash.' };
    if (id !== entryId(i, expected)) return { ok: false, brokenAt: i, reason: 'Entry ID does not match its hash.' };
    prev = hash;
  }
  if (view.head !== prev) return { ok: false, brokenAt: view.entries.length, reason: 'Head does not match the last entry.' };
  return { ok: true };
}

// ---------------------------------------------------------------- builder

function eventTarget(event: WorldEvent): EntityId {
  return event.type === 'entity/added' ? event.entity.id : event.id;
}

function causeOf(entry: LogEntry): LedgerCause {
  switch (entry.kind) {
    case 'event':
      return { type: 'event', source: entry.event!.source };
    case 'batch': {
      const meta = entry.meta!;
      const d = { ...(meta.details ?? {}) };
      if (d.kind === 'future') {
        return { type: 'future', source: meta.source, futureId: d.futureId ?? '', baseSeq: Number(d.baseSeq ?? -1), steps: Number(d.steps ?? 0), details: d };
      }
      if (d.proposalKey !== undefined) {
        return {
          type: 'proposal',
          source: meta.source,
          proposalKey: d.proposalKey,
          kind: d.kind ?? 'unspecified',
          mode: d.mode ?? 'unknown',
          ...(d.requestId ? { requestId: d.requestId } : {}),
          ...(d.recordingId ? { recordingId: d.recordingId } : {}),
          details: d,
        };
      }
      return { type: 'batch', source: meta.source, details: d };
    }
    default:
      return { type: 'unknown' }; // undo/redo causes are filled in by the builder
  }
}

function summaryOrigin(entry: LogEntry): LedgerEntry['summaryOrigin'] {
  if (entry.kind !== 'batch') return 'engine';
  const source = entry.meta?.source;
  return source === 'director' ? 'model' : source === 'user' ? 'user' : 'engine';
}

/**
 * Incremental ledger builder. Mirrors WorldStore undo/redo bookkeeping
 * exactly (history limit included) so undo/redo targets are recorded facts.
 */
class LedgerBuilder {
  readonly entries: LedgerEntry[] = [];
  readonly issues: LedgerIssue[] = [];
  readonly genesis: string;
  readonly initial: StateRef;
  private past: number[] = [];
  private future: number[] = [];
  private readonly undone = new Set<number>();
  private applied: number[] = [];
  private last: StateRef;

  constructor(initial: World, private readonly limit: number) {
    this.initial = stateRef(initial);
    this.genesis = genesisHash(this.initial);
    this.last = this.initial;
  }

  get head(): string {
    return this.entries.at(-1)?.hash ?? this.genesis;
  }

  get final(): StateRef {
    return this.last;
  }

  inEffect(): number[] {
    return this.applied.filter((i) => !this.undone.has(i));
  }

  /**
   * Records one log entry. `raw` may be malformed (then `problem` is set and
   * `before === after`). `ok` is the outcome actually observed.
   */
  record(raw: unknown, index: number, before: World, after: World, ok: boolean, problem: string | null, extraIssues: readonly string[]): LedgerEntry {
    const issues = [...extraIssues];
    const beforeRef = this.last.seq === before.seq ? this.last : stateRef(before);
    const afterRef = before === after ? beforeRef : stateRef(after);
    let body: EntryBody;

    if (problem !== null) {
      issues.unshift(`Malformed log entry: ${problem}.`);
      body = {
        index, kind: 'malformed', status: 'malformed', accepted: false,
        summary: 'Malformed entry', summaryOrigin: 'engine',
        seqBefore: before.seq, seqAfter: after.seq, before: beforeRef, after: afterRef,
        cause: { type: 'unknown' }, actions: [], effects: NO_EFFECTS, changes: [], consequences: [],
        issues, prevHash: this.head,
      };
    } else {
      const entry = raw as LogEntry;
      let cause = causeOf(entry);
      if (entry.kind === 'undo' || entry.kind === 'redo') {
        const target = ok ? (entry.kind === 'undo' ? this.past.at(-1) : this.future.at(-1)) ?? -1 : -1;
        const targetId = target >= 0 ? (this.entries[target]?.id ?? null) : null;
        cause = entry.kind === 'undo' ? { type: 'undo', reverses: target, reversesId: targetId } : { type: 'redo', reapplies: target, reappliesId: targetId };
      }
      const events: readonly WorldEvent[] = entry.kind === 'event' ? [entry.event!] : entry.kind === 'batch' ? entry.events! : [];
      const actions: LedgerAction[] = events.map((event, k) => ({
        id: `${index.toString(36)}/${k}`,
        type: event.type,
        target: eventTarget(event),
        source: event.source,
        seq: ok ? before.seq + k + 1 : null,
        payload: fingerprint(canonical(event)),
      }));
      const observed = ok ? entityChanges(before, after) : [];
      const changes: EntityChange[] = observed.map((c) => ({ ...c, recordedBy: actions.filter((a) => a.target === c.id).map((a) => a.id) }));
      if (entry.kind === 'event' || entry.kind === 'batch') {
        for (const c of changes) if (c.recordedBy.length === 0) issues.push(`Observed change to ${c.id} has no recorded action.`);
      }
      const effects = ok ? { added: changes.filter((c) => c.change === 'added').map((c) => c.id), removed: changes.filter((c) => c.change === 'removed').map((c) => c.id), changed: changes.filter((c) => c.change === 'changed').map((c) => c.id) } : NO_EFFECTS;
      body = {
        index, kind: entry.kind, status: ok ? 'applied' : 'rejected', accepted: ok,
        summary: typeof entry.summary === 'string' ? entry.summary : '', summaryOrigin: summaryOrigin(entry),
        ...(!ok && typeof entry.reason === 'string' ? { reason: entry.reason } : {}),
        seqBefore: before.seq, seqAfter: after.seq, before: beforeRef, after: afterRef,
        cause, actions, effects, changes,
        consequences: ok ? derivedConsequences(before, after, observed) : [],
        issues, prevHash: this.head,
      };
      this.track(entry.kind, index, ok);
    }

    const hash = hashEntry(body);
    const done: LedgerEntry = { id: entryId(index, hash), ...body, hash };
    this.entries.push(done);
    for (const message of issues) this.issues.push({ index, message });
    this.last = afterRef;
    return done;
  }

  private track(kind: LogEntry['kind'], index: number, ok: boolean): void {
    if (!ok) return;
    if (kind === 'event' || kind === 'batch') {
      this.past.push(index);
      if (this.past.length > this.limit) this.past.shift();
      this.future = []; // discarded redo targets stay in `undone`
      this.applied.push(index);
    } else if (kind === 'undo') {
      const t = this.past.pop();
      if (t !== undefined) {
        this.future.push(t);
        this.undone.add(t);
      }
    } else {
      const t = this.future.pop();
      if (t !== undefined) {
        this.past.push(t);
        this.undone.delete(t);
      }
    }
  }

  view(): CausalLedgerView {
    return {
      format: LEDGER_FORMAT,
      genesis: this.genesis,
      entries: [...this.entries],
      head: this.head,
      initial: this.initial,
      final: this.final,
      inEffect: this.inEffect(),
      consistent: this.issues.length === 0,
      issues: [...this.issues],
    };
  }
}

// ---------------------------------------------------------------- public API

export interface LedgerOptions {
  readonly historyLimit?: number;
}

/**
 * Builds the ledger by replaying `log` from `initial` in a fresh store.
 * Never throws: malformed entries are recorded as `malformed` and change
 * nothing; outcomes that differ from the recorded ones are listed as issues.
 */
export function buildLedger(initial: World, log: readonly unknown[], options: LedgerOptions = {}): CausalLedgerView {
  const store = new WorldStore(initial, options);
  const builder = new LedgerBuilder(initial, store.getHistoryLimit());
  log.forEach((raw, index) => ingest(builder, store, raw, index));
  return builder.view();
}

/** Replays one (possibly malformed) log entry in `store` and records it. */
function ingest(builder: LedgerBuilder, store: WorldStore, raw: unknown, index: number): void {
  const before = store.getState();
  const problem = checkLogEntryShape(raw);
  const issues: string[] = [];
  let ok = false;
  if (problem === null) {
    const entry = raw as LogEntry;
    switch (entry.kind) {
      case 'event':
        ok = store.dispatch(entry.event!).ok;
        break;
      case 'batch':
        ok = store.dispatchBatch(entry.events!, entry.meta!).ok;
        break;
      case 'undo':
        ok = store.undo();
        break;
      case 'redo':
        ok = store.redo();
        break;
    }
    if (entry.index !== index) issues.push(`Recorded index ${String(entry.index)} does not match position ${index}.`);
    if (ok !== entry.ok) issues.push(`Replay ${ok ? 'applied' : 'rejected'} an entry recorded as ${entry.ok ? 'applied' : 'rejected'}.`);
    if (entry.worldSeq !== store.getState().seq) issues.push(`Recorded world seq ${String(entry.worldSeq)}, replay produced ${store.getState().seq}.`);
  }
  builder.record(raw, index, before, store.getState(), ok, problem, issues);
}

/** Ledger entries only (compatibility with the Phase 3 reference projection). */
export function deriveLedgerEntries(initial: World, log: readonly LogEntry[], options: LedgerOptions = {}): LedgerEntry[] {
  return [...buildLedger(initial, log, options).entries];
}

/** Rebuilds the ledger from the log and compares it with a stored one, entry by entry. */
export function verifyLedgerAgainstLog(initial: World, log: readonly unknown[], stored: Pick<CausalLedgerView, 'genesis' | 'entries' | 'head'>, options: LedgerOptions = {}): { readonly ok: true } | { readonly ok: false; readonly firstDifference: number; readonly reason: string } {
  const chain = verifyLedgerChain(stored);
  if (!chain.ok) return { ok: false, firstDifference: chain.brokenAt, reason: chain.reason };
  const rebuilt = buildLedger(initial, log, options);
  if (rebuilt.genesis !== stored.genesis) return { ok: false, firstDifference: -1, reason: 'The ledger belongs to a different initial world.' };
  const n = Math.max(rebuilt.entries.length, stored.entries.length);
  for (let i = 0; i < n; i++) {
    if (rebuilt.entries[i]?.hash !== stored.entries[i]?.hash) return { ok: false, firstDifference: i, reason: 'The ledger does not match the log at this entry.' };
  }
  return { ok: true };
}

/** Accepted entries whose observed effects touched `id`, oldest first. Recorded and observed facts only. */
export function explainEntity(entries: readonly LedgerEntry[], id: EntityId): LedgerEntry[] {
  return entries.filter((e) => e.accepted && e.changes.some((c) => c.id === id));
}

export interface EntityTraceStep {
  readonly entryId: LedgerEntryId;
  readonly index: number;
  readonly relation: 'direct' | 'derived';
  readonly kind: LedgerEntry['kind'];
  readonly summary: string;
  readonly change?: EntityChange['change'];
  readonly fields?: readonly string[];
  readonly rule?: DerivedRule;
  readonly via?: EntityId;
  /** For event/batch entries: whether the change is currently in effect (not undone). */
  readonly inEffect: boolean | null;
}

/**
 * Everything the ledger can state about one entity, oldest first: direct
 * observed changes and derived consequences (marked as such).
 */
export function traceEntity(view: Pick<CausalLedgerView, 'entries' | 'inEffect'>, id: EntityId): EntityTraceStep[] {
  const live = new Set(view.inEffect);
  const out: EntityTraceStep[] = [];
  for (const e of view.entries) {
    if (!e.accepted) continue;
    const inEffect = e.kind === 'event' || e.kind === 'batch' ? live.has(e.index) : null;
    const base = { entryId: e.id, index: e.index, kind: e.kind, summary: e.summary, inEffect };
    const c = e.changes.find((x) => x.id === id);
    if (c) out.push({ ...base, relation: 'direct', change: c.change, fields: c.fields });
    for (const d of e.consequences) if (d.id === id) out.push({ ...base, relation: 'derived', rule: d.rule, via: d.via });
  }
  return out;
}

// ---------------------------------------------------------------- live recorder

export interface LedgerRecorder {
  view(): CausalLedgerView;
  entries(): readonly LedgerEntry[];
  head(): string;
  /** Stops listening to the store. */
  dispose(): void;
}

/**
 * Records ledger entries live as the store changes, without replaying the
 * whole log each time. `initial` must be the world the store started from;
 * an existing log is ingested by replay first. Produces exactly the same
 * entries as `buildLedger(initial, store.getLog())` (tested).
 */
export function createLedgerRecorder(initial: World, store: WorldStore): LedgerRecorder {
  const builder = new LedgerBuilder(initial, store.getHistoryLimit());
  const existing = store.getLog();
  if (existing.length > 0) {
    // Ingest the existing log by replay so undo/redo bookkeeping is primed exactly.
    const replayStore = new WorldStore(initial, { historyLimit: store.getHistoryLimit() });
    existing.forEach((entry, index) => ingest(builder, replayStore, entry, index));
    if (stateRef(replayStore.getState()).fingerprint !== stateRef(store.getState()).fingerprint) {
      builder.issues.push({ index: existing.length - 1, message: 'The existing log does not reproduce the store state from this initial world.' });
    }
  }
  let previous = store.getState();
  let processed = existing.length;
  const unsubscribe = store.subscribe((world, log) => {
    // WorldStore appends exactly one entry per emit.
    while (processed < log.length) {
      const entry = log[processed]!;
      const isLast = processed === log.length - 1;
      const issues = isLast ? [] : ['Several log entries arrived in one notification; intermediate state unknown.'];
      builder.record(entry, processed, previous, isLast ? world : previous, entry.ok, checkLogEntryShape(entry), issues);
      processed += 1;
    }
    previous = world;
  });
  return {
    view: () => builder.view(),
    entries: () => builder.entries,
    head: () => builder.head,
    dispose: unsubscribe,
  };
}
