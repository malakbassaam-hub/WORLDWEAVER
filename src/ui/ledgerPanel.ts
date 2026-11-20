/**
 * Causal Ledger panel (DOM). Renders the REAL ledger view; it never derives
 * causality itself. Rows come from `ledgerRows`, details from `ledgerDetail`
 * over `inspectEntry` (src/core/historyView.ts). All text is set with
 * textContent; model-written labels are shown as quoted model text.
 *
 * Keyboard: Arrow Up/Down, Page Up/Down, Home and End move between entries
 * (roving tabindex); Enter or Space opens or closes details; Escape closes.
 */
import './ledger-futures.css';
import type { EntryInspection } from '../core/historyView';
import type { CausalLedgerView } from '../core/ledger';
import type { EntityId } from '../core/types';
import { clear, h } from './dom';
import { filterCounts, filterRows, isHexColour, isNavKey, LEDGER_FILTERS, ledgerDetail, ledgerRows, nextIndex, type LedgerDetail, type LedgerFilter, type LedgerRow } from './ledgerModel';

export const LEDGER_MAX_ROWS = 300;

export interface LedgerPanelDeps {
  /** Before/after detail for one entry (adapter: `inspectEntry(initial, log, view, index)`). */
  inspect(index: number): EntryInspection | null;
  /** Optional: select and frame an entity in the studio. */
  focusEntity?(id: EntityId): void;
  /** True if the entity exists in the current world (focus buttons only for those). */
  exists?(id: EntityId): boolean;
  reducedMotion?(): boolean;
}

let panelSeq = 0;

export class LedgerPanel {
  readonly element: HTMLElement;
  private readonly uid = `ww-ledger-${++panelSeq}`;
  private readonly meta: HTMLElement;
  private readonly filters: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly stateBox: HTMLElement;
  private readonly more: HTMLElement;
  private readonly live: HTMLElement;
  private filter: LedgerFilter = 'all';
  private view: CausalLedgerView | null = null;
  private rows: LedgerRow[] = [];
  private readonly expanded = new Set<string>();
  private readonly details = new Map<string, LedgerDetail>();
  private focusId: string | null = null;
  private genesis = '';
  private lastCount = -1;

  constructor(private readonly deps: LedgerPanelDeps) {
    const titleId = `${this.uid}-title`;
    this.meta = h('span', { class: 'ww-panel-meta' });
    this.filters = h('div', { class: 'ww-ledger-filters', attrs: { role: 'toolbar', 'aria-label': 'Filter history' } });
    this.banner = h('div', { class: 'ww-lf-banner', attrs: { role: 'status' } });
    this.banner.hidden = true;
    this.list = h('ol', { class: 'ww-ledger-list', attrs: { 'aria-label': 'World history, oldest first' } });
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.stateBox = h('div', { class: 'ww-lf-state' });
    this.more = h('p', { class: 'ww-ledger-more' });
    this.more.hidden = true;
    this.scroll = h('div', { class: 'ww-ledger-scroll' }, [this.more, this.list, this.stateBox]);
    this.live = h('p', { class: 'ww-lf-sr', attrs: { 'aria-live': 'polite' } });
    this.element = h('section', { class: 'ww-panel ww-glass ww-ledger', attrs: { 'aria-labelledby': titleId } }, [
      h('div', { class: 'ww-panel-head' }, [h('h2', { text: 'Causal Ledger', attrs: { id: titleId } }), this.meta]),
      h('p', { class: 'ww-lf-legend', attrs: { 'aria-label': 'Legend' } }, [
        h('span', {}, [h('i', { class: 'ww-lf-key is-recorded' }), 'Recorded']),
        h('span', {}, [h('i', { class: 'ww-lf-key is-observed' }), 'Observed']),
        h('span', {}, [h('i', { class: 'ww-lf-key is-derived' }), 'Derived by rule']),
        h('span', {}, [h('i', { class: 'ww-lf-key is-model' }), 'AI text (unverified)']),
      ]),
      this.filters,
      this.banner,
      this.scroll,
      this.live,
    ]);
    this.setLoading();
  }

  /** Initial state before the first ledger view is available. */
  setLoading(): void {
    this.element.setAttribute('aria-busy', 'true');
    this.list.hidden = true;
    this.stateBox.hidden = false;
    this.stateBox.className = 'ww-lf-state';
    this.stateBox.replaceChildren(h('span', { class: 'ww-lf-spinner', attrs: { 'aria-hidden': 'true' } }), 'Building history…');
  }

