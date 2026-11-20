/**
 * Causal Ledger panel — pure view state (no DOM). Turns the real ledger view
 * (`src/core/ledger.ts`, `historyView.ts`) into rows, filters, keyboard
 * navigation and entry details. Nothing here invents history: every row is a
 * ledger entry and every detail line comes from a recorded, observed or
 * derived field of that entry.
 */
import type { EntryInspection, TimelineBadge } from '../core/historyView';
import { timelineItems, type TimelineItem } from '../core/historyView';
import type { CausalLedgerView, LedgerAction, LedgerEntry } from '../core/ledger';
import type { EntityId, World } from '../core/types';

// ---------------------------------------------------------------- rows

export interface LedgerRow extends TimelineItem {
  readonly kind: LedgerEntry['kind'];
  /** Recorded actions in the entry; > 1 means an atomic batch (one undo step). */
  readonly actionCount: number;
  readonly isBatch: boolean;
  readonly seqAfter: number;
  /** One-line summary of effects, e.g. "2 changed · 1 added · 6 derived". */
  readonly effectText: string;
  readonly statusText: string;
}

export function effectText(counts: TimelineItem['counts']): string {
  const parts: string[] = [];
  if (counts.changed) parts.push(`${counts.changed} changed`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  if (counts.derived) parts.push(`${counts.derived} derived`);
  return parts.length ? parts.join(' · ') : 'No changes';
}

function statusTextOf(item: TimelineItem): string {
  if (item.status === 'malformed') return 'Malformed';
  if (item.status === 'rejected') return 'Rejected';
  if (item.inEffect === false) return 'Undone';
  if (item.inEffect === true) return 'In effect';
  return 'Applied';
}

/** One row per ledger entry, in log order (oldest first). */
export function ledgerRows(view: CausalLedgerView): LedgerRow[] {
  const items = timelineItems(view);
  return items.map((item, i) => {
    const entry = view.entries[i]!;
    return {
      ...item,
      kind: entry.kind,
      actionCount: entry.actions.length,
      isBatch: entry.kind === 'batch',
      seqAfter: entry.seqAfter,
      effectText: item.status === 'applied' ? effectText(item.counts) : (item.reason ?? 'Not applied'),
      statusText: statusTextOf(item),
    };
  });
}

// ---------------------------------------------------------------- filters

export type LedgerFilter = 'all' | 'changes' | 'ai' | 'undone' | 'problems';

export const LEDGER_FILTERS: ReadonlyArray<{ readonly id: LedgerFilter; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'changes', label: 'Changes' },
  { id: 'ai', label: 'AI' },
  { id: 'undone', label: 'Undone' },
  { id: 'problems', label: 'Problems' },
];

const AI_BADGES: ReadonlySet<TimelineBadge> = new Set(['Director', 'Morph']);

export function matchesFilter(row: LedgerRow, filter: LedgerFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'changes':
      return row.status === 'applied' && (row.kind === 'event' || row.kind === 'batch');
    case 'ai':
      return AI_BADGES.has(row.badge) || row.labelOrigin === 'model';
    case 'undone':
      return row.inEffect === false;
    case 'problems':
      return row.status !== 'applied' || row.issues > 0;
  }
}

export function filterRows(rows: readonly LedgerRow[], filter: LedgerFilter): LedgerRow[] {
  return rows.filter((r) => matchesFilter(r, filter));
}

export function filterCounts(rows: readonly LedgerRow[]): Record<LedgerFilter, number> {
  const out = { all: 0, changes: 0, ai: 0, undone: 0, problems: 0 } as Record<LedgerFilter, number>;
  for (const r of rows) for (const f of LEDGER_FILTERS) if (matchesFilter(r, f.id)) out[f.id] += 1;
  return out;
}

// ---------------------------------------------------------------- keyboard

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

export const isNavKey = (key: string): key is NavKey => ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key);

/** Roving-focus target index for a list of `count` items. Returns -1 for an empty list. */
export function nextIndex(count: number, current: number, key: NavKey, page = 5): number {
  if (count <= 0) return -1;
  const at = current < 0 || current >= count ? (key === 'ArrowUp' || key === 'End' || key === 'PageUp' ? count : -1) : current;
  switch (key) {
    case 'ArrowUp':
      return Math.max(0, at - 1);
    case 'ArrowDown':
      return Math.min(count - 1, at + 1);
    case 'PageUp':
      return Math.max(0, at - page);
    case 'PageDown':
      return Math.min(count - 1, at + page);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
  }
}

