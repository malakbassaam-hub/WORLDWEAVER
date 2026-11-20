import { describe, expect, it } from 'vitest';
import { inspectEntry } from '../core/historyView';
import { buildLedger } from '../core/ledger';
import { WorldStore } from '../core/store';
import { buildDemoSession } from '../demo/fixtures';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { causeFacts, effectText, filterCounts, filterRows, formatValue, isNavKey, ledgerDetail, ledgerRows, matchesFilter, nextIndex } from './ledgerModel';

function demo() {
  const s = buildDemoSession('history');
  const view = buildLedger(s.initial, s.store.getLog());
  return { ...s, view, rows: ledgerRows(view) };
}

describe('ledger rows', () => {
  it('has one row per real ledger entry, in log order, with nothing invented', () => {
    const { view, rows, store } = demo();
    expect(rows).toHaveLength(store.getLog().length);
    expect(rows.map((r) => r.index)).toEqual(view.entries.map((e) => e.index));
    expect(rows.map((r) => r.entryId)).toEqual(view.entries.map((e) => e.id));
    expect(rows.map((r) => r.badge)).toEqual(['User', 'Rejected', 'Director', 'User', 'Morph', 'Undo', 'Redo', 'User', 'Undo']);
  });

  it('marks batches with their action count and undo state per entry', () => {
    const { rows } = demo();
    const create = rows[2]!;
    expect(create).toMatchObject({ isBatch: true, labelOrigin: 'model', mode: 'recorded', statusText: 'In effect' });
    expect(create.actionCount).toBeGreaterThan(1);
    expect(rows[7]).toMatchObject({ statusText: 'Undone', inEffect: false });
    expect(rows[5]).toMatchObject({ statusText: 'Applied', inEffect: null });
    expect(rows[1]).toMatchObject({ statusText: 'Rejected', effectText: 'Name must not be empty.' });
    expect(rows[3]!.effectText).toMatch(/1 changed · \d+ derived/);
  });

  it('effect text lists only non-zero counts', () => {
    expect(effectText({ added: 0, removed: 0, changed: 0, derived: 0 })).toBe('No changes');
    expect(effectText({ added: 2, removed: 1, changed: 3, derived: 4 })).toBe('3 changed · 2 added · 1 removed · 4 derived');
  });
});