  /** Shown if the ledger could not be built. The world itself is not affected. */
  setError(message: string): void {
    this.element.removeAttribute('aria-busy');
    this.list.hidden = true;
    this.stateBox.hidden = false;
    this.stateBox.className = 'ww-lf-state is-error';
    this.stateBox.setAttribute('role', 'alert');
    this.stateBox.replaceChildren(h('strong', { text: 'History unavailable' }), message);
  }

  update(view: CausalLedgerView): void {
    this.element.removeAttribute('aria-busy');
    this.stateBox.removeAttribute('role');
    if (view.genesis !== this.genesis) {
      this.genesis = view.genesis;
      this.details.clear();
      this.expanded.clear();
      this.focusId = null;
    }
    const grew = this.lastCount >= 0 && view.entries.length > this.lastCount;
    this.lastCount = view.entries.length;
    this.view = view;
    this.rows = ledgerRows(view);
    const undone = this.rows.filter((r) => r.inEffect === false).length;
    this.meta.textContent = `${view.entries.length} entr${view.entries.length === 1 ? 'y' : 'ies'}${undone ? ` · ${undone} undone` : ''} · ${view.head.slice(0, 8)}`;
    this.renderFilters();
    this.renderBanner(view);
    this.renderList(grew);
    if (grew) {
      const last = this.rows.at(-1)!;
      this.live.textContent = `History: #${last.index} ${last.badge}, ${last.statusText}.`;
    }
  }

  /** Opens one entry's details (by index) and focuses it. */
  open(index: number): void {
    const row = this.rows[index];
    if (!row) return;
    this.expanded.add(row.entryId);
    this.focusId = row.entryId;
    this.renderList(false);
    this.headButton(row.entryId)?.focus();
  }

  dispose(): void {
    this.details.clear();
    this.element.remove();
  }

  // ------------------------------------------------------------ rendering

  private renderFilters(): void {
    const counts = filterCounts(this.rows);
    clear(this.filters);
    for (const f of LEDGER_FILTERS) {
      this.filters.append(
        h('button', {
          class: 'ww-ledger-filter',
          attrs: { type: 'button', 'aria-pressed': String(this.filter === f.id), 'data-filter': f.id },
          on: { click: () => this.setFilter(f.id) },
        }, [f.label, h('span', { class: 'ww-ledger-count', text: String(counts[f.id]) })]),
      );
    }
  }

  private setFilter(filter: LedgerFilter): void {
    this.filter = filter;
    this.renderFilters();
    this.renderList(false);
    const label = LEDGER_FILTERS.find((f) => f.id === filter)!.label;
    this.live.textContent = `Showing ${label.toLowerCase()} entries.`;
  }

  private renderBanner(view: CausalLedgerView): void {
    if (view.consistent) {
      this.banner.hidden = true;
      this.banner.textContent = '';
      return;
    }
    this.banner.hidden = false;
    this.banner.className = 'ww-lf-banner is-error';
    this.banner.textContent = `The history has ${view.issues.length} integrity issue${view.issues.length === 1 ? '' : 's'}. Affected entries are marked; nothing was changed to hide them.`;
  }

