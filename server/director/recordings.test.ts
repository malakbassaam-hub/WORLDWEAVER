import { describe, expect, it } from 'vitest';
import { WorldStore } from '../../src/core/store';
import { applyTranslation } from '../../src/director/apply';
import { buildWorldContext } from '../../src/director/context';
import { translateProposal } from '../../src/director/translate';
import { parseProposalText } from '../../src/director/validate';
import { buildCrystalKingdom } from '../../src/worlds/crystalKingdom';
import { RECORDINGS, selectRecording, SIMULATED_BODIES, simulatedError } from './recordings';

describe('recordings', () => {
  it('match the refs documented for the default Crystal Kingdom', () => {
    const ctx = buildWorldContext(buildCrystalKingdom());
    const name = (ref: string) => ctx.entities.find((e) => e.ref === ref)?.name;
    expect(name('e1')).toBe('Isle of Aurelion');
    expect(name('e2')).toBe('Aurelion Citadel');
    expect(ctx.entities.find((e) => e.ref === 'e2')?.pinned).toBe(true);
    expect(name('e3')).toBe('Celestial Halo');
    expect(name('e4')).toBe('Sentinel Spire I');
    expect(name('e9')).toBe('Sentinel Spire VI');
    expect(name('e10')).toBe('Veilstone Reach');
    expect(name('e17')).toBe('Moonshard Cay');
    expect(name('e20')).toMatch(/^Lumen Wisp/);
  });

  it.each(RECORDINGS.map((r) => [r.id, r] as const))('%s validates, translates and applies as one step', (id, recording) => {
    const parsed = parseProposalText(JSON.stringify(recording.response));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const store = new WorldStore(buildCrystalKingdom());
    const t = translateProposal(store.getState(), parsed.proposal);
    if (id === 'edit-pinned-citadel') {
      // Demonstrates pin protection: the whole proposal is refused.
      expect(t.applicable).toBe(false);
      expect(t.outcomes[0]?.reason).toMatch(/pinned/);
      return;
    }
    expect(t.outcomes.filter((o) => o.status === 'rejected')).toEqual([]);
    expect(applyTranslation(store, t, { mode: 'recorded', recordingId: id }).ok).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.getState().order.length).toBe(buildCrystalKingdom().order.length);
  });

  it('selects deterministically by keywords, in English and Arabic', () => {
    expect(selectRecording('create', 'A CRYSTAL garden please').id).toBe('create-crystal-garden');
    expect(selectRecording('create', 'فوانيس في السماء').id).toBe('create-sky-lanterns');
    expect(selectRecording('create', 'جزيرة عائمة').id).toBe('create-drifting-isles');
    expect(selectRecording('edit', 'make everything violet').id).toBe('edit-violet-night');
    expect(selectRecording('edit', 'recolour the citadel, it is pinned').id).toBe('edit-pinned-citadel');
    expect(selectRecording('edit', 'zzz').id).toBe('edit-gentle-glow');
    expect(selectRecording('create', 'crystal garden').id).toBe(selectRecording('create', 'crystal garden').id);
  });

  it('has exactly one default per mode and unique ids', () => {
    expect(RECORDINGS.filter((r) => r.mode === 'create' && r.isDefault)).toHaveLength(1);
    expect(RECORDINGS.filter((r) => r.mode === 'edit' && r.isDefault)).toHaveLength(1);
    expect(new Set(RECORDINGS.map((r) => r.id)).size).toBe(RECORDINGS.length);
  });

  it('simulated bad bodies are rejected by the validator, including the __proto__ key', () => {
    for (const body of Object.values(SIMULATED_BODIES)) expect(parseProposalText(body).ok).toBe(false);
    const hostile = parseProposalText(SIMULATED_BODIES.HOSTILE);
    expect(!hostile.ok && hostile.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['forbidden_key', 'unknown_property']));
  });

  it('only recognises known #error hooks at the start of the prompt', () => {
    expect(simulatedError('#error:TIMEOUT')).toBe('TIMEOUT');
    expect(simulatedError('  #error:HOSTILE now')).toBe('HOSTILE');
    expect(simulatedError('please #error:TIMEOUT')).toBeNull();
    expect(simulatedError('#error:DROP_TABLES')).toBeNull();
  });
});
