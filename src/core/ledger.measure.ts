/**
 * Reproducible measurements for the Causal Ledger and Parallel Futures.
 * Run: npx vitest run --config vitest.measure.config.ts
 * Not part of `npm test`. Timings depend on the machine; the bounds below are
 * deliberately generous and only catch order-of-magnitude regressions.
 */
import { describe, expect, it } from 'vitest';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { canonical, fingerprint, worldFingerprint } from './fingerprint';
import { compareWorlds, createFuturesManager } from './futures';
import { buildLedger, createLedgerRecorder } from './ledger';
import { applyEvents, createEmptyWorld } from './reducer';
import { WorldStore } from './store';
import { asEntityId, type World, type WorldEvent } from './types';

function largeWorld(n: number): World {
  const events: WorldEvent[] = [];
  for (let i = 0; i < n; i++) {
    const parent = i === 0 ? null : asEntityId(`e${Math.floor((i - 1) / 4)}`);
    events.push({
      type: 'entity/added', source: 'system',
      entity: { id: asEntityId(`e${i}`), name: `Entity ${i}`, kind: 'crystal', parentId: parent, tags: [], pinned: i % 97 === 0,
        components: { transform: { position: [i % 10, 1, 2], rotation: [0, 0.1, 0], scale: [1, 1, 1] }, visual: { archetype: 'crystalCluster', color: '#334455', emissive: '#556677', emissiveIntensity: 1, visible: true } } },
    });
  }
  const r = applyEvents(createEmptyWorld({ id: 'big', name: 'Big', biome: 'b', seed: 1 }), events);
  if (!r.ok) throw new Error(r.reason);
  return r.world;
}

/** Edits unpinned leaf-ish entities so pins do not interfere; every 10th step is an undo. */
function session(initial: World, steps: number): WorldStore {
  const store = new WorldStore(initial);
  const ids = initial.order.filter((id) => !initial.entities[id]!.pinned);
  for (let i = 0; i < steps; i++) {
    const id = ids[(i * 7) % ids.length]!;
    if (i % 10 === 9) store.undo();
    else if (i % 10 === 5) store.dispatch({ type: 'entity/transformed', id, transform: { position: [i, 1, 0] }, source: 'user' });
    else store.dispatch({ type: 'entity/renamed', id, name: `N${i}`, source: 'user' });
  }
  return store;
}

function time(label: string, runs: number, fn: () => void): number {
  fn(); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const ms = (performance.now() - t0) / runs;
  console.log(`${label.padEnd(72)} ${ms.toFixed(2).padStart(9)} ms`);
  return ms;
}

const kingdom = buildCrystalKingdom();
const big = largeWorld(1000);

describe('measurements', () => {
  it('Causal Ledger', () => {
    const ks = session(kingdom, 200);
    const bs = session(big, 100);
    expect(time('buildLedger, Crystal Kingdom (27 entities), 200 entries', 10, () => buildLedger(kingdom, ks.getLog()))).toBeLessThan(500);
    expect(time('buildLedger, 1000 entities, 100 entries', 5, () => buildLedger(big, bs.getLog()))).toBeLessThan(5000);
    expect(time('live recorder, 1000 entities, 100 edits (total)', 5, () => {
      const store = new WorldStore(big);
      const rec = createLedgerRecorder(big, store);
      for (let i = 0; i < 100; i++) {
        const r = store.dispatch({ type: 'entity/renamed', id: big.order[(i * 13) % 1000]!, name: `L${i}`, source: 'user' });
        if (!r.ok) throw new Error(r.reason);
      }
      rec.dispose();
    })).toBeLessThan(5000);
    const cold = time('world fingerprint, 1000 entities, cold (canonical + hash each entity)', 5, () => {
      fingerprint(big.order.map((id) => fingerprint(canonical(big.entities[id]))).join('\n'));
    });
    const warm = time('worldFingerprint, 1000 entities, warm entity cache', 20, () => worldFingerprint(big));
    console.log(`entity cache speed-up: ${(cold / warm).toFixed(1)}x`);
    const entryBytes = JSON.stringify(buildLedger(big, bs.getLog()).entries).length / bs.getLog().length;
    console.log(`average ledger entry size (1000-entity world): ${Math.round(entryBytes)} bytes; world JSON: ${JSON.stringify(big).length} bytes`);
    expect(entryBytes).toBeLessThan(JSON.stringify(big).length / 50);
  });

  it('Parallel Futures', () => {
    const ks = session(kingdom, 200);
    const bs = session(big, 100);
    expect(time('fork (verified replay of 200 entries) + 3 steps + commit, Kingdom', 10, () => {
      const store = new WorldStore(kingdom);
      for (const entry of ks.getLog()) {
        if (entry.kind === 'event' && entry.event) store.dispatch(entry.event);
        else if (entry.kind === 'undo') store.undo();
      }
      const m = createFuturesManager(store, kingdom);
      const f = m.fork('Bench', { source: 'user' });
      if (!f.ok) throw new Error(f.reason);
      for (let i = 0; i < 3; i++) m.apply(f.value.id, [{ type: 'entity/renamed', id: kingdom.order[i + 3]!, name: `F${i}`, source: 'user' }], { label: 'Step' });
      const c = m.commit(f.value.id);
      if (!c.ok) throw new Error(c.reason);
    })).toBeLessThan(1000);
    expect(time('4 futures x 32 steps on 1000 entities, then compareAll', 3, () => {
      const store = new WorldStore(big);
      const m = createFuturesManager(store, big);
      const free = big.order.filter((id) => !big.entities[id]!.pinned);
      for (let f = 0; f < 4; f++) {
        const r = m.fork(`F${f}`, { source: 'user' });
        if (!r.ok) throw new Error(r.reason);
        for (let s = 0; s < 32; s++) {
          const a = m.apply(r.value.id, [{ type: 'entity/renamed', id: free[(f * 32 + s) % free.length]!, name: `S${f}-${s}`, source: 'user' }], { label: 'Step' });
          if (!a.ok) throw new Error(a.reason);
        }
      }
      m.compareAll();
    })).toBeLessThan(10000);
    expect(time('compareWorlds, 1000 entities, about 90 changed', 10, () => compareWorlds(big, bs.getState()))).toBeLessThan(2000);
  });
});
