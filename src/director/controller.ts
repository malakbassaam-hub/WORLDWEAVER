/**
 * Director state machine (no DOM). The UI renders `DirectorState` and calls
 * the controller's methods; nothing changes the world except `apply()`, and
 * only after the user explicitly approves a validated, fully-accepted preview.
 *
 *   idle ──generate──▶ loading ──ok──▶ preview ──apply──▶ applied
 *    ▲                   │  └─error──▶ error ──retry──▶ loading
 *    └──cancel / discard / dismiss ◀──┘
 */
import type { WorldStore } from '../core/store';
import type { EntityId } from '../core/types';
import { applyTranslation, type ApplyOutcome } from './apply';
import { buildWorldContext } from './context';
import type { ClientResult, DirectorRequestBody, HealthInfo, ProxyMode } from './client';
import { applyMorph, PROPOSED_MORPH_POLICY, translateMorph, type MorphPolicy, type MorphTranslation } from './morph';
import type { WorldProposal } from './schema';
import { translateProposal, type Translation } from './translate';
import { parseProposalText, type ValidationIssue } from './validate';

export const PROMPT_MAX_CHARS = 2000;
export type DirectorTask = 'create' | 'edit';
export type DirectorStatus = 'idle' | 'loading' | 'preview' | 'error' | 'applied';

export interface DirectorError {
  readonly code: string;
  readonly message: string;
  readonly issues: readonly ValidationIssue[];
  /** Epoch ms before which Retry stays disabled, or null. */
  readonly retryAt: number | null;
  readonly retryable: boolean;
}

export interface DirectorPreview {
  /** 'morph' previews are translated and applied with the World Morph pin rules. */
  readonly kind: 'proposal' | 'morph';
  readonly proposal: WorldProposal;
  /** A `MorphTranslation` when `kind` is 'morph'. */
  readonly translation: Translation;
  readonly mode: ProxyMode;
  readonly requestId: string;
  readonly model?: string;
  readonly recordingId?: string;
  readonly recordingLabel?: string;
  /** True once the world changed after this preview was computed. */
  readonly stale: boolean;
}

export interface DirectorHealth {
  readonly mode: ProxyMode | 'checking' | 'offline';
  readonly model?: string;
  readonly liveReady: boolean;
  readonly reason?: string;
}

export interface DirectorState {
  readonly status: DirectorStatus;
  readonly task: DirectorTask;
  /** The prompt of the current or last request. */
  readonly prompt: string;
  readonly preview: DirectorPreview | null;
  readonly error: DirectorError | null;
  readonly health: DirectorHealth;
  readonly lastApplied: { readonly label: string; readonly entityIds: readonly EntityId[] } | null;
  /** Requests sent to the proxy in this session (diagnostics, tests). */
  readonly requestCount: number;
}

export interface DirectorDeps {
  readonly store: WorldStore;
  readonly request: (body: DirectorRequestBody, signal: AbortSignal) => Promise<ClientResult>;
  readonly health?: (signal: AbortSignal) => Promise<HealthInfo | null>;
  readonly now?: () => number;
  /** World Morph is off unless explicitly enabled. Policy defaults to the (unapproved) proposal. */
  readonly morph?: { readonly enabled: boolean; readonly policy?: MorphPolicy };
}

const NOT_RETRYABLE = new Set(['NO_KEY', 'AUTH', 'MODEL_NOT_FOUND', 'BAD_REQUEST', 'FORBIDDEN_ORIGIN', 'BLOCKED_SAFETY', 'PROMPT_INVALID', 'UPSTREAM_BAD_REQUEST']);

export class DirectorController {
  private state: DirectorState = {
    status: 'idle',
    task: 'create',
    prompt: '',
    preview: null,
    error: null,
    health: { mode: 'checking', liveReady: false },
    lastApplied: null,
    requestCount: 0,
  };
  private readonly listeners = new Set<(state: DirectorState) => void>();
  private readonly now: () => number;
  private token = 0;
  private inflight: AbortController | null = null;
  private lastRequest: { prompt: string; task: DirectorTask; morph: boolean } | null = null;
  private applying = false;
  private readonly unsubscribeStore: () => void;

