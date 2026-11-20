/**
 * Parallel Futures panel (DOM). Uses the real futures API only
 * (`FuturesManager`, src/core/futures.ts) and the Director pipeline
 * (`requestFutureProposal`). The original world changes only through
 * `manager.commit()`, which is one atomic store batch (one undo step).
 *
 * Preview vs Apply: "Preview" asks the renderer presenter to SHOW a future
 * (`FuturePreviewPresenter`); it never changes the world. If no presenter is
 * connected the panel says so and the comparison table is the preview.
 */
import './ledger-futures.css';
import type { FuturesManager, FutureView } from '../core/futures';
import { futureCardsOf, type FutureCard } from '../core/historyView';
import { buildFuturePreview, type FuturePreviewPresenter } from '../core/presentation';
import type { WorldStore } from '../core/store';
import type { EntityId } from '../core/types';
import { requestFutureProposal, type FutureTask, type ProposalRequest } from '../director/futureRequest';
import { clear, h } from './dom';
import { cardSummary, comparisonMatrix, createAvailability, defaultFutureLabel, errorText, MAX_FUTURES, type MatrixRow } from './futuresModel';

export interface FuturesPanelDeps {
  readonly manager: FuturesManager;
  readonly store: WorldStore;
  /** Director request (studio: `requestProposal`). Omit to hide the Director prompt. */
  readonly request?: ProposalRequest;
  /** Offer the World Morph task (proxy must also run with DIRECTOR_MORPH=1). */
  readonly morphEnabled?: boolean;
  /** Renderer preview presenter; null if the renderer does not implement it yet. */
  readonly presenter?: FuturePreviewPresenter | null;
  /** Source recorded on futures created from this panel (Director prompts need 'director'). */
  readonly source?: 'director' | 'user';
  notify?(message: string, tone?: 'info' | 'warn'): void;
  focusEntity?(id: EntityId): void;
}

interface CardRuntime {
  error: string;
  prompt: string;
  task: FutureTask;
  busy: AbortController | null;
}

let panelSeq = 0;

export class FuturesPanel {
  readonly element: HTMLElement;
  private readonly uid = `ww-futures-${++panelSeq}`;
  private readonly meta: HTMLElement;
  private readonly previewBar: HTMLElement;
  private readonly baseline: HTMLElement;
  private readonly labelInput: HTMLInputElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly createNote: HTMLElement;
  private readonly grid: HTMLUListElement;
  private readonly empty: HTMLElement;
  private readonly compare: HTMLElement;
  private readonly live: HTMLElement;
  private readonly runtime = new Map<string, CardRuntime>();
  private previewing: string | null = null;
  private onlyContested = false;
  private disposed = false;

