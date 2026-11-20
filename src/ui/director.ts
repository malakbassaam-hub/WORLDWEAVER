import type { WorldStore } from '../core/store';
import type { EntityId } from '../core/types';
import { PROMPT_MAX_CHARS, type DirectorController, type DirectorState, type DirectorTask } from '../director/controller';
import { describeOperations, summarizeTranslation } from '../director/describe';
import { clear, h, icon } from './dom';

/** Friendly titles for error codes from the proxy, client and controller. */
const ERROR_TITLES: Readonly<Record<string, string>> = {
  NO_KEY: 'Live mode is not configured',
  AUTH: 'Gemini rejected the API key',
  MODEL_NOT_FOUND: 'Model not found',
  RATE_LIMITED: 'Gemini rate limit reached',
  LOCAL_RATE_LIMITED: 'Please wait a moment',
  SUPERSEDED: 'Replaced by a newer request',
  TIMEOUT: 'Gemini took too long',
  NETWORK: 'Connection problem',
  UPSTREAM: 'Gemini error',
  UPSTREAM_BAD_REQUEST: 'Request not accepted',
  BLOCKED_SAFETY: 'Blocked by safety filters',
  TRUNCATED: 'Proposal was cut off',
  EMPTY: 'No proposal returned',
  INVALID_PROPOSAL: 'Proposal failed validation',
  MALFORMED_RESPONSE: 'Unreadable response',
  BAD_REQUEST: 'Request rejected',
  FORBIDDEN_ORIGIN: 'Request refused',
  PROMPT_INVALID: 'Check your request',
  APPLY_REJECTED: 'Could not apply the proposal',
  MORPH_DISABLED: 'World Morph is not enabled yet',
};

const PLACEHOLDERS: Readonly<Record<DirectorTask, string>> = {
  create: 'Describe what to add… e.g. "A crystal garden on the main isle, ringed by violet spires."',
  edit: 'Describe a change… e.g. "Bathe the sentinel spires in violet and raise two of them."',
};

const MORPH_PLACEHOLDER = 'Describe a whole-world restyle… e.g. "Make the kingdom darker and more apocalyptic." Pinned entities stay unchanged.';

export interface DirectorPanelHooks {
  /** Called after a proposal is applied, with the entities it created or changed. */
  onApplied(entityIds: readonly EntityId[], label: string): void;
  focusEntity(id: EntityId): void;
}

/** AI World Director panel: prompt, preview, explicit approval. */
export class DirectorPanel {
  readonly element: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly prompt: HTMLTextAreaElement;
  private readonly counter: HTMLElement;
  private readonly generateBtn: HTMLButtonElement;
  private readonly taskButtons: Record<DirectorTask, HTMLButtonElement>;
  private readonly morphBtn: HTMLElement | null;
  private readonly status: HTMLElement;
  private readonly modeNote: HTMLElement;
  private countdown = 0;
  private lastStatus: DirectorState['status'] | null = null;
  private lastPreviewKey: string | null = null;
  private isMorphMode = false;

