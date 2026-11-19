import { describe, expect, it } from 'vitest';
import { WorldStore } from '../core/store';
import { asEntityId } from '../core/types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { admitCharacterTurn, CHARACTER_LIMITS, memoriesForContext, validateMemory, type CharacterState } from './characters';

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
