/**
 * Integration adapter for the Causal Ledger and Parallel Futures panels.
 * One call wires both panels to a WorldStore (docs/ledger-futures/UI_INTEGRATION.md).
 *
 *   const lf = mountLedgerFutures({ store, initial: genesis, request, presenter });
 *   shell.bottom.append(lf.ledger.element);   // placement is the caller's choice
 *   shell.right.append(lf.futures.element);
 *   // renderer callbacks: lf.onContextLost(), lf.onContextRestored()
 *   // teardown: lf.dispose()
 *
 * The adapter owns a live ledger recorder and a futures manager. It never
 * dispatches to the store itself; only `FuturesManager.commit` (an explicit
 * Apply) changes the world, as one atomic batch.
 */
import { createFuturesManager, type FuturesManager } from '../core/futures';
import { inspectEntry } from '../core/historyView';
import { createLedgerRecorder, type CausalLedgerView, type LedgerRecorder } from '../core/ledger';
import type { FuturePreviewPresenter } from '../core/presentation';
import type { WorldStore } from '../core/store';
import type { EntityId, World } from '../core/types';
import type { ProposalRequest } from '../director/futureRequest';
import { FuturesPanel } from './futuresPanel';
import { LedgerPanel } from './ledgerPanel';

export interface LedgerFuturesDeps {
  readonly store: WorldStore;
  /** The world the store was created with (needed for verified replay). */
  readonly initial: World;
  /** Director request for futures (studio: `(body, signal) => requestProposal(body, { signal })`). Omit to hide the prompt. */
  readonly request?: ProposalRequest;
  /** Offer the Morph task inside futures. The proxy must also allow morph. */
  readonly morphEnabled?: boolean;
  /** Renderer presenter for future previews; null until the renderer implements it. */
  readonly presenter?: FuturePreviewPresenter | null;
  notify?(message: string, tone?: 'info' | 'warn'): void;
  focusEntity?(id: EntityId): void;
  reducedMotion?(): boolean;
  /** Called with errors raised while updating the panels (never thrown to the store). */
  onError?(error: unknown): void;
  /** Toggle panel collapse (left/right/bottom). */
  togglePanel?: (side: 'left' | 'right' | 'bottom') => void;
}

export interface LedgerFuturesMount {
  readonly ledger: LedgerPanel;
  readonly futures: FuturesPanel;
  readonly manager: FuturesManager;
  /** Current ledger view (for tests and debugging). */
  ledgerView(): CausalLedgerView;
  /** Call from the renderer's context-lost callback: clears any future preview (rule P2). */
  onContextLost(): void;
  /** Call from the renderer's context-restored callback: shows the preview again (rule P3). */
  onContextRestored(): void;
  /** Unsubscribes, aborts Director requests, clears previews, discards futures. Idempotent. */
  dispose(): void;
}

export function mountLedgerFutures(deps: LedgerFuturesDeps): LedgerFuturesMount {
  const { store, initial } = deps;
  const report = (e: unknown) => {
    try {
      deps.onError?.(e);
    } catch {
      /* never let reporting break the studio */
    }
  };

  let recorder: LedgerRecorder;
  const ledger = new LedgerPanel({
    inspect: (index) => inspectEntry(initial, store.getLog(), recorder.view(), index, { historyLimit: store.getHistoryLimit() }),
    exists: (id) => Boolean(store.getState().entities[id]),
    ...(deps.focusEntity ? { focusEntity: deps.focusEntity } : {}),
    ...(deps.reducedMotion ? { reducedMotion: deps.reducedMotion } : {}),
    ...(deps.togglePanel ? { togglePanel: (side) => deps.togglePanel!(side) } : {}),
  });
  recorder = createLedgerRecorder(initial, store);
  const manager = createFuturesManager(store, initial);
  const futures = new FuturesPanel({
    manager,
    store,
    ...(deps.request ? { request: deps.request } : {}),
    morphEnabled: Boolean(deps.morphEnabled),
    presenter: deps.presenter ?? null,
    ...(deps.notify ? { notify: deps.notify } : {}),
    ...(deps.focusEntity ? { focusEntity: deps.focusEntity } : {}),
    ...(deps.togglePanel ? { togglePanel: (side) => deps.togglePanel!(side) } : {}),
  });

  const refreshLedger = () => {
    try {
      ledger.update(recorder.view());
    } catch (e) {
      ledger.setError('The history could not be displayed. The world itself is unaffected.');
      report(e);
    }
  };
  refreshLedger();

  // The recorder subscribed first, so it has already recorded the entry when this runs.
  const unsubscribe = store.subscribe(() => {
    refreshLedger();
    try {
      futures.onWorldChanged();
    } catch (e) {
      report(e);
    }
  });

  let disposed = false;
  return {
    ledger,
    futures,
    manager,
    ledgerView: () => recorder.view(),
    onContextLost: () => {
      try {
        deps.presenter?.clear();
      } catch {
        /* ignore */
      }
    },
    onContextRestored: () => futures.onContextRestored(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      futures.dispose();
      ledger.dispose();
      recorder.dispose();
      manager.dispose();
    },
  };
}
