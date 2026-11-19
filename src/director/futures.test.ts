import { describe, expect, it } from 'vitest';
import { createFuturesManager } from '../core/futures';
import { WorldStore } from '../core/store';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { proposeInFuture } from './futures';

const VIOLET = { summary: 'Violet dusk.', operations: [
  { op: 'recolor', target: 'e4', palette: 'Night Violet' },
  { op: 'recolor', target: 'e6', palette: 'Night Violet' },
  { op: 'glow', target: 'e20', glow: 2.5 },
] };

function setup() {
  const initial = buildCrystalKingdom();
  const store = new WorldStore(initial);
  const manager = createFuturesManager(store, initial);
  const fork = (label: string, source: 'director' | 'user' = 'director') => {
    const r = manager.fork(label, { source });
    if (!r.ok) throw new Error(r.reason);
    return r.value.id;
  };
  return { initial, store, manager, fork };
}

describe('Director proposals in Parallel Futures', () => {
  it('validates, translates against the future and applies one step; the original is untouched', () => {
    const { store, manager, fork } = setup();
    const before = store.getState();
    const id = fork('Violet');
    const r = proposeInFuture(manager, id, VIOLET, { kind: 'morph', mode: 'recorded', recordingId: 'morph-violet-dusk' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.future.steps).toHaveLength(1);
    expect(r.future.steps[0]!.label).toBe('Morph (recorded): Violet dusk.');
    expect(r.future.steps[0]!.details).toMatchObject({ kind: 'morph', mode: 'recorded', recordingId: 'morph-violet-dusk', proposalKey: r.translation.proposalKey, policy: 'reject-proposal;ancestors=protected;addToPinned=allowed' });
    expect(store.getState()).toBe(before);
    expect(store.getLog()).toHaveLength(0);
    expect(manager.commit(id).ok).toBe(true);
    expect(store.getLog()[0]!.meta!.details).toMatchObject({ kind: 'future', proposalKeys: r.translation.proposalKey });
  });

  it('translates the second proposal against the future state, not the original', () => {
    const { manager, fork } = setup();
    const id = fork('Two steps');
    expect(proposeInFuture(manager, id, VIOLET, { kind: 'morph', mode: 'recorded' }).ok).toBe(true);
    // The same proposal again is a no-op on the future state and is rejected; it would apply to the original.
    const again = proposeInFuture(manager, id, VIOLET, { kind: 'morph', mode: 'recorded' });
    expect(again).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
  });

  it('rejects invalid model output before anything is translated', () => {
    const { manager, fork } = setup();
    const id = fork('Invalid');
    for (const raw of [null, 'text', { summary: 'x', operations: [{ op: 'explode', target: 'e1' }] }, { summary: 'x', operations: [] }]) {
      expect(proposeInFuture(manager, id, raw, { kind: 'morph', mode: 'live' })).toMatchObject({ ok: false, code: 'INVALID_PROPOSAL' });
    }
    expect(manager.get(id)!.eventCount).toBe(0);
  });

  it('applies the approved morph policy: a pinned-entity change blocks the whole proposal', () => {
    const { manager, fork } = setup();
    const id = fork('Blocked');
    const r = proposeInFuture(manager, id, { summary: 'Move the isle.', operations: [{ op: 'recolor', target: 'e4', palette: 'Night Violet' }, { op: 'move', target: 'e1', direction: 'up' }] }, { kind: 'morph', mode: 'recorded' });
    expect(r).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
    if (!r.ok) expect(r.reason).toMatch(/morph policy rejects the whole morph/);
    expect(manager.get(id)!.eventCount).toBe(0);
  });

  it('an Edit proposal is checked by the future pinned invariant too', () => {
    const { manager, fork } = setup();
    const id = fork('Edit');
    const r = proposeInFuture(manager, id, { summary: 'Raise the isle.', operations: [{ op: 'move', target: 'e1', direction: 'up' }] }, { kind: 'edit', mode: 'recorded' });
    expect(r).toMatchObject({ ok: false, code: 'FUTURE_REFUSED' });
    if (!r.ok) expect(r.reason).toMatch(/^PINNED: Pinned “Aurelion Citadel” would move/);
  });

  it('refuses director proposals in a user future and unknown futures', () => {
    const { manager, fork } = setup();
    const user = fork('Hand edits', 'user');
    expect(proposeInFuture(manager, user, VIOLET, { kind: 'morph', mode: 'recorded' })).toMatchObject({ ok: false, code: 'FUTURE_REFUSED' });
    expect(proposeInFuture(manager, 'missing', VIOLET, { kind: 'morph', mode: 'recorded' })).toMatchObject({ ok: false, code: 'NO_FUTURE' });
  });
});
