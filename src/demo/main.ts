/**
 * Demo page entry (ledger-futures-demo.html). Mounts the real panels with the
 * real adapter on a deterministic recorded session. There is NO 3D renderer
 * here; the page says so. Director requests go to the same-origin proxy via
 * the standard client (recorded or live, as the proxy reports).
 */
import '../ui/styles.css';
import './demo.css';
import { worldFingerprint } from '../core/fingerprint';
import { fetchHealth, requestProposal } from '../director/client';
import { h } from '../ui/dom';
import { mountLedgerFutures } from '../ui/ledgerFutures';
import { buildDemoSession, DEMO_SCENARIOS, seedFutures, type DemoScenario } from './fixtures';

const params = new URLSearchParams(location.search);
const asked = params.get('scenario');
const scenario: DemoScenario = (DEMO_SCENARIOS as readonly string[]).includes(asked ?? '') ? (asked as DemoScenario) : 'futures';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const host = document.getElementById('app')!;
document.body.classList.add('ww-demo');
const session = buildDemoSession(scenario);
const { store, initial } = session;
const script = [...session.script];

const modeChip = h('span', { class: 'ww-chip is-recorded', text: 'Director: checking…' });
const worldLine = h('span', { class: 'ww-demo-world', attrs: { 'data-testid': 'world-state', 'aria-live': 'off' } });
const undoBtn = h('button', { class: 'ww-btn is-small', text: 'Undo', attrs: { type: 'button' }, on: { click: () => store.undo() } });
const redoBtn = h('button', { class: 'ww-btn is-small', text: 'Redo', attrs: { type: 'button' }, on: { click: () => store.redo() } });
const editBtn = h('button', { class: 'ww-btn is-small is-ghost', text: 'Edit the real world', title: 'Renames one spire, so you can see live ledger updates and stale futures', attrs: { type: 'button' }, on: { click: () => {
  const id = store.getState().order[6]!;
  store.dispatch({ type: 'entity/renamed', id, name: `Real edit ${store.getState().seq}`, source: 'user' });
} } });

const lf = mountLedgerFutures({
  store,
  initial,
  request: (body, signal) => requestProposal(body, { signal }),
  morphEnabled: true,
  presenter: null,
  reducedMotion: reduced,
  onError: (e) => console.error(e),
});
const futureIds = seedFutures(lf.manager, store, scenario, script);
lf.futures.update();
if (scenario === 'history') lf.ledger.open(Math.max(0, store.getLog().length - 4));
void futureIds;

const syncTop = () => {
  const w = store.getState();
  worldLine.textContent = `Real world · seq #${w.seq} · ${w.order.length} entities · state ${worldFingerprint(w).slice(0, 8)}`;
  undoBtn.disabled = !store.canUndo();
  redoBtn.disabled = !store.canRedo();
};
store.subscribe(syncTop);
syncTop();

void fetchHealth().then((health) => {
  if (!health) {
    modeChip.textContent = 'Director proxy offline';
    modeChip.className = 'ww-chip';
    return;
  }
  modeChip.textContent = health.mode === 'live' ? 'Director: LIVE AI' : 'Director: RECORDED · not live AI';
  modeChip.className = `ww-chip ${health.mode === 'live' ? 'is-live' : 'is-recorded'}`;
});

host.replaceChildren(
  h('div', { class: 'ww-demo-app' }, [
    h('header', { class: 'ww-demo-top ww-glass' }, [
      h('span', { class: 'ww-brand-name', text: 'WORLDWEAVER' }),
      h('h1', { text: 'Causal Ledger and Parallel Futures' }),
      h('span', { class: 'ww-chip', text: 'Panel demo · no 3D renderer on this page' }),
      modeChip,
      h('nav', { class: 'ww-demo-scenarios', attrs: { 'aria-label': 'Demo scenarios' } }, DEMO_SCENARIOS.map((s) =>
        h('a', { text: s, attrs: { href: `?scenario=${s}`, ...(s === scenario ? { 'aria-current': 'page' } : {}) } }),
      )),
      h('span', { class: 'ww-demo-spacer' }),
      worldLine,
      h('div', { class: 'ww-btn-row' }, [undoBtn, redoBtn, editBtn]),
    ]),
    h('main', { class: 'ww-demo-grid' }, [lf.ledger.element, lf.futures.element]),
    h('section', { class: 'ww-demo-script ww-glass', attrs: { 'aria-label': 'What this demo did' } }, [
      h('h2', { text: 'Demo script (deterministic, recorded responses)' }),
      script.length ? h('ol', {}, script.map((s) => h('li', { text: s }))) : h('p', { text: 'Empty scenario: nothing has happened yet.' }),
    ]),
  ]),
);

if (import.meta.hot) import.meta.hot.dispose(() => lf.dispose());
