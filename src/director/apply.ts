/**
 * Applies a reviewed Director translation to the store as ONE atomic step.
 * Pure orchestration over WorldStore: no network, no model calls.
 */
import type { BatchMeta, WorldStore } from '../core/store';
import type { Translation } from './translate';

export type DirectorMode = 'live' | 'recorded';

/** What kind of Director change a batch records (for the Causal Ledger). */
export type DirectorChangeKind = 'create' | 'edit' | 'morph';

export interface ApplyContext {
  readonly mode: DirectorMode;
  readonly model?: string;
  readonly requestId?: string;
  readonly recordingId?: string;
  /** Recorded in batch details as `kind`; omitted when not given (Phase 2 behaviour). */
  readonly kind?: DirectorChangeKind;
  /** Additional string details (never secrets or prompt text). Cannot override standard keys. */
  readonly extraDetails?: Readonly<Record<string, string>>;
}

export type ApplyOutcome =
  | { readonly ok: true; readonly seq: number }
  | { readonly ok: false; readonly code: 'NOT_APPLICABLE' | 'STALE' | 'REJECTED'; readonly reason: string };

export const DIRECTOR_LABEL_MAX = 120;

export function batchMetaFor(translation: Translation, ctx: ApplyContext): BatchMeta {
  const base = ctx.kind === 'morph' ? 'Morph' : 'Director';
  const prefix = ctx.mode === 'recorded' ? `${base} (recorded)` : base;
  const label = `${prefix}: ${translation.display.summary}`;
  return {
    label: label.length > DIRECTOR_LABEL_MAX ? `${label.slice(0, DIRECTOR_LABEL_MAX - 1)}…` : label,
    source: 'director',
    details: {
      ...(ctx.extraDetails ?? {}),
      ...(ctx.kind ? { kind: ctx.kind } : {}),
      proposalKey: translation.proposalKey,
      mode: ctx.mode,
      ...(ctx.model ? { model: ctx.model } : {}),
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      ...(ctx.recordingId ? { recordingId: ctx.recordingId } : {}),
      operations: String(translation.outcomes.length),
      events: String(translation.events.length),
    },
  };
}

/**
 * Refuses translations with any rejected operation, and translations computed
 * against an older world state (the user edited the world after previewing).
 */
export function applyTranslation(store: WorldStore, translation: Translation, ctx: ApplyContext): ApplyOutcome {
  if (!translation.applicable) {
    return { ok: false, code: 'NOT_APPLICABLE', reason: `${translation.rejected} of ${translation.outcomes.length} operations were rejected; the proposal cannot be applied.` };
  }
  if (store.getState().seq !== translation.baseSeq) {
    return { ok: false, code: 'STALE', reason: 'The world changed after this preview was made. Refresh the preview before applying.' };
  }
  const result = store.dispatchBatch(translation.events, batchMetaFor(translation, ctx));
  if (!result.ok) return { ok: false, code: 'REJECTED', reason: result.reason };
  return { ok: true, seq: result.world.seq };
}