  private renderList(scrollToEnd: boolean): void {
    const hadFocus = this.list.contains(document.activeElement);
    const visible = filterRows(this.rows, this.filter);
    const shown = visible.slice(-LEDGER_MAX_ROWS);
    this.more.hidden = shown.length === visible.length;
    this.more.textContent = `Showing the latest ${shown.length} of ${visible.length} entries.`;

    clear(this.list);
    if (this.filter === 'all' && this.view && shown.length === visible.length) {
      this.list.append(
        h('li', { class: 'ww-ledger-row is-genesis' }, [
          h('div', { class: 'ww-ledger-head', attrs: { 'aria-label': 'Start of history' } }, [
            h('span', { class: 'ww-ledger-index', text: '—', title: `World seq #${this.view.initial.seq}` }),
            h('span', { class: 'ww-lf-badge is-system', text: 'Start' }),
            h('span', { class: 'ww-ledger-title', text: 'Initial world' }),
            h('span', { class: 'ww-ledger-effects', text: `state ${this.view.initial.fingerprint.slice(0, 8)}` }),
          ]),
        ]),
      );
    }
    if (!shown.some((r) => r.entryId === this.focusId)) this.focusId = shown.at(-1)?.entryId ?? null;
    for (const row of shown) this.list.append(this.renderRow(row));

    const empty = shown.length === 0;
    this.list.hidden = false;
    this.stateBox.hidden = !empty;
    this.stateBox.className = 'ww-lf-state';
    if (empty) {
      const none = this.rows.length === 0;
      this.stateBox.replaceChildren(
        h('strong', { text: none ? 'No changes yet' : 'Nothing matches this filter' }),
        none ? 'Edits, Director proposals, morphs, undo and redo will appear here as they happen.' : 'Choose “All” to see the whole history.',
      );
    }
    if (hadFocus && this.focusId) this.headButton(this.focusId)?.focus({ preventScroll: true });
    if (scrollToEnd) this.list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: this.deps.reducedMotion?.() ? 'auto' : 'smooth' });
  }

  private renderRow(row: LedgerRow): HTMLElement {
    const open = this.expanded.has(row.entryId);
    const detailId = `${this.uid}-d-${row.index}`;
    const headId = `${this.uid}-h-${row.index}`;
    const tone =
      row.status !== 'applied' || row.issues > 0 ? ' is-problem'
      : row.badge === 'Undo' || row.badge === 'Redo' ? ' is-meta'
      : row.badge === 'Director' ? ' is-director'
      : row.badge === 'Morph' ? ' is-morph'
      : row.badge === 'Future' ? ' is-future'
      : '';
    const head = h('button', {
      class: 'ww-ledger-head',
      attrs: {
        type: 'button',
        id: headId,
        'aria-expanded': String(open),
        'aria-controls': detailId,
        tabindex: row.entryId === this.focusId ? '0' : '-1',
        'data-entry': row.entryId,
        'data-index': String(row.index),
      },
      on: {
        click: () => this.toggle(row.entryId),
        focus: () => {
          this.focusId = row.entryId;
          this.syncTabStops();
        },
      },
    }, [
      h('span', { class: 'ww-ledger-index', text: `#${row.index}` }),
      h('span', { class: `ww-lf-badge is-${row.badge.toLowerCase()}`, text: row.badge }),
      h('span', { class: `ww-ledger-title${row.labelOrigin === 'model' ? ' is-model' : ''}`, text: row.label || row.badge, title: row.label }),
      h('span', { class: 'ww-ledger-effects' }, [
        row.isBatch && row.actionCount > 0 ? h('span', { class: 'ww-ledger-batch', text: `${row.actionCount} action${row.actionCount === 1 ? '' : 's'}, 1 step · ` }) : null,
        row.effectText,
        row.mode === 'recorded' ? ' · recorded' : row.mode === 'live' ? ' · live AI' : '',
      ]),
      h('span', { class: `ww-ledger-status is-${row.statusText.toLowerCase().replace(/\s+/g, '-')}`, text: row.statusText }),
    ]);
    const detail = h('div', { class: 'ww-ledger-detail', attrs: { id: detailId, role: 'region', 'aria-labelledby': headId } });
    detail.hidden = !open;
    if (open) this.fillDetail(detail, row);
    return h('li', { class: `ww-ledger-row${tone}${row.inEffect === false ? ' is-undone' : ''}`, dataset: { entry: row.entryId } }, [head, detail]);
  }

  private toggle(entryId: string): void {
    if (this.expanded.has(entryId)) this.expanded.delete(entryId);
    else this.expanded.add(entryId);
    this.focusId = entryId;
    this.renderList(false);
    this.headButton(entryId)?.focus({ preventScroll: true });
  }

  private detailFor(row: LedgerRow): LedgerDetail | null {
    const cached = this.details.get(row.entryId);
    if (cached) return cached;
    if (!this.view) return null;
    let inspection: EntryInspection | null = null;
    try {
      inspection = this.deps.inspect(row.index);
    } catch {
      inspection = null;
    }
    const d = ledgerDetail(this.view, inspection, row.index);
    if (d) this.details.set(row.entryId, d);
    return d;
  }

  private fillDetail(el: HTMLElement, row: LedgerRow): void {
    const d = this.detailFor(row);
    if (!d) {
      el.replaceChildren(h('p', { class: 'ww-lf-state is-error', text: 'Details for this entry could not be loaded.' }));
      return;
    }
    const parts: HTMLElement[] = [];
    if (d.modelText) {
      parts.push(h('blockquote', { class: 'ww-ledger-model' }, [h('small', { text: 'AI-written label · not a verified fact' }), d.modelText]));
    }
    parts.push(h('h4', {}, [h('i', { class: 'ww-lf-key is-recorded' }), 'Recorded']));
    parts.push(h('ul', {}, d.facts.map((f) => h('li', { text: f }))));
    if (d.actions.length) {
      parts.push(h('h4', { text: d.actions.length > 1 ? `Actions · ${d.actions.length} in one atomic step` : 'Action' }));
      parts.push(h('ol', { class: 'ww-ledger-actions' }, d.actions.map((a) => h('li', { text: a.seq === null ? `${a.text} (not applied)` : `${a.text} · seq #${a.seq}` }))));
    }
    parts.push(h('h4', {}, [h('i', { class: 'ww-lf-key is-observed' }), 'Observed changes']));
    if (d.observed.length === 0) parts.push(h('p', { class: 'ww-note', text: row.status === 'applied' ? 'No entity data changed.' : 'Nothing changed: the entry was not applied.' }));
    for (const e of d.observed) parts.push(this.entityBlock(e));
    if (d.derived.length) {
      parts.push(h('h4', {}, [h('i', { class: 'ww-lf-key is-derived' }), `Derived by rule · ${d.derived.length}`]));
      parts.push(h('ul', { class: 'ww-ledger-derived' }, d.derived.map((x) => h('li', {}, [this.entityName(x.id, x.name), ` ${x.text}`]))));
    }
    if (d.issues.length) {
      parts.push(h('h4', { text: 'Integrity issues' }));
      parts.push(h('ul', { class: 'ww-lf-banner is-error' }, d.issues.map((i) => h('li', { text: i }))));
    }
    if (d.historyNote) parts.push(h('p', { class: 'ww-note', text: d.historyNote }));
    parts.push(h('p', { class: 'ww-ledger-stateline', text: d.stateLine }));
    el.replaceChildren(...parts);
  }

  private entityBlock(e: LedgerDetail['observed'][number]): HTMLElement {
    const verb = e.change === 'added' ? 'added' : e.change === 'removed' ? 'removed' : 'changed';
    const rows = e.fields.map((f) =>
      h('tr', {}, [
        h('th', { text: f.label, attrs: { scope: 'row' } }),
        h('td', { class: 'is-before' }, [this.swatch(f.beforeColour), f.before]),
        h('td', { class: 'is-after' }, [this.swatch(f.afterColour), f.after]),
      ]),
    );
    return h('div', { class: 'ww-ledger-entity' }, [
      this.entityName(e.id, e.name),
      ` ${verb}`,
      rows.length
        ? h('table', { class: 'ww-ledger-fields' }, [
            h('thead', {}, [h('tr', {}, [h('th', { text: 'Field', attrs: { scope: 'col' } }), h('th', { text: 'Before', attrs: { scope: 'col' } }), h('th', { text: 'After', attrs: { scope: 'col' } })])]),
            h('tbody', {}, rows),
          ])
        : null,
    ]);
  }

  private entityName(id: EntityId, name: string): HTMLElement {
    const canFocus = this.deps.focusEntity && (this.deps.exists?.(id) ?? true);
    return canFocus
      ? h('button', { class: 'ww-ledger-entity-name', text: `“${name}”`, attrs: { type: 'button', title: 'Select in the studio' }, on: { click: () => this.deps.focusEntity!(id) } })
      : h('span', { class: 'ww-ledger-entity-name', text: `“${name}”` });
  }

  private swatch(colour: string | undefined): HTMLElement | null {
    if (!isHexColour(colour)) return null;
    const s = h('span', { class: 'ww-lf-swatch', attrs: { 'aria-hidden': 'true' } });
    s.style.background = colour;
    s.style.color = colour;
    return s;
  }

  // ------------------------------------------------------------ keyboard

  private buttons(): HTMLButtonElement[] {
    return [...this.list.querySelectorAll<HTMLButtonElement>('button.ww-ledger-head')];
  }

  private headButton(entryId: string): HTMLButtonElement | null {
    return this.buttons().find((b) => b.dataset.entry === entryId) ?? null;
  }

  private syncTabStops(): void {
    for (const b of this.buttons()) b.tabIndex = b.dataset.entry === this.focusId ? 0 : -1;
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('ww-ledger-head')) return;
    if (e.key === 'Escape') {
      const id = target.dataset.entry!;
      if (this.expanded.delete(id)) {
        e.preventDefault();
        this.renderList(false);
        this.headButton(id)?.focus();
      }
      return;
    }
    if (!isNavKey(e.key)) return;
    e.preventDefault();
    const buttons = this.buttons();
    const i = nextIndex(buttons.length, buttons.indexOf(target as HTMLButtonElement), e.key);
    const next = buttons[i];
    if (!next) return;
    this.focusId = next.dataset.entry!;
    this.syncTabStops();
    next.focus();
    next.scrollIntoView({ block: 'nearest', behavior: this.deps.reducedMotion?.() ? 'auto' : 'smooth' });
  }
}