// ---------------------------------------------------------------- values

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  kind: 'Kind',
  parentId: 'Parent',
  tags: 'Tags',
  pinned: 'Pin',
  'transform.position': 'Position',
  'transform.rotation': 'Rotation',
  'transform.scale': 'Scale',
  'visual.archetype': 'Shape',
  'visual.color': 'Colour',
  'visual.emissive': 'Glow colour',
  'visual.emissiveIntensity': 'Glow',
  'visual.visible': 'Visibility',
  light: 'Light',
  provenance: 'Provenance',
};

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;

const num = (n: number, digits = 2): string => {
  const r = Number(n.toFixed(digits));
  return Object.is(r, -0) ? '0' : String(r);
};

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColour = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

/** Human-readable value of an entity field. `world` resolves parent names. */
export function formatValue(field: string, value: unknown, world?: World): string {
  if (value === undefined) return '—';
  switch (field) {
    case 'parentId':
      return value === null ? 'None (world root)' : `“${world?.entities[value as string]?.name ?? String(value)}”`;
    case 'transform.position':
    case 'transform.scale':
      return Array.isArray(value) ? `(${value.map((n) => num(n as number)).join(', ')})` : String(value);
    case 'transform.rotation':
      return Array.isArray(value) ? `(${value.map((n) => `${num(((n as number) * 180) / Math.PI, 1)}°`).join(', ')})` : String(value);
    case 'visual.color':
    case 'visual.emissive':
      return typeof value === 'string' ? value.toUpperCase() : String(value);
    case 'visual.emissiveIntensity':
      return typeof value === 'number' ? num(value) : String(value);
    case 'visual.visible':
      return value ? 'Shown' : 'Hidden';
    case 'pinned':
      return value ? 'Pinned' : 'Not pinned';
    case 'tags':
      return Array.isArray(value) && value.length ? value.join(', ') : '—';
    case 'provenance': {
      const p = value as { lastModifiedBy?: string; lastModifiedSeq?: number; createdBy?: string; createdAtSeq?: number };
      return `created by ${p.createdBy ?? '?'} at #${p.createdAtSeq ?? '?'}; last changed by ${p.lastModifiedBy ?? '?'} at #${p.lastModifiedSeq ?? '?'}`;
    }
    case 'light': {
      const l = value as { intensity?: number; range?: number; color?: string } | null;
      return l ? `intensity ${num(l.intensity ?? 0)} · range ${num(l.range ?? 0)} · ${(l.color ?? '').toUpperCase()}` : '—';
    }
    default: {
      const s = typeof value === 'string' ? value : JSON.stringify(value);
      return s.length > 80 ? `${s.slice(0, 79)}…` : s;
    }
  }
}

// ---------------------------------------------------------------- detail

const SOURCE_NAME = { user: 'you', system: 'the system', director: 'the AI Director' } as const;

export interface DetailField {
  readonly field: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** Raw colours (validated hex) for swatches, if the field is a colour. */
  readonly beforeColour?: string;
  readonly afterColour?: string;
}

export interface DetailEntity {
  readonly id: EntityId;
  readonly name: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly fields: readonly DetailField[];
}

export interface LedgerDetail {
  readonly entryId: string;
  readonly index: number;
  readonly badge: TimelineBadge;
  readonly title: string;
  /** Model-written label text, shown as unverified model text. Null for engine and user text. */
  readonly modelText: string | null;
  /** RECORDED facts about the cause, as plain sentences. */
  readonly facts: readonly string[];
  /** RECORDED actions, in order. */
  readonly actions: ReadonlyArray<{ readonly id: string; readonly text: string; readonly seq: number | null }>;
  /** OBSERVED changes. */
  readonly observed: readonly DetailEntity[];
  /** DERIVED consequences (engine rules). */
  readonly derived: ReadonlyArray<{ readonly id: EntityId; readonly name: string; readonly text: string }>;
  readonly issues: readonly string[];
  readonly status: string;
  /** Undo/redo guidance for this entry. */
  readonly historyNote: string | null;
  readonly stateLine: string;
}

function actionText(a: LedgerAction, nameOf: (id: EntityId) => string): string {
  const n = nameOf(a.target);
  switch (a.type) {
    case 'entity/added':
      return `Add ${n}`;
    case 'entity/removed':
      return `Remove ${n}`;
    case 'entity/renamed':
      return `Rename ${n}`;
    case 'entity/transformed':
      return `Move or transform ${n}`;
    case 'entity/visualChanged':
      return `Change the appearance of ${n}`;
    case 'entity/pinnedChanged':
      return `Pin or unpin ${n}`;
  }
}

