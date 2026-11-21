import type { LogEntry } from '../core/store';
import type { World } from '../core/types';
import type { StudioActions } from './actions';
import { clear, h, icon } from './dom';

const MAX_CHIPS = 200;
const SOURCE_LABEL = { system: 'SYS', user: 'YOU', director: 'AI' } as const;

/** Event rail: renders the store's real log. Undo/redo here act on the store. */
export class TimelinePanel {
  readonly element: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private renderedCount = -1;

  constructor(
    private readonly actions: StudioActions,
    private readonly genesis: { readonly seq: number; readonly entities: number; readonly seed: number; readonly restored?: boolean },
  ) {
    this.undoBtn = h('button', { class: 'ww-btn', title: 'Undo (Ctrl+Z)', attrs: { type: 'button' }, on: { click: () => actions.undo() } }, [icon('undo'), h('span', { text: 'Undo' })]);
    this.redoBtn = h('button', { class: 'ww-btn', title: 'Redo (Ctrl+Shift+Z)', attrs: { type: 'button' }, on: { click: () => actions.redo() } }, [icon('redo'), h('span', { text: 'Redo' })]);
    this.meta = h('span', { class: 'ww-panel-meta' });
    this.rail = h('ol', { class: 'ww-rail', attrs: { 'aria-label': 'World event log' } });
    this.element = h('footer', { class: 'ww-panel ww-glass ww-timeline' }, [
      h('div', { class: 'ww-timeline-controls' }, [
        h('div', { class: 'ww-timeline-title' }, [h('h2', { text: 'Timeline' }), this.meta]),
        h('div', { class: 'ww-btn-row' }, [this.undoBtn, this.redoBtn]),
      ]),
      h('div', { class: 'ww-rail-wrap' }, [this.rail]),
      h('div', { class: 'ww-timeline-legend' }, [
        h('p', { text: 'Session event log' }),
        h('p', {}, [h('span', { class: 'ww-chip is-planned', text: 'PLANNED' }), ' Causal Ledger, Parallel Futures, replay scrubbing']),
      ]),
    ]);
  }

  update(world: World, log: readonly LogEntry[]): void {
    const store = this.actions.store;
    this.undoBtn.disabled = !store.canUndo();
    this.redoBtn.disabled = !store.canRedo();
    const applied = log.filter((e) => (e.kind === 'event' || e.kind === 'batch') && e.ok).length;
    this.meta.textContent = `seq #${world.seq} · ${applied} edit${applied === 1 ? '' : 's'}`;
    if (log.length === this.renderedCount) return;
    this.renderedCount = log.length;

    clear(this.rail);
    this.rail.append(
      h('li', { class: 'ww-event is-genesis', title: this.genesis.restored ? 'Baseline: a world restored from a save. Earlier history was not kept.' : `Deterministic genesis from seed ${this.genesis.seed}` }, [
        h('span', { class: 'ww-event-index', text: `#${this.genesis.seq}` }),
        h('span', { class: 'ww-event-text', text: `${this.genesis.restored ? 'Restored baseline' : 'Genesis'} · ${this.genesis.entities} entities` }),
        h('span', { class: 'ww-source is-system', text: SOURCE_LABEL.system }),
      ]),
    );
    for (const entry of log.slice(-MAX_CHIPS)) this.rail.append(this.chip(world, entry));
    this.rail.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'end' });
  }

  private chip(world: World, entry: LogEntry): HTMLElement {
    const source = entry.event?.source ?? entry.meta?.source;
    const isChange = entry.kind === 'event' || entry.kind === 'batch';
    const state = (!isChange ? ' is-meta' : entry.ok ? '' : ' is-rejected') + (entry.kind === 'batch' ? ' is-batch' : '');
    const target = entry.entityId && world.entities[entry.entityId] ? entry.entityId : null;
    const title = entry.ok ? entry.summary : `Rejected: ${entry.reason ?? 'unknown reason'}`;
    return h(
      'li',
      {
        class: `ww-event${state}${target ? ' is-link' : ''}`,
        title,
        ...(target
          ? { attrs: { tabindex: '0', role: 'button' }, on: { click: () => this.actions.select(target), keydown: (e: KeyboardEvent) => e.key === 'Enter' && this.actions.select(target) } }
          : {}),
      },
      [
        h('span', { class: 'ww-event-index', text: `#${entry.worldSeq}` }),
        h('span', { class: 'ww-event-text', text: entry.ok ? entry.summary : `✕ ${entry.summary}` }),
        source ? h('span', { class: `ww-source is-${source}`, text: SOURCE_LABEL[source] }) : null,
      ],
    );
  }
}