  constructor(private readonly deps: DirectorDeps) {
    this.now = deps.now ?? Date.now;
    this.unsubscribeStore = deps.store.subscribe((world) => {
      const p = this.state.preview;
      // Our own apply() changes the world too; that must not mark the preview stale.
      if (this.applying) return;
      if (this.state.status === 'preview' && p && !p.stale && world.seq !== p.translation.baseSeq) {
        this.set({ preview: { ...p, stale: true } });
      }
    });
  }

  getState(): DirectorState {
    return this.state;
  }

  subscribe(listener: (state: DirectorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isBusy(): boolean {
    return this.state.status === 'loading';
  }

  setTask(task: DirectorTask): void {
    if (this.isBusy() || task === this.state.task) return;
    this.set({ task });
  }

  async refreshHealth(): Promise<void> {
    if (!this.deps.health) return;
    const info = await this.deps.health(new AbortController().signal);
    this.set({
      health: info
        ? { mode: info.mode, model: info.model, liveReady: info.liveReady, reason: info.modeReason }
        : { mode: 'offline', liveReady: false, reason: 'The Director proxy did not respond.' },
    });
  }

  /** Sends a request. Ignored while another request is running (no duplicates). */
  async generate(rawPrompt: string, task: DirectorTask = this.state.task): Promise<void> {
    return this.run(rawPrompt, task, false);
  }

  /** True only when World Morph was explicitly enabled for this controller. */
  isMorphEnabled(): boolean {
    return this.deps.morph?.enabled === true;
  }

  /**
   * Requests a World Morph (whole-world restyle with pinned-entity protection).
   * Refused with MORPH_DISABLED unless the controller was created with
   * `morph: { enabled: true }`. Not enabled in the studio (WW-031, WW-025).
   */
  async generateMorph(rawPrompt: string): Promise<void> {
    if (this.isBusy()) return;
    if (!this.isMorphEnabled()) {
      this.set({
        status: 'error',
        prompt: rawPrompt.normalize('NFC').trim(),
        preview: null,
        error: { code: 'MORPH_DISABLED', message: 'World Morph is not enabled yet.', issues: [], retryAt: null, retryable: false },
      });
      return;
    }
    return this.run(rawPrompt, this.state.task, true);
  }

  private async run(rawPrompt: string, task: DirectorTask, morph: boolean): Promise<void> {
    if (this.isBusy()) return;
    const prompt = rawPrompt.normalize('NFC').trim();
    if (prompt.length === 0 || prompt.length > PROMPT_MAX_CHARS) {
      this.set({
        status: 'error',
        task,
        prompt,
        preview: null,
        error: { code: 'PROMPT_INVALID', message: prompt.length === 0 ? 'Describe what you want to create or change.' : `Keep the request under ${PROMPT_MAX_CHARS} characters.`, issues: [], retryAt: null, retryable: false },
      });
      return;
    }
    const retryAt = this.state.error?.retryAt;
    if (this.state.status === 'error' && retryAt && retryAt > this.now()) return;

    const token = ++this.token;
    const abort = new AbortController();
    this.inflight = abort;
    this.lastRequest = { prompt, task, morph };
    const ctx = buildWorldContext(this.deps.store.getState());
    const body: DirectorRequestBody = {
      mode: morph ? 'morph' : task,
      prompt,
      world: { worldName: ctx.worldName, biome: ctx.biome, entityCount: ctx.entityCount, entities: ctx.entities },
    };
    this.set({ status: 'loading', task, prompt, preview: null, error: null, lastApplied: null, requestCount: this.state.requestCount + 1 });

    let result: ClientResult;
    try {
      result = await this.deps.request(body, abort.signal);
    } catch {
      result = { ok: false, code: 'NETWORK', message: 'The request failed unexpectedly.', issues: [] };
    }
    // Stale-response protection: a cancelled or superseded request never updates state.
    if (token !== this.token) return;
    this.inflight = null;

    if (result.mode) this.noteMode(result.mode);
    if (!result.ok) {
      if (result.code === 'CANCELLED') {
        this.set({ status: 'idle' });
        return;
      }
      this.fail(result.code, result.message, result.issues, result.retryAfterSec);
      return;
    }

    // Never trust the proxy either: validate the model text again here.
    const parsed = parseProposalText(result.text);
    if (!parsed.ok) {
      this.fail('INVALID_PROPOSAL', 'The proposal did not pass validation.', parsed.errors.slice(0, 10));
      return;
    }
    const kind = morph ? 'morph' : 'proposal';
    const translation = this.translate(kind, parsed.proposal);
    this.set({
      status: 'preview',
      preview: {
        kind,
        proposal: parsed.proposal,
        translation,
        mode: result.mode,
        requestId: result.requestId,
        ...(result.model ? { model: result.model } : {}),
        ...(result.recordingId ? { recordingId: result.recordingId } : {}),
        ...(result.recordingLabel ? { recordingLabel: result.recordingLabel } : {}),
        stale: false,
      },
    });
  }

  /** Cancels a running request; its response, if it still arrives, is ignored. */
  cancel(): void {
    if (!this.isBusy()) return;
    this.token += 1;
    this.inflight?.abort();
    this.inflight = null;
    this.set({ status: 'idle' });
  }

  async retry(): Promise<void> {
    if (this.state.status !== 'error' || !this.state.error?.retryable || !this.lastRequest) return;
    const at = this.state.error.retryAt;
    if (at && at > this.now()) return;
    const { prompt, task, morph } = this.lastRequest;
    if (morph) await this.generateMorph(prompt);
    else await this.generate(prompt, task);
  }

  /** Re-translates the same validated proposal against the current world (no model call). */
  refreshPreview(): void {
    const p = this.state.preview;
    if (this.state.status !== 'preview' || !p) return;
    this.set({ preview: { ...p, translation: this.translate(p.kind, p.proposal), stale: false } });
  }

  private translate(kind: DirectorPreview['kind'], proposal: WorldProposal): Translation {
    const world = this.deps.store.getState();
    return kind === 'morph' ? translateMorph(world, proposal, this.deps.morph?.policy ?? PROPOSED_MORPH_POLICY) : translateProposal(world, proposal);
  }

  /** The ONLY path by which the Director changes the world. */
  apply(): boolean {
    const p = this.state.preview;
    if (this.state.status !== 'preview' || !p || p.stale) return false;
    if (p.kind === 'morph' && !this.isMorphEnabled()) return false;
    const ctx = {
      mode: p.mode,
      requestId: p.requestId,
      ...(p.model ? { model: p.model } : {}),
      ...(p.recordingId ? { recordingId: p.recordingId } : {}),
    };
    this.applying = true;
    let outcome: ApplyOutcome;
    try {
      outcome = p.kind === 'morph' ? applyMorph(this.deps.store, p.translation as MorphTranslation, ctx) : applyTranslation(this.deps.store, p.translation, ctx);
    } finally {
      this.applying = false;
    }
    if (!outcome.ok) {
      if (outcome.code === 'STALE') this.set({ preview: { ...p, stale: true } });
      else if (outcome.code === 'REJECTED' || (p.kind === 'morph' && outcome.code === 'NOT_APPLICABLE' && p.translation.applicable)) {
        this.fail('APPLY_REJECTED', outcome.reason, []);
      }
      return false;
    }
    const entityIds = p.translation.events.flatMap((e) => (e.type === 'entity/added' ? [e.entity.id] : [e.id]));
    const label = this.deps.store.getLog().at(-1)?.summary ?? p.translation.display.summary;
    this.set({ status: 'applied', preview: null, lastApplied: { label, entityIds: [...new Set(entityIds)] } });
    return true;
  }

  discard(): void {
    if (this.state.status === 'preview') this.set({ status: 'idle', preview: null });
  }

  dismiss(): void {
    if (this.state.status === 'error' || this.state.status === 'applied') this.set({ status: 'idle', error: null, lastApplied: null });
  }

  dispose(): void {
    this.token += 1;
    this.inflight?.abort();
    this.unsubscribeStore();
    this.listeners.clear();
  }

  private noteMode(mode: ProxyMode): void {
    if (this.state.health.mode !== mode) this.set({ health: { ...this.state.health, mode } });
  }

  private fail(code: string, message: string, issues: readonly ValidationIssue[], retryAfterSec?: number): void {
    this.set({
      status: 'error',
      preview: null,
      error: {
        code,
        message,
        issues,
        retryAt: retryAfterSec !== undefined ? this.now() + retryAfterSec * 1000 : null,
        retryable: !NOT_RETRYABLE.has(code),
      },
    });
  }

  private set(patch: Partial<DirectorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}