  constructor(
    private readonly controller: DirectorController,
    private readonly store: WorldStore,
    private readonly hooks: DirectorPanelHooks,
  ) {
    this.badge = h('span', { class: 'ww-mode-badge is-checking', text: 'CHECKING', attrs: { role: 'status' } });

    const task = (t: DirectorTask, label: string) =>
      h('button', {
        class: 'ww-seg-btn',
        text: label,
        attrs: { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-task': t },
        on: { click: () => this.controller.setTask(t) },
      });
    this.taskButtons = { create: task('create', 'Create'), edit: task('edit', 'Edit') };
    this.morphBtn = controller.isMorphEnabled()
      ? h('button', { class: 'ww-seg-btn', text: 'Morph', attrs: { type: 'button', role: 'button', 'aria-label': 'World Morph: restyle the whole world with pinned-entity protection' }, on: { click: () => this.submitMorph() } })
      : null;

    this.prompt = h('textarea', {
      class: 'ww-director-input',
      attrs: { id: 'ww-director-prompt', rows: '3', maxlength: String(PROMPT_MAX_CHARS), 'aria-label': 'Describe what the AI World Director should do', spellcheck: 'true', dir: 'auto' },
      on: {
        input: () => this.updateControls(this.controller.getState()),
        keydown: (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.submit();
          }
        },
      },
    });
    this.counter = h('span', { class: 'ww-counter', attrs: { 'aria-hidden': 'true' } });
    this.generateBtn = h('button', { class: 'ww-btn is-primary ww-generate', attrs: { type: 'button' }, title: 'Generate a proposal (Ctrl+Enter)', on: { click: () => this.submit() } }, [
      icon('spark'),
      h('span', { text: 'Generate' }),
    ]);
    this.status = h('div', { class: 'ww-director-status', attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' } });
    this.modeNote = h('p', { class: 'ww-note ww-mode-note' });

    this.element = h(
      'section',
      {
        class: 'ww-panel ww-glass ww-director',
        attrs: { 'aria-label': 'AI World Director' },
        on: {
          keydown: (e) => {
            if (e.key === 'Escape' && this.controller.isBusy()) {
              e.preventDefault();
              this.controller.cancel();
            }
          },
        },
      },
      [
        h('header', { class: 'ww-panel-head' }, [h('h2', {}, [icon('spark'), h('span', { text: 'AI World Director' })]), this.badge]),
        h('div', { class: 'ww-seg', attrs: { role: 'radiogroup', 'aria-label': 'Director task' } }, [this.taskButtons.create, this.taskButtons.edit]),
        this.morphBtn ? h('div', { class: 'ww-morph-row' }, [this.morphBtn]) : null,
        h('label', { class: 'ww-sr-only', text: 'Request', attrs: { for: 'ww-director-prompt' } }),
        this.prompt,
        h('div', { class: 'ww-director-row' }, [this.counter, this.generateBtn]),
        this.status,
        this.modeNote,
        h('details', { class: 'ww-planned' }, [
          h('summary', { text: 'Next flagship features' }),
          h('ul', { class: 'ww-planned-list' }, ['World Morph', 'Living Characters', 'Parallel Futures', 'Causal Ledger'].map((n) => h('li', {}, [h('span', { text: n }), h('span', { class: 'ww-chip is-planned', text: 'PLANNED' })]))),
        ]),
      ],
    );

    controller.subscribe((s) => this.render(s));
    this.render(controller.getState());
  }

  dispose(): void {
    window.clearInterval(this.countdown);
  }

  private submit(): void {
    if (this.controller.isBusy()) return; // duplicate submissions are ignored
    if (this.isMorphMode) {
      void this.controller.generateMorph(this.prompt.value);
    } else {
      void this.controller.generate(this.prompt.value);
    }
  }

  private submitMorph(): void {
    this.isMorphMode = true;
  }

  private render(s: DirectorState): void {
    this.renderBadge(s);
    this.updateControls(s);
    this.renderStatus(s);
    this.manageFocus(s);
    this.lastStatus = s.status;
  }

  private renderBadge(s: DirectorState): void {
    const mode = s.health.mode;
    const text = mode === 'live' ? 'LIVE' : mode === 'recorded' ? 'RECORDED' : mode === 'offline' ? 'OFFLINE' : 'CHECKING';
    this.badge.textContent = text;
    this.badge.className = `ww-mode-badge is-${mode}`;
    this.badge.title =
      mode === 'live'
        ? `Live Gemini (${s.health.model ?? 'model'}) through the local proxy. Your key stays on the server.`
        : mode === 'recorded'
          ? `Recorded responses: pre-written samples, not live AI. ${s.health.reason ?? ''}`.trim()
          : mode === 'offline'
            ? 'The Director proxy is not reachable.'
            : 'Checking the Director proxy…';
    this.modeNote.textContent =
      mode === 'live'
        ? 'Live mode: requests go to Gemini through the local proxy. Your API key never reaches this page.'
        : mode === 'recorded'
          ? 'Recorded mode: responses are pre-written samples, not live AI output. Set GEMINI_API_KEY on the server for live mode.'
          : mode === 'offline'
            ? 'The Director proxy did not respond. Start the studio with npm run dev.'
            : '';
  }

  private updateControls(s: DirectorState): void {
    const busy = s.status === 'loading';
    for (const [t, btn] of Object.entries(this.taskButtons)) {
      const on = s.task === t;
      btn.setAttribute('aria-checked', String(on));
      btn.classList.toggle('is-active', on);
      btn.disabled = busy;
    }
    this.prompt.placeholder = this.isMorphMode ? MORPH_PLACEHOLDER : PLACEHOLDERS[s.task];
    this.prompt.readOnly = busy;
    const length = this.prompt.value.trim().length;
    this.counter.textContent = `${this.prompt.value.length} / ${PROMPT_MAX_CHARS}`;
    const waiting = s.status === 'error' && s.error?.retryAt !== null && (s.error?.retryAt ?? 0) > Date.now();
    const morphDisabled = this.isMorphMode && !this.controller.isMorphEnabled();
    this.generateBtn.disabled = busy || length === 0 || waiting || s.health.mode === 'offline' || morphDisabled;
    this.generateBtn.setAttribute('aria-busy', String(busy));
    if (morphDisabled) this.generateBtn.title = 'World Morph is not enabled yet (WW-031).';
    else this.generateBtn.setAttribute('title', 'Generate a proposal (Ctrl+Enter)');
  }

  private renderStatus(s: DirectorState): void {
    window.clearInterval(this.countdown);
    // Keep the preview DOM stable while it is unchanged (focus, scroll).
    const previewKey = s.status === 'preview' && s.preview ? `${s.preview.requestId}:${s.preview.translation.proposalKey}:${s.preview.stale}` : null;
    if (previewKey && previewKey === this.lastPreviewKey && this.lastStatus === 'preview') return;
    this.lastPreviewKey = previewKey;
    clear(this.status);
    switch (s.status) {
      case 'idle':
        return;
      case 'loading':
        this.status.append(
          h('div', { class: 'ww-director-card is-loading' }, [
            h('span', { class: 'ww-spinner', attrs: { 'aria-hidden': 'true' } }),
            h('span', { text: s.health.mode === 'live' ? 'Asking Gemini…' : 'Loading a recorded response…' }),
            h('button', { class: 'ww-btn is-small', text: 'Cancel', attrs: { type: 'button', 'data-action': 'cancel' }, title: 'Cancel (Esc)', on: { click: () => this.controller.cancel() } }),
          ]),
        );
        return;
      case 'preview':
        this.status.append(this.previewCard(s));
        return;
      case 'error':
        this.status.append(this.errorCard(s));
        return;
      case 'applied': {
        const applied = s.lastApplied;
        const first = applied?.entityIds[0];
        this.status.append(
          h('div', { class: 'ww-director-card is-applied', attrs: { role: 'status' } }, [
            h('p', { class: 'ww-card-title', text: 'Applied to the world' }),
            h('p', { text: applied?.label ?? '' }),
            h('p', { class: 'ww-note', text: 'This was one step: undo it with Ctrl+Z.' }),
            h('div', { class: 'ww-btn-row' }, [
              first ? h('button', { class: 'ww-btn is-small', text: 'Show in viewport', attrs: { type: 'button' }, on: { click: () => this.hooks.focusEntity(first) } }) : null,
              h('button', { class: 'ww-btn is-small is-ghost', text: 'Done', attrs: { type: 'button' }, on: { click: () => this.controller.dismiss() } }),
            ]),
          ]),
        );
        return;
      }
    }
  }

  private previewCard(s: DirectorState): HTMLElement {
    const p = s.preview!;
    const t = p.translation;
    const sum = summarizeTranslation(t);
    const lines = describeOperations(this.store.getState(), p.proposal.operations);
    const stats = [`${sum.operations} operation${sum.operations === 1 ? '' : 's'}`, sum.added ? `${sum.added} new` : null, sum.changed ? `${sum.changed} change${sum.changed === 1 ? '' : 's'}` : null, sum.removed ? `${sum.removed} removed` : null]
      .filter(Boolean)
      .join(' · ');
    const blocked = !t.applicable;
    const isMorph = p.kind === 'morph';
    const apply = h('button', {
      class: 'ww-btn is-primary',
      attrs: { type: 'button', 'data-action': 'apply', ...(blocked || p.stale ? { disabled: '' } : {}) },
      title: blocked ? 'Every operation must be valid before the proposal can be applied.' : 'Apply this proposal as one undoable step',
      on: {
        click: () => {
          if (this.controller.apply()) {
            const applied = this.controller.getState().lastApplied;
            if (applied) this.hooks.onApplied(applied.entityIds, applied.label);
          }
        },
      },
    }, [h('span', { text: 'Apply' })]);

    const morphInfo = isMorph ? this.morphPreviewInfo(t as any, (id) => this.store.getState().entities[id]?.name ?? id) : null;

    return h('div', { class: `ww-director-card is-preview${blocked ? ' is-blocked' : ''}${isMorph ? ' is-morph' : ''}` }, [
      h('div', { class: 'ww-card-head' }, [
        h('p', { class: 'ww-card-title', text: isMorph ? 'World Morph preview' : 'Proposal preview' }),
        h('span', { class: `ww-chip ${p.mode === 'live' ? 'is-live' : 'is-recorded'}`, text: p.mode === 'live' ? 'LIVE · Gemini' : 'RECORDED · not live AI' }),
      ]),
      h('p', { class: 'ww-note', text: 'Nothing has changed yet. Review, then Apply or Discard.' }),
      p.mode === 'recorded' && p.recordingLabel ? h('p', { class: 'ww-note', text: `Recording: ${p.recordingLabel}` }) : null,
      h('p', { class: 'ww-proposal-summary', text: t.display.summary, attrs: { dir: 'auto' } }),
      h('p', { class: 'ww-proposal-stats', text: stats }),
      morphInfo,
      h(
        'ol',
        { class: 'ww-op-list', attrs: { 'aria-label': 'Proposed operations' } },
        t.outcomes.map((o, i) =>
          h('li', { class: `ww-op is-${o.status}` }, [
            h('span', { class: 'ww-op-mark', text: o.status === 'accepted' ? '✓' : '✕', attrs: { 'aria-label': o.status } }),
            h('span', { class: 'ww-op-text', attrs: { dir: 'auto' } }, [
              h('span', { text: lines[i] ?? o.op }),
              o.reason ? h('span', { class: 'ww-op-reason', text: o.reason }) : null,
            ]),
          ]),
        ),
      ),
      blocked ? h('p', { class: 'ww-warn', text: `${t.rejected} operation${t.rejected === 1 ? ' was' : 's were'} rejected, so the proposal cannot be applied. Nothing is applied partially.` }) : null,
      p.stale
        ? h('div', { class: 'ww-warn' }, [
            h('span', { text: 'The world changed after this preview was made. ' }),
            h('button', { class: 'ww-link', text: 'Refresh preview', attrs: { type: 'button', 'data-action': 'refresh' }, on: { click: () => this.controller.refreshPreview() } }),
          ])
        : null,
      h('div', { class: 'ww-btn-row' }, [
        apply,
        h('button', { class: 'ww-btn', text: 'Discard', attrs: { type: 'button', 'data-action': 'discard' }, on: { click: () => this.controller.discard() } }),
      ]),
    ]);
  }

  private morphPreviewInfo(t: { pinned: readonly string[]; protectedAncestors: readonly string[]; pinRejections: number; violations: readonly { readonly id: string; readonly kind: string; readonly message: string }[]; blockedReason?: string; policyApproved: boolean }, nameForId: (id: string) => string): HTMLElement {
    const items: Array<string | HTMLElement> = [];
    if (t.pinned.length > 0) {
      items.push(h('p', { class: 'ww-note', text: `Pinned entities (never animated): ${t.pinned.map((id) => `“${nameForId(id)}”`).join(', ')}` }));
    }
    if (t.protectedAncestors.length > 0) {
      items.push(h('p', { class: 'ww-note', text: `Protected ancestors: ${t.protectedAncestors.map((id) => `“${nameForId(id)}”`).join(', ')}` }));
    }
    if (t.blockedReason) {
      items.push(h('p', { class: 'ww-warn', text: t.blockedReason }));
    }
    if (t.violations.length > 0) {
      const violationItems = t.violations.map((v) =>
        h('li', {}, [h('code', { text: v.kind }), h('span', { text: ` ${v.message}` })]),
      );
      items.push(
        h('div', { class: 'ww-warn' }, [
          h('p', { text: 'Pinned protection violations:' }),
          h('ul', { class: 'ww-issue-list' }, violationItems),
        ]),
      );
    }
    if (!t.policyApproved) {
      items.push(h('p', { class: 'ww-note', text: 'Morph policy is proposed but not yet approved (WW-031).' }));
    }
    if (items.length === 0) return h('div');
    return h('div', { class: 'ww-morph-info' }, items);
  }

  private errorCard(s: DirectorState): HTMLElement {
    const e = s.error!;
    const retry = h('button', {
      class: 'ww-btn is-small',
      attrs: { type: 'button', 'data-action': 'retry', ...(e.retryable ? {} : { disabled: '' }) },
      on: { click: () => void this.controller.retry() },
    });
    const tick = () => {
      const left = e.retryAt ? Math.ceil((e.retryAt - Date.now()) / 1000) : 0;
      retry.textContent = left > 0 ? `Retry in ${left} s` : 'Retry';
      retry.disabled = !e.retryable || left > 0;
      if (left <= 0) {
        window.clearInterval(this.countdown);
        this.updateControls(this.controller.getState());
      }
    };
    tick();
    if (e.retryAt && e.retryAt > Date.now()) this.countdown = window.setInterval(tick, 250);

    return h('div', { class: 'ww-director-card is-error', attrs: { role: 'alert' } }, [
      h('p', { class: 'ww-card-title', text: ERROR_TITLES[e.code] ?? 'Something went wrong' }),
      h('p', { text: e.message }),
      e.issues.length
        ? h(
            'ul',
            { class: 'ww-issue-list', attrs: { 'aria-label': 'Validation problems' } },
            e.issues.slice(0, 6).map((i) => h('li', {}, [h('code', { text: i.path || '(response)' }), h('span', { text: ` ${i.message}` })])),
          )
        : null,
      e.code === 'NO_KEY' ? h('p', { class: 'ww-note', text: 'Set GEMINI_API_KEY in the terminal that runs the studio, then restart it. See README → AI World Director.' }) : null,
      h('div', { class: 'ww-btn-row' }, [
        e.retryable ? retry : null,
        h('button', { class: 'ww-btn is-small is-ghost', text: 'Dismiss', attrs: { type: 'button', 'data-action': 'dismiss' }, on: { click: () => this.controller.dismiss() } }),
      ]),
    ]);
  }

  private manageFocus(s: DirectorState): void {
    if (s.status === this.lastStatus) return;
    const target =
      s.status === 'preview'
        ? (this.status.querySelector<HTMLButtonElement>('[data-action="apply"]:not([disabled])') ?? this.status.querySelector<HTMLButtonElement>('[data-action="discard"]'))
        : s.status === 'error'
          ? this.status.querySelector<HTMLButtonElement>('[data-action="retry"]:not([disabled])') ?? this.status.querySelector<HTMLButtonElement>('[data-action="dismiss"]')
          : s.status === 'idle' && this.lastStatus === 'loading'
            ? this.prompt
            : null;
    target?.focus({ preventScroll: false });
  }
}
