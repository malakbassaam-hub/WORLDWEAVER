import { h, icon } from './dom';

/**
 * AI World Director: integration area for Gemini planning (PLANNED, Phase 2).
 * Every control here is intentionally disabled. No network requests are made.
 */
export function createDirectorPanel(): HTMLElement {
  const planned = ['World Morph', 'Living Characters', 'Parallel Futures', 'Causal Ledger'];
  return h('section', { class: 'ww-panel ww-glass ww-director', attrs: { 'aria-label': 'AI World Director (planned)' } }, [
    h('header', { class: 'ww-panel-head' }, [
      h('h2', {}, [icon('spark'), h('span', { text: 'AI World Director' })]),
      h('span', { class: 'ww-chip is-planned', text: 'PLANNED' }),
    ]),
    h('textarea', {
      class: 'ww-director-input',
      attrs: {
        disabled: '',
        rows: '2',
        'aria-label': 'Describe a change (unavailable)',
        placeholder: 'Describe a change… e.g. "Bathe the citadel in violet and raise a moonlit lagoon."',
      },
    }),
    h('button', { class: 'ww-btn is-primary', attrs: { type: 'button', disabled: '' }, title: 'Unavailable in Phase 1' }, [
      h('span', { text: 'Weave · unavailable' }),
    ]),
    h('p', { class: 'ww-note', text: 'Gemini planning arrives in Phase 2 through a server-side proxy. The studio makes no AI or network calls today.' }),
    h('ul', { class: 'ww-planned-list' }, planned.map((name) => h('li', {}, [h('span', { text: name }), h('span', { class: 'ww-chip is-planned', text: 'PLANNED' })]))),
  ]);
}