describe('filters', () => {
  it('filters by changes, AI, undone and problems with matching counts', () => {
    const { rows } = demo();
    const counts = filterCounts(rows);
    expect(counts.all).toBe(rows.length);
    expect(filterRows(rows, 'ai').map((r) => r.badge)).toEqual(['Director', 'Morph']);
    expect(filterRows(rows, 'undone').map((r) => r.index)).toEqual([7]);
    expect(filterRows(rows, 'problems').map((r) => r.index)).toEqual([1]);
    expect(filterRows(rows, 'changes').every((r) => r.status === 'applied' && (r.kind === 'event' || r.kind === 'batch'))).toBe(true);
    for (const f of ['all', 'changes', 'ai', 'undone', 'problems'] as const) expect(counts[f]).toBe(rows.filter((r) => matchesFilter(r, f)).length);
  });

  it('an empty ledger has no rows and zero counts', () => {
    const w = buildCrystalKingdom();
    const rows = ledgerRows(buildLedger(w, []));
    expect(rows).toEqual([]);
    expect(Object.values(filterCounts(rows))).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('keyboard navigation', () => {
  it('moves with arrows, pages, Home and End, clamped to the list', () => {
    expect(nextIndex(5, 2, 'ArrowDown')).toBe(3);
    expect(nextIndex(5, 4, 'ArrowDown')).toBe(4);
    expect(nextIndex(5, 0, 'ArrowUp')).toBe(0);
    expect(nextIndex(5, 2, 'Home')).toBe(0);
    expect(nextIndex(5, 2, 'End')).toBe(4);
    expect(nextIndex(20, 2, 'PageDown')).toBe(7);
    expect(nextIndex(20, 2, 'PageUp')).toBe(0);
    expect(nextIndex(5, -1, 'ArrowDown')).toBe(0);
    expect(nextIndex(5, -1, 'ArrowUp')).toBe(4);
    expect(nextIndex(0, 0, 'ArrowDown')).toBe(-1);
    expect(isNavKey('ArrowDown')).toBe(true);
    expect(isNavKey('Enter')).toBe(false);
  });
});

describe('values', () => {
  it('formats positions, rotations in degrees, colours, visibility, pins, parents and provenance', () => {
    const w = buildCrystalKingdom();
    const parent = w.order[0]!;
    expect(formatValue('transform.position', [1.234, -0.0001, 3])).toBe('(1.23, 0, 3)');
    expect(formatValue('transform.rotation', [0, Math.PI / 2, 0])).toBe('(0°, 90°, 0°)');
    expect(formatValue('visual.color', '#7a5cff')).toBe('#7A5CFF');
    expect(formatValue('visual.visible', false)).toBe('Hidden');
    expect(formatValue('pinned', true)).toBe('Pinned');
    expect(formatValue('parentId', parent, w)).toBe(`“${w.entities[parent]!.name}”`);
    expect(formatValue('parentId', null, w)).toBe('None (world root)');
    expect(formatValue('provenance', { createdBy: 'system', createdAtSeq: 3, lastModifiedBy: 'user', lastModifiedSeq: 28 })).toBe('created by system at #3; last changed by user at #28');
    expect(formatValue('visual.emissiveIntensity', 2.5)).toBe('2.5');
    expect(formatValue('name', undefined)).toBe('—');
    expect(formatValue('unknown', 'x'.repeat(200))).toHaveLength(80);
  });
});

describe('entry detail', () => {
  it('separates recorded facts, observed before/after values and derived consequences', () => {
    const { view, initial, store } = demo();
    const move = ledgerDetail(view, inspectEntry(initial, store.getLog(), view, 3), 3)!;
    expect(move.modelText).toBeNull();
    expect(move.facts).toEqual(['Direct edit by you.']);
    expect(move.observed).toHaveLength(1);
    const pos = move.observed[0]!.fields.find((f) => f.field === 'transform.position')!;
    expect(pos).toMatchObject({ label: 'Position', after: '(-24, 9, 14)' });
    expect(pos.before).not.toBe(pos.after);
    expect(move.derived.length).toBeGreaterThan(0);
    expect(move.derived[0]!.text).toMatch(/moved in the world because its parent chain moved \(via “Veilstone Reach”\)/);
    expect(move.historyNote).toBe('In effect. Undo reverses it.');
  });

  it('shows Director labels as model text and lists batch actions with their seqs', () => {
    const { view, initial, store } = demo();
    const d = ledgerDetail(view, inspectEntry(initial, store.getLog(), view, 4), 4)!;
    expect(d.modelText).toMatch(/^Morph \(recorded\): /);
    expect(d.facts[0]).toBe('World Morph proposal, recorded mode.');
    expect(d.facts.join(' ')).toMatch(/1 pinned entity protected \(policy reject-proposal;ancestors=protected;addToPinned=allowed, approved\)/);
    expect(d.facts.join(' ')).toMatch(/Recorded response: morph-violet-dusk\./);
    expect(d.actions.length).toBeGreaterThan(1);
    d.actions.forEach((a, k) => expect(a.seq).toBe(view.entries[4]!.seqBefore + k + 1));
    expect(d.historyNote).toMatch(/actions undo together as one step/);
    const colour = d.observed.flatMap((e) => e.fields).find((f) => f.field === 'visual.color')!;
    expect(colour.afterColour).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('describes undo and rejected entries truthfully', () => {
    const { view, initial, store } = demo();
    const undo = ledgerDetail(view, inspectEntry(initial, store.getLog(), view, 5), 5)!;
    expect(undo.facts[0]).toMatch(/^Undo of #4 \(Morph \(recorded\): /);
    expect(undo.historyNote).toBeNull();
    const rejected = ledgerDetail(view, inspectEntry(initial, store.getLog(), view, 1), 1)!;
    expect(rejected).toMatchObject({ status: 'Rejected', observed: [], derived: [] });
    expect(rejected.actions[0]!.seq).toBeNull();
    const undone = ledgerDetail(view, inspectEntry(initial, store.getLog(), view, 7), 7)!;
    expect(undone.historyNote).toMatch(/currently undone/);
    expect(ledgerDetail(view, null, 99)).toBeNull();
  });

  it('works without an inspection (no invented values) and for a committed future', () => {
    const { view } = demo();
    const d = ledgerDetail(view, null, 0)!;
    expect(d.observed).toEqual([]);
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    store.dispatchBatch([{ type: 'entity/renamed', id: initial.order[3]!, name: 'F', source: 'director' }], { label: 'Future: x', source: 'director', details: { kind: 'future', futureId: 'future-1', baseSeq: '27', steps: '1', proposalKeys: 'k1' } });
    const v = buildLedger(initial, store.getLog());
    expect(causeFacts(v.entries[0]!, v)).toEqual(['Applied the Parallel Future future-1: 1 step, forked at seq #27.', 'Director proposals: k1.']);
  });
});
