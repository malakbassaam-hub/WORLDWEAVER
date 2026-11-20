import { describe, expect, it } from 'vitest';
import { worldFingerprint } from '../core/fingerprint';
import { futureCardsOf } from '../core/historyView';
import { buildLedger, verifyLedgerChain } from '../core/ledger';
import { checkPinnedInvariant } from '../core/pins';
import { replayLog } from '../core/replay';
import { buildDemoWithFutures, DEMO_SCENARIOS } from './fixtures';

describe('demo fixtures', () => {
  it('every scenario is deterministic and replays exactly with a consistent ledger', () => {
    for (const s of DEMO_SCENARIOS) {
      const a = buildDemoWithFutures(s);
      const b = buildDemoWithFutures(s);
      expect(worldFingerprint(a.store.getState()), s).toBe(worldFingerprint(b.store.getState()));
      expect(JSON.stringify(a.store.getLog())).toBe(JSON.stringify(b.store.getLog()));
      const view = buildLedger(a.initial, a.store.getLog());
      expect(view.consistent, s).toBe(true);
      expect(verifyLedgerChain(view)).toEqual({ ok: true });
      expect(replayLog(a.initial, a.store.getLog()).mismatches).toEqual([]);
    }
  });

  it('covers the states the panels must show', () => {
    expect(buildDemoWithFutures('empty').store.getLog()).toHaveLength(0);
    const f = buildDemoWithFutures('futures');
    const cards = futureCardsOf(f.manager);
    expect(cards.map((c) => [c.label, c.canCommit, c.stale])).toEqual([['Ember ruin', true, false], ['Raised spires', true, false]]);
    expect(cards.some((c) => c.contested.length > 0)).toBe(true);
    for (const id of f.futureIds) expect(checkPinnedInvariant(f.store.getState(), f.manager.state(id)!)).toEqual([]);
    const stale = futureCardsOf(buildDemoWithFutures('stale').manager);
    expect(stale.every((c) => c.stale && !c.canCommit)).toBe(true);
  });
});
