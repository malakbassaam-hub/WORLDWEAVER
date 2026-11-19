import { describe, expect, it } from 'vitest';
import { buildLedger } from '../core/ledger';
import { WorldStore } from '../core/store';
import { asEntityId } from '../core/types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import {
  admitCharacterTurn,
  CHARACTER_KIND,
  CHARACTER_LIMITS,
  charactersExposedToMorph,
  groundMemories,
  memoriesForContext,
  memoriesForFuture,
  memoryId,
  validateMemory,
  type CharacterState,
} from './characters';

const CHAR = asEntityId('ck:character-001');

describe('Living Characters boundary', () => {
  it('admits a valid reply and translates a proposal for review without applying it', () => {
    const world = buildCrystalKingdom();
    const r = admitCharacterTurn(world, {
      reply: 'أهلاً! I will light a lantern by the spire.',
      proposal: { summary: 'A lantern.', operations: [{ op: 'add', archetype: 'lightOrb', name: 'Lantern', placement: 'near-target', target: 'e4' }] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.translation?.applicable).toBe(true);
    expect(r.translation?.events.every((e) => e.source === 'director')).toBe(true);
    expect(world.order).toHaveLength(27); // nothing applied
  });

  it('a character cannot change pinned entities (same translator rules)', () => {
    const r = admitCharacterTurn(buildCrystalKingdom(), { reply: 'Let me repaint the citadel.', proposal: { summary: 'Repaint.', operations: [{ op: 'recolor', target: 'e2', palette: 'Orchid Flare' }] } });
    expect(r.ok && r.translation?.applicable).toBe(false);
  });

  it('rejects hostile or malformed turns with path-qualified errors', () => {
    const world = buildCrystalKingdom();
    const bad = [
      { reply: 42 },
      { reply: '' },
      { reply: 'x'.repeat(CHARACTER_LIMITS.maxReplyChars + 1) },
      { reply: 'hi\u202Ethere' },
      { reply: 'ok', proposal: { summary: 'x', operations: [{ op: 'exec', target: 'e1' }], code: 'process.exit(1)' } },
    ];
    for (const turn of bad) {
      const r = admitCharacterTurn(world, turn);
      expect(r.ok, JSON.stringify(turn).slice(0, 60)).toBe(false);
    }
    const r = admitCharacterTurn(world, bad[4]!);
    expect(!r.ok && r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['proposal.code', 'proposal.operations[0].op']));
  });

  it('memories must be grounded in an accepted log entry', () => {
    const store = new WorldStore(buildCrystalKingdom());
    const spire = Object.values(store.getState().entities).find((e) => e.name === 'Sentinel Spire I')!;
    store.dispatch({ type: 'entity/renamed', id: spire.id, name: 'Named by a friend', source: 'user' });
    store.dispatch({ type: 'entity/renamed', id: spire.id, name: '', source: 'user' }); // rejected
    const accepted = store.getLog()[0]!.worldSeq;
    const rejected = store.getLog()[1]!.worldSeq;
    expect(validateMemory({ id: 'm1', characterId: CHAR, text: 'They renamed the spire.', causedBySeq: accepted }, store.getLog())).toEqual([]);
    expect(validateMemory({ id: 'm2', characterId: CHAR, text: 'Made up.', causedBySeq: 9999 }, store.getLog())[0]?.code).toBe('invalid_ref');
    // A rejected entry has the same worldSeq as the state before it; only accepted changes count.
    expect(rejected).toBe(accepted);
    expect(validateMemory({ id: 'm3', characterId: CHAR, text: '', causedBySeq: accepted }, store.getLog())[0]?.code).toBe('out_of_range');
  });

  it('grounds memories in the Causal Ledger: undone changes and unknown seqs are excluded from context', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const spire = initial.order[4]!;
    store.dispatch({ type: 'entity/renamed', id: spire, name: 'Kept', source: 'user' }); // seq 28, stays
    store.dispatch({ type: 'entity/renamed', id: spire, name: 'Undone', source: 'user' }); // seq 29, undone below
    const kept = store.getState().seq - 1;
    const undone = store.getState().seq;
    store.undo();
    const state: CharacterState = {
      characterId: CHAR,
      persona: { displayName: 'Lumen', traits: [] },
      memories: [
        { id: memoryId(CHAR, kept, 'They named the spire Kept.'), characterId: CHAR, text: 'They named the spire Kept.', causedBySeq: kept },
        { id: memoryId(CHAR, undone, 'They renamed it Undone.'), characterId: CHAR, text: 'They renamed it Undone.', causedBySeq: undone },
        { id: 'm-x', characterId: CHAR, text: 'Invented.', causedBySeq: 4242 },
      ],
    };
    const view = buildLedger(initial, store.getLog());
    expect(groundMemories(state, view).map((g) => g.status)).toEqual(['grounded', 'undone', 'unknown']);
    expect(groundMemories(state, view)[0]!.entryId).toBe(view.entries[0]!.id);
    expect(memoriesForContext(state, view).map((m) => m.text)).toEqual(['They named the spire Kept.']);
    expect(memoryId(CHAR, kept, ' They named the spire Kept. ')).toBe(state.memories[0]!.id);
    // Redo makes the undone memory grounded again.
    store.redo();
    expect(groundMemories(state, buildLedger(initial, store.getLog())).map((g) => g.status)).toEqual(['grounded', 'grounded', 'unknown']);
  });

  it('a future keeps only memories of changes made before its fork', () => {
    const initial = buildCrystalKingdom();
    const store = new WorldStore(initial);
    const spire = initial.order[4]!;
    store.dispatch({ type: 'entity/renamed', id: spire, name: 'Before fork', source: 'user' });
    const forkSeq = store.getState().seq;
    store.dispatch({ type: 'entity/renamed', id: spire, name: 'After fork', source: 'user' });
    const mem = (seq: number, text: string) => ({ id: memoryId(CHAR, seq, text), characterId: CHAR, text, causedBySeq: seq });
    const state: CharacterState = { characterId: CHAR, persona: { displayName: 'Lumen', traits: [] }, memories: [mem(forkSeq, 'before'), mem(store.getState().seq, 'after')] };
    expect(memoriesForFuture(state, buildLedger(initial, store.getLog()), forkSeq).map((m) => m.text)).toEqual(['before']);
  });

  it('lists unpinned characters a morph could change; pinning protects them', () => {
    const store = new WorldStore(buildCrystalKingdom());
    expect(charactersExposedToMorph(store.getState())).toEqual([]);
    const add = (id: string, pinned: boolean) => store.dispatch({
      type: 'entity/added', source: 'user',
      entity: { id: asEntityId(id), name: id, kind: CHARACTER_KIND, parentId: null, tags: [], pinned, components: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } },
    });
    add('char-a', false);
    add('char-b', true);
    expect(charactersExposedToMorph(store.getState())).toEqual(['char-a']);
  });

  it('keeps only the most recent memories in context', () => {
    const state: CharacterState = {
      characterId: CHAR,
      persona: { displayName: 'Lumen', traits: ['curious'] },
      memories: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, characterId: CHAR, text: `m${i}`, causedBySeq: 100 - i })),
    };
    const ctx = memoriesForContext(state);
    expect(ctx).toHaveLength(CHARACTER_LIMITS.maxMemoriesInContext);
    expect(ctx.at(-1)!.causedBySeq).toBe(100);
    expect(ctx[0]!.causedBySeq).toBeLessThan(ctx.at(-1)!.causedBySeq);
  });
});