/** Recorded cause facts. Only fields present in the ledger entry. */
export function causeFacts(entry: LedgerEntry, view: CausalLedgerView): string[] {
  const c = entry.cause;
  const ref = (i: number) => (i >= 0 && view.entries[i] ? `#${i} (${view.entries[i]!.summary})` : 'an earlier entry');
  switch (c.type) {
    case 'event':
      return [`Direct edit by ${SOURCE_NAME[c.source]}.`];
    case 'batch':
      return [`Batch applied by ${SOURCE_NAME[c.source]} as one step.`];
    case 'proposal': {
      const facts = [`${c.kind === 'morph' ? 'World Morph' : c.kind === 'unspecified' ? 'Director' : `Director ${c.kind}`} proposal, ${c.mode} mode.`];
      if (c.recordingId) facts.push(`Recorded response: ${c.recordingId}.`);
      if (c.requestId) facts.push(`Request ${c.requestId}.`);
      if (c.details.model) facts.push(`Model ${c.details.model}.`);
      if (c.kind === 'morph' && c.details.pinnedCount) facts.push(`${c.details.pinnedCount} pinned entit${c.details.pinnedCount === '1' ? 'y' : 'ies'} protected (policy ${c.details.policy ?? 'unknown'}${c.details.policyApproved === 'true' ? ', approved' : ''}).`);
      facts.push(`Proposal key ${c.proposalKey}.`);
      return facts;
    }
    case 'future':
      return [`Applied the Parallel Future ${c.futureId}: ${c.steps} step${c.steps === 1 ? '' : 's'}, forked at seq #${c.baseSeq}.`, ...(c.details.proposalKeys ? [`Director proposals: ${c.details.proposalKeys}.`] : [])];
    case 'undo':
      return [`Undo of ${ref(c.reverses)}.`];
    case 'redo':
      return [`Redo of ${ref(c.reapplies)}.`];
    case 'unknown':
      return ['No recorded cause (malformed entry).'];
  }
}

const RULE_TEXT = { 'inherited-world-pose': 'moved in the world because its parent chain moved', 'inherited-visibility': 'visibility follows a parent that was shown or hidden' } as const;

export function ledgerDetail(view: CausalLedgerView, inspection: EntryInspection | null, index: number): LedgerDetail | null {
  const entry = view.entries[index];
  if (!entry) return null;
  const row = ledgerRows(view)[index]!;
  const before = inspection?.before;
  const after = inspection?.after;
  const nameOf = (id: EntityId) => `“${after?.entities[id]?.name ?? before?.entities[id]?.name ?? id}”`;
  const observed: DetailEntity[] = (inspection?.entities ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    change: e.change,
    fields: e.fields.map((f) => ({
      field: f.field,
      label: fieldLabel(f.field),
      before: formatValue(f.field, f.before, before),
      after: formatValue(f.field, f.after, after),
      ...(isHexColour(f.before) ? { beforeColour: f.before } : {}),
      ...(isHexColour(f.after) ? { afterColour: f.after } : {}),
    })),
  }));
  const historyNote =
    entry.status !== 'applied' ? null
    : entry.kind === 'undo' || entry.kind === 'redo' ? null
    : row.inEffect === false ? 'This change is currently undone. Redo re-applies it if nothing else has changed since.'
    : `In effect. ${entry.actions.length > 1 ? `Its ${entry.actions.length} actions undo together as one step.` : 'Undo reverses it.'}`;
  return {
    entryId: entry.id,
    index,
    badge: row.badge,
    title: entry.summary || (entry.status === 'malformed' ? 'Malformed entry' : 'Untitled entry'),
    modelText: entry.summaryOrigin === 'model' ? entry.summary : null,
    facts: causeFacts(entry, view),
    actions: entry.actions.map((a) => ({ id: a.id, text: actionText(a, nameOf), seq: a.seq })),
    observed,
    derived: (inspection?.derived ?? []).map((d) => ({ id: d.id, name: d.name, text: `${RULE_TEXT[d.rule]} (via “${d.viaName}”)` })),
    issues: entry.issues,
    status: row.statusText,
    historyNote,
    stateLine: `seq #${entry.seqBefore} → #${entry.seqAfter} · state ${entry.before.fingerprint.slice(0, 8)} → ${entry.after.fingerprint.slice(0, 8)}`,
  };
}