  constructor(private readonly deps: FuturesPanelDeps) {
    const titleId = `${this.uid}-title`;
    this.meta = h('span', { class: 'ww-panel-meta' });
    this.previewBar = h('div', { class: 'ww-futures-previewbar', attrs: { role: 'region', 'aria-label': 'Future preview' } });
    this.previewBar.hidden = true;
    this.baseline = h('div', { class: 'ww-futures-baseline' });
    this.labelInput = h('input', { attrs: { type: 'text', maxlength: '80', 'aria-label': 'Name for the new future', id: `${this.uid}-label` } });
    this.labelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.create();
      }
    });
    this.createBtn = h('button', { class: 'ww-btn is-primary is-small', text: 'New future', attrs: { type: 'button' }, on: { click: () => this.create() } });
    this.createNote = h('p', { class: 'ww-note', attrs: { id: `${this.uid}-create-note` } });
    this.grid = h('ul', { class: 'ww-futures-grid', attrs: { 'aria-label': 'Open futures' } });
    this.empty = h('div', { class: 'ww-lf-state' }, [
      h('strong', { text: 'No futures yet' }),
      'Create a future to explore an alternative version of this world. The real world stays exactly as it is until you choose Apply.',
    ]);
    this.compare = h('section', { class: 'ww-futures-compare', attrs: { 'aria-label': 'Side-by-side comparison' } });
    this.live = h('p', { class: 'ww-lf-sr', attrs: { 'aria-live': 'polite' } });
    this.element = h('section', { class: 'ww-panel ww-glass ww-futures', attrs: { 'aria-labelledby': titleId } }, [
      h('div', { class: 'ww-panel-head' }, [h('h2', { text: 'Parallel Futures', attrs: { id: titleId } }), this.meta]),
      this.previewBar,
      this.baseline,
      h('div', { class: 'ww-futures-create' }, [this.labelInput, this.createBtn]),
      this.createNote,
      this.grid,
      this.empty,
      this.compare,
      this.live,
    ]);
    this.update();
  }

  /** Re-render from the manager and store. Call after any store change. */
  update(): void {
    if (this.disposed) return;
    const cards = futureCardsOf(this.deps.manager);
    for (const id of [...this.runtime.keys()]) {
      if (!cards.some((c) => c.id === id)) {
        this.runtime.get(id)?.busy?.abort();
        this.runtime.delete(id);
      }
    }
    if (this.previewing && !cards.some((c) => c.id === this.previewing)) this.stopPreview(false);
    this.meta.textContent = `${cards.length} of ${MAX_FUTURES} open`;
    this.renderBaseline();
    this.renderCreate(cards);
    this.renderPreviewBar(cards);
    clear(this.grid);
    for (const card of cards) this.grid.append(this.renderCard(card));
    this.empty.hidden = cards.length > 0;
    this.renderCompare(cards);
  }

  /**
   * The world changed (any store emit). Rule P2 of the preview contract: a
   * preview is closed on every change. `reason` is announced if given.
   */
  onWorldChanged(reason?: string): void {
    if (this.previewing) this.stopPreview(false, reason ?? 'Preview closed because the world changed.');
    this.update();
  }

  /** WebGL context restored: show the current preview again (rule P3). */
  onContextRestored(): void {
    if (this.previewing) this.showPreviewOnPresenter(this.previewing);
  }

  previewingId(): string | null {
    return this.previewing;
  }

  dispose(): void {
    this.disposed = true;
    for (const r of this.runtime.values()) r.busy?.abort();
    this.runtime.clear();
    if (this.previewing) this.stopPreview(false);
    this.element.remove();
  }

  // ------------------------------------------------------------ actions

  private announce(message: string, tone: 'info' | 'warn' = 'info'): void {
    this.live.textContent = message;
    this.deps.notify?.(message, tone);
  }

  private rt(id: string): CardRuntime {
    let r = this.runtime.get(id);
    if (!r) {
      r = { error: '', prompt: '', task: 'edit', busy: null };
      this.runtime.set(id, r);
    }
    return r;
  }

  private create(): void {
    const existing = this.deps.manager.list().map((f) => f.label);
    const label = this.labelInput.value.trim() || defaultFutureLabel(existing);
    const r = this.deps.manager.fork(label, { source: this.deps.source ?? 'director' });
    if (!r.ok) {
      this.createNote.textContent = errorText(r.code, r.reason);
      this.createNote.setAttribute('role', 'alert');
      return;
    }
    this.createNote.removeAttribute('role');
    this.labelInput.value = '';
    this.update();
    this.announce(`Created “${r.value.label}” from the current world. The real world is unchanged.`);
    this.cardElement(r.value.id)?.querySelector<HTMLElement>('.ww-future-title')?.focus();
  }

  private togglePreview(id: string): void {
    if (this.previewing === id) {
      this.stopPreview(true);
      return;
    }
    this.previewing = id;
    this.showPreviewOnPresenter(id);
    const label = this.deps.manager.get(id)?.label ?? 'future';
    this.update();
    this.announce(`Previewing “${label}”. The real world is unchanged.`);
    this.previewBar.querySelector<HTMLButtonElement>('button')?.focus();
  }

  private showPreviewOnPresenter(id: string): void {
    const preview = buildFuturePreview(this.deps.manager, id);
    if (!preview) return;
    try {
      this.deps.presenter?.show(preview);
    } catch {
      this.announce('The viewport could not show this preview. The comparison table still shows every difference.', 'warn');
    }
  }

  private stopPreview(announce: boolean, message = 'Back to the real world.'): void {
    this.previewing = null;
    try {
      this.deps.presenter?.clear();
    } catch {
      /* a failing presenter must not break the panel */
    }
    if (!this.disposed) {
      this.update();
      if (announce || message !== 'Back to the real world.') this.announce(message);
    }
  }

  private apply(id: string): void {
    const label = this.deps.manager.get(id)?.label ?? 'future';
    const r = this.deps.manager.commit(id);
    if (!r.ok) {
      this.rt(id).error = errorText(r.code, r.reason);
      this.update();
      this.announce(`Could not apply “${label}”: ${this.rt(id).error}`, 'warn');
      return;
    }
    this.runtime.delete(id);
    if (this.previewing === id) this.previewing = null;
    try {
      this.deps.presenter?.clear();
    } catch {
      /* ignore */
    }
    this.update();
    this.announce(`Applied “${label}” as one step. Undo (Ctrl+Z) reverses all of it.`);
  }

  private rebase(id: string): void {
    const r = this.deps.manager.rebase(id);
    this.rt(id).error = r.ok ? '' : errorText(r.code, r.reason);
    this.update();
    this.announce(r.ok ? 'Rebased onto the current world. You can apply it now.' : `Rebase failed: ${this.rt(id).error}`, r.ok ? 'info' : 'warn');
  }

  private discard(id: string): void {
    const label = this.deps.manager.get(id)?.label ?? 'future';
    this.runtime.get(id)?.busy?.abort();
    if (this.previewing === id) this.stopPreview(false);
    this.deps.manager.discard(id);
    this.runtime.delete(id);
    this.update();
    this.announce(`Discarded “${label}”. The real world was not changed.`);
    this.labelInput.focus();
  }

  private step(id: string, direction: 'undo' | 'redo'): void {
    const ok = direction === 'undo' ? this.deps.manager.undo(id) : this.deps.manager.redo(id);
    this.rt(id).error = '';
    if (this.previewing === id) this.showPreviewOnPresenter(id);
    this.update();
    if (ok) this.announce(direction === 'undo' ? 'Undid the last step in this future.' : 'Redid the step in this future.');
  }

  private async ask(id: string): Promise<void> {
    const r = this.rt(id);
    if (!this.deps.request || r.busy) return;
    r.error = '';
    r.busy = new AbortController();
    const signal = r.busy.signal;
    this.update();
    const outcome = await requestFutureProposal(this.deps.manager, id, r.prompt, r.task, this.deps.request, signal);
    if (this.disposed) return;
    const now = this.runtime.get(id);
    if (!now) return; // discarded or applied meanwhile
    now.busy = null;
    if (outcome.ok) {
      now.prompt = '';
      if (this.previewing === id) this.showPreviewOnPresenter(id);
      this.update();
      this.announce(`Added a ${outcome.mode === 'recorded' ? 'recorded ' : ''}Director step to “${outcome.future.label}”.`);
    } else if (outcome.code === 'CANCELLED') {
      this.update();
      this.announce('Director request cancelled. Nothing changed.');
    } else {
      const extra = outcome.issues?.length ? ` ${outcome.issues.slice(0, 3).map((i) => `${i.path || 'response'}: ${i.message}`).join(' · ')}` : '';
      const wait = outcome.retryAfterSec ? ` Try again in ${outcome.retryAfterSec} s.` : '';
      now.error = `${errorText(outcome.code, outcome.reason)}${extra}${wait}`;
      this.update();
      this.announce(`Director: ${now.error}`, 'warn');
    }
  }

  private cancelAsk(id: string): void {
    this.runtime.get(id)?.busy?.abort();
  }

  // ------------------------------------------------------------ rendering

  private renderBaseline(): void {
    const w = this.deps.store.getState();
    this.baseline.replaceChildren(
      h('span', { class: 'ww-lf-badge is-user', text: 'Baseline' }),
      h('div', {}, [
        h('div', { class: 'ww-futures-baseline-title', text: `Original world · ${w.name}` }),
        h('div', { class: 'ww-futures-baseline-meta', text: `seq #${w.seq} · ${w.order.length} entities · unchanged by previews and futures` }),
      ]),
    );
  }

  private renderCreate(cards: FutureCard[]): void {
    const avail = createAvailability(cards.length);
    this.createBtn.disabled = !avail.ok;
    this.labelInput.disabled = !avail.ok;
    this.labelInput.placeholder = avail.ok ? `Name (default: ${defaultFutureLabel(cards.map((c) => c.label))})` : 'Limit reached';
    if (avail.ok) {
      if (!this.createNote.hasAttribute('role')) this.createNote.textContent = 'A new future starts from the current world, verified by replay.';
    } else {
      this.createNote.textContent = avail.reason!;
      this.createNote.removeAttribute('role');
    }
    this.createBtn.setAttribute('aria-describedby', this.createNote.id);
  }

  private renderPreviewBar(cards: FutureCard[]): void {
    const card = cards.find((c) => c.id === this.previewing);
    this.previewBar.hidden = !card;
    if (!card) {
      clear(this.previewBar);
      return;
    }
    const apply = h('button', { class: 'ww-btn is-primary is-small', text: 'Apply this future', attrs: { type: 'button' }, on: { click: () => this.apply(card.id) } });
    apply.disabled = !card.canCommit;
    if (card.blockedReason) apply.title = card.blockedReason;
    const parts: Array<HTMLElement | null> = [
      h('p', {}, [h('strong', { text: `Previewing “${card.label}”.` }), ' The real world is unchanged.']),
      h('button', { class: 'ww-btn is-small', text: 'Back to the real world', attrs: { type: 'button' }, on: { click: () => this.stopPreview(true) } }),
      apply,
      this.deps.presenter ? null : h('p', { class: 'ww-note', text: 'The 3D viewport preview is not connected in this build. The comparison below lists every difference.' }),
      card.stale ? h('p', { class: 'ww-note', text: card.blockedReason ?? 'This future is stale.' }) : null,
    ];
    this.previewBar.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }

  private cardElement(id: string): HTMLElement | null {
    return this.grid.querySelector<HTMLElement>(`[data-future="${CSS.escape(id)}"]`);
  }

  private renderCard(card: FutureCard): HTMLElement {
    const view = this.deps.manager.get(card.id) as FutureView;
    const rt = this.rt(card.id);
    const titleId = `${this.uid}-t-${card.id}`;
    const isPreviewing = this.previewing === card.id;
    const compare = this.deps.manager.compare(card.id);
    const pinned = compare.ok ? compare.value.pinned.length : 0;
    const chips = h('div', { class: 'ww-future-chips' }, [
      isPreviewing ? h('span', { class: 'ww-lf-badge is-future', text: 'Previewing' }) : null,
      card.stale ? h('span', { class: 'ww-lf-badge is-stale', text: 'Stale' }) : null,
      card.fromSnapshot ? h('span', { class: 'ww-lf-badge', text: 'From snapshot' }) : null,
      card.contested.length ? h('span', { class: 'ww-lf-badge is-morph', text: `${card.contested.length} contested` }) : null,
      pinned ? h('span', { class: 'ww-lf-badge is-pin', text: `${pinned} pinned protected`, title: 'Pinned objects and their ancestors cannot change in any future (WW-031).' }) : null,
    ]);
    const steps = view.steps.length
      ? h('ol', { class: 'ww-future-steps', attrs: { 'aria-label': 'Steps' } }, view.steps.map((s) => {
          const model = s.details.kind !== undefined && s.details.proposalKey !== undefined;
          return h('li', { class: model ? 'is-model' : '', title: model ? 'Label written by the AI Director (unverified text)' : '' }, [
            model ? `“${s.label}”` : s.label,
            ` · ${s.events} event${s.events === 1 ? '' : 's'}`,
            s.details.mode === 'recorded' ? ' · recorded' : '',
          ]);
        }))
      : h('p', { class: 'ww-note', text: this.deps.request ? 'No steps yet. Ask the Director below to change this future.' : 'No steps yet.' });

    const btn = (text: string, on: () => void, opts: { primary?: boolean; disabled?: boolean; title?: string; pressed?: boolean } = {}) => {
      const b = h('button', { class: `ww-btn is-small${opts.primary ? ' is-primary' : ''}`, text, attrs: { type: 'button' }, on: { click: on } });
      b.disabled = Boolean(opts.disabled);
      if (opts.title) b.title = opts.title;
      if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
      return b;
    };
    const busy = rt.busy !== null;
    const actions = h('div', { class: 'ww-future-actions' }, [
      btn(isPreviewing ? 'Stop preview' : 'Preview', () => this.togglePreview(card.id), { pressed: isPreviewing, disabled: busy }),
      btn('Apply', () => this.apply(card.id), { primary: true, disabled: !card.canCommit || busy, ...(card.blockedReason ? { title: card.blockedReason } : {}) }),
      card.stale ? btn('Rebase', () => this.rebase(card.id), { disabled: busy, title: 'Re-apply these steps on the current world' }) : null,
      btn('Undo step', () => this.step(card.id, 'undo'), { disabled: !card.canUndo || busy }),
      btn('Redo step', () => this.step(card.id, 'redo'), { disabled: !card.canRedo || busy }),
      btn('Discard', () => this.discard(card.id), { disabled: busy }),
    ]);

    let ask: HTMLElement | null = null;
    if (this.deps.request) {
      const area = h('textarea', { attrs: { 'aria-label': `Describe a change for ${card.label}`, maxlength: '2000', placeholder: 'e.g. make the spires violet' } });
      area.value = rt.prompt;
      area.disabled = busy;
      area.addEventListener('input', () => (rt.prompt = area.value));
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void this.ask(card.id);
        } else if (e.key === 'Escape' && busy) this.cancelAsk(card.id);
      });
      const select = h('select', { attrs: { 'aria-label': 'Director task' } }, [
        h('option', { text: 'Edit', attrs: { value: 'edit' } }),
        this.deps.morphEnabled ? h('option', { text: 'Morph', attrs: { value: 'morph' } }) : null,
      ]);
      select.value = rt.task;
      select.disabled = busy;
      select.addEventListener('change', () => (rt.task = select.value === 'morph' ? 'morph' : 'edit'));
      ask = h('div', { class: 'ww-future-ask', attrs: { 'aria-busy': String(busy) } }, [
        area,
        h('div', { class: 'ww-future-ask-row' }, [
          select,
          busy
            ? h('span', { class: 'ww-note' }, [h('span', { class: 'ww-lf-spinner', attrs: { 'aria-hidden': 'true' } }), 'Director is working…'])
            : null,
          busy ? btn('Cancel', () => this.cancelAsk(card.id)) : btn('Ask the Director', () => void this.ask(card.id), { title: 'Ctrl+Enter' }),
        ]),
      ]);
    }

    return h('li', { class: `ww-future-card${isPreviewing ? ' is-previewing' : ''}${card.stale ? ' is-stale' : ''}`, attrs: { 'aria-labelledby': titleId }, dataset: { future: card.id } }, [
      h('div', { class: 'ww-future-head' }, [h('h3', { class: 'ww-future-title', text: card.label, attrs: { id: titleId, tabindex: '-1' } }), chips]),
      h('p', { class: 'ww-future-summary', text: cardSummary(card) }),
      steps,
      card.blockedReason && card.steps > 0 ? h('p', { class: 'ww-future-blocked', text: card.blockedReason }) : null,
      h('p', { class: 'ww-future-error', text: rt.error, attrs: { role: rt.error ? 'alert' : 'status' } }),
      actions,
      ask,
    ]);
  }

  private renderCompare(cards: FutureCard[]): void {
    clear(this.compare);
    if (cards.length === 0) return;
    const original = this.deps.store.getState();
    const futures = cards.flatMap((c) => {
      const world = this.deps.manager.state(c.id);
      return world ? [{ id: c.id, label: c.label, world }] : [];
    });
    // Always against the CURRENT original world, so the Original column is true for every future.
    const matrix = comparisonMatrix(original, futures);
    const rows = this.onlyContested ? matrix.rows.filter((r) => r.contested) : matrix.rows;
    const toggle = h('button', { class: 'ww-btn is-small is-ghost', text: 'Only contested', attrs: { type: 'button', 'aria-pressed': String(this.onlyContested) }, on: { click: () => { this.onlyContested = !this.onlyContested; this.update(); } } });
    this.compare.append(h('div', { class: 'ww-futures-compare-head' }, [h('h3', { text: 'Side-by-side comparison' }), toggle]));
    if (rows.length === 0) {
      this.compare.append(h('div', { class: 'ww-lf-state' }, [h('strong', { text: this.onlyContested ? 'No contested objects' : 'No differences yet' }), this.onlyContested ? 'No object is changed differently by two futures.' : 'Every future is still identical to the original world.']));
      return;
    }
    const table = h('table', { class: 'ww-futures-table' }, [
      h('caption', { text: `${rows.length} object${rows.length === 1 ? '' : 's'} differ; ${matrix.unchanged} unchanged in every future. Values show the original, then each future.` }),
      h('thead', {}, [h('tr', {}, [h('th', { text: 'Object', attrs: { scope: 'col' } }), h('th', { text: 'Original', attrs: { scope: 'col' } }), ...matrix.columns.map((c) => h('th', { text: c.label, attrs: { scope: 'col' } }))])]),
      h('tbody', {}, rows.map((r) => this.renderMatrixRow(r))),
    ]);
    this.compare.append(h('div', { class: 'ww-futures-compare-scroll', attrs: { tabindex: '0', role: 'region', 'aria-label': 'Comparison table, scrollable' } }, [table]));
  }

  private renderMatrixRow(row: MatrixRow): HTMLElement {
    const origFields = new Map<string, { label: string; before: string }>();
    for (const c of row.cells) for (const f of c.fields) if (!origFields.has(f.field)) origFields.set(f.field, { label: f.label, before: f.before });
    const name = this.deps.focusEntity && this.deps.store.getState().entities[row.id]
      ? h('button', { class: 'ww-ledger-entity-name', text: row.name, attrs: { type: 'button', title: 'Select in the studio' }, on: { click: () => this.deps.focusEntity!(row.id) } })
      : h('span', { text: row.name });
    return h('tr', { class: row.contested ? 'is-contested' : '' }, [
      h('th', { attrs: { scope: 'row' } }, [name, row.pinned ? h('span', { class: 'ww-lf-badge is-pin', text: 'Pinned' }) : null, row.contested ? h('span', { class: 'ww-lf-sr', text: ' (contested)' }) : null]),
      h('td', { class: 'ww-futures-cell' }, row.inOriginal ? [h('ul', {}, [...origFields.values()].map((f) => h('li', { text: `${f.label}: ${f.before}` })))] : [h('span', { class: 'ww-note', text: 'Not in the original' })]),
      ...row.cells.map((c) =>
        h('td', { class: `ww-futures-cell is-${c.change}` }, [
          c.change === 'same' ? 'Same as original' : h('span', { class: 'ww-futures-cell-tag', text: c.change === 'derived' ? 'Moved via parent (derived)' : c.change }),
          c.fields.length
            ? h('ul', {}, c.fields.map((f) => {
                const li = h('li', {}, [`${f.label}: `]);
                if (f.afterColour) {
                  const s = h('span', { class: 'ww-lf-swatch', attrs: { 'aria-hidden': 'true' } });
                  s.style.background = f.afterColour;
                  s.style.color = f.afterColour;
                  li.append(s);
                }
                li.append(f.after);
                return li;
              }))
            : null,
        ]),
      ),
    ]);
  }
}
