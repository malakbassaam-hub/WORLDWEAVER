/**
 * Deterministic recorded-mode demo for the Causal Ledger and Parallel Futures
 * panels (screenshots and browser tests). Every Director step uses a recorded
 * response that the proxy serves in recorded mode (server/director/recordings.ts);
 * every step goes through the real validator, translator, store and futures API.
 * No model calls, no network.
 */
import { RECORDINGS } from '../../server/director/recordings';
import { createFuturesManager, type FuturesManager } from '../core/futures';
import { WorldStore } from '../core/store';
import type { World } from '../core/types';
import { applyTranslation } from '../director/apply';
import { buildWorldContext } from '../director/context';
import { applyProposalToFuture } from '../director/futures';
import { applyMorph, translateMorph } from '../director/morph';
import { translateProposal } from '../director/translate';
import { validateProposal } from '../director/validate';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';

export type DemoScenario = 'history' | 'futures' | 'stale' | 'empty';

export const DEMO_SCENARIOS: readonly DemoScenario[] = ['history', 'futures', 'stale', 'empty'];

export interface DemoSession {
  readonly initial: World;
  readonly store: WorldStore;
  /** Futures created by the fixture (scenario 'futures' and 'stale'). */
  readonly futureIds: readonly string[];
  /** Human-readable script of what the fixture did, in order. */
  readonly script: readonly string[];
}

export function recordedProposal(id: string) {
  const rec = RECORDINGS.find((r) => r.id === id);
  if (!rec) throw new Error(`Unknown recording ${id}`);
  const v = validateProposal(rec.response);
  if (!v.ok) throw new Error(`Recording ${id} does not validate`);
  return { proposal: v.proposal, mode: rec.mode, id: rec.id };
}

function must<T extends { ok: boolean }>(r: T, what: string): T {
  if (!r.ok) throw new Error(`Demo step failed: ${what}`);
  return r;
}

/** Builds the session history. Same calls, same result, every time. */
export function buildDemoHistory(store: WorldStore, script: string[]): void {
  const w0 = store.getState();
  const ref = (r: string) => buildWorldContext(w0).refs.get(r)!;

  must(store.dispatch({ type: 'entity/renamed', id: ref('e4'), name: 'Watchtower of Dusk', source: 'user' }), 'rename');
  script.push('You renamed Sentinel Spire I to “Watchtower of Dusk”.');
  store.dispatch({ type: 'entity/renamed', id: ref('e4'), name: '   ', source: 'user' });
  script.push('An empty rename was rejected by the world rules.');

  const create = recordedProposal('create-crystal-garden');
  const t = translateProposal(store.getState(), create.proposal);
  must(applyTranslation(store, t, { mode: 'recorded', kind: 'create', recordingId: create.id, requestId: 'demo-req-1' }), 'create');
  script.push('The Director (recorded) grew a crystal garden.');

  must(store.dispatch({ type: 'entity/transformed', id: ref('e10'), transform: { position: [-24, 9, 14] }, source: 'user' }), 'move');
  script.push('You lifted Veilstone Reach; its cluster moved with it (derived).');

  const morph = recordedProposal('morph-violet-dusk');
  const m = translateMorph(store.getState(), morph.proposal);
  must(applyMorph(store, m, { mode: 'recorded', recordingId: morph.id, requestId: 'demo-req-2' }), 'morph');
  script.push('World Morph (recorded): violet dusk, with the pinned citadel protected.');
  store.undo();
  store.redo();
  script.push('You undid and redid the morph.');

  must(store.dispatch({ type: 'entity/visualChanged', id: ref('e5'), patch: { color: '#ff8a3d' }, source: 'user' }), 'recolour');
  store.undo();
  script.push('You recoloured a spire and undid it (shown as undone).');
}

function forkWith(manager: FuturesManager, label: string, recordingId: string, kind: 'edit' | 'morph'): string {
  const f = manager.fork(label, { source: 'director' });
  if (!f.ok) throw new Error(f.reason);
  const rec = recordedProposal(recordingId);
  const r = applyProposalToFuture(manager, f.value.id, rec.proposal, { kind, mode: 'recorded', recordingId: rec.id });
  if (!r.ok) throw new Error(`Demo future ${label}: ${r.reason}`);
  return f.value.id;
}

/**
 * Creates the demo session. Futures are created with their own manager so
 * the caller can mount the panels with a fresh adapter; `seedFutures` adds the
 * fixture futures to a given manager.
 */
export function buildDemoSession(scenario: DemoScenario): DemoSession {
  const initial = buildCrystalKingdom();
  const store = new WorldStore(initial);
  const script: string[] = [];
  if (scenario !== 'empty') buildDemoHistory(store, script);
  return { initial, store, futureIds: [], script };
}

/** Adds the fixture futures (and, for 'stale', a later real-world edit) to `manager`. */
export function seedFutures(manager: FuturesManager, store: WorldStore, scenario: DemoScenario, script: string[] = []): string[] {
  if (scenario !== 'futures' && scenario !== 'stale') return [];
  const ids = [forkWith(manager, 'Ember ruin', 'morph-ember-ruin', 'morph'), forkWith(manager, 'Raised spires', 'edit-raise-spires', 'edit')];
  script.push('Two futures: an Ember ruin morph and raised spires, both from the same verified world.');
  if (scenario === 'stale') {
    const ref = buildWorldContext(store.getState()).refs.get('e6')!;
    must(store.dispatch({ type: 'entity/renamed', id: ref, name: 'Edited After Forking', source: 'user' }), 'stale edit');
    script.push('You edited the real world after forking, so both futures are stale.');
  }
  return ids;
}

/** Convenience for tests: session plus a manager with the fixture futures. */
export function buildDemoWithFutures(scenario: DemoScenario) {
  const session = buildDemoSession(scenario);
  const manager = createFuturesManager(session.store, session.initial);
  const script = [...session.script];
  const futureIds = seedFutures(manager, session.store, scenario, script);
  return { ...session, manager, futureIds, script };
}
