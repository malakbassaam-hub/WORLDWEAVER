/**
 * Director and World Morph proposals inside a Parallel Future.
 *
 * The only way a model's output reaches a future: the proposal is validated
 * (`validateProposal`), translated deterministically against the FUTURE's
 * current world (`translateProposal` or `translateMorph` with the approved
 * WW-031 policy), and applied as one future step. The original world is never
 * touched; committing the future is a separate, explicit user action
 * (`FuturesManager.commit`).
 *
 * No network, no model calls.
 */
import { FUTURE_LIMITS, type FutureResult, type FutureView, type FuturesManager } from '../core/futures';
import { batchMetaFor, type DirectorChangeKind, type DirectorMode } from './apply';
import { APPROVED_MORPH_POLICY, describePolicy, translateMorph, type MorphPolicy, type MorphTranslation } from './morph';
import type { WorldProposal } from './schema';
import { translateProposal, type Translation } from './translate';
import { validateProposal } from './validate';

export interface FutureProposalContext {
  readonly kind: DirectorChangeKind;
  readonly mode: DirectorMode;
  readonly model?: string;
  readonly requestId?: string;
  readonly recordingId?: string;
  /** Morph policy; defaults to the approved WW-031 policy. */
  readonly policy?: MorphPolicy;
}

export type FutureProposalOutcome =
  | { readonly ok: true; readonly future: FutureView; readonly translation: Translation | MorphTranslation }
  | { readonly ok: false; readonly code: 'INVALID_PROPOSAL' | 'NOT_APPLICABLE' | 'NO_FUTURE' | 'FUTURE_REFUSED'; readonly reason: string; readonly translation?: Translation | MorphTranslation };

/**
 * Validates, translates and applies an untrusted proposal to one future.
 * `raw` may be the parsed model output; it is validated here.
 */
export function proposeInFuture(manager: FuturesManager, futureId: string, raw: unknown, ctx: FutureProposalContext): FutureProposalOutcome {
  const valid = validateProposal(raw);
  if (!valid.ok) return { ok: false, code: 'INVALID_PROPOSAL', reason: valid.errors.map((e) => `${e.path || 'proposal'}: ${e.message}`).join(' ') };
  return applyProposalToFuture(manager, futureId, valid.proposal, ctx);
}

export function applyProposalToFuture(manager: FuturesManager, futureId: string, proposal: WorldProposal, ctx: FutureProposalContext): FutureProposalOutcome {
  const world = manager.state(futureId);
  if (!world) return { ok: false, code: 'NO_FUTURE', reason: 'No such open future.' };
  const policy = ctx.policy ?? APPROVED_MORPH_POLICY;
  const translation = ctx.kind === 'morph' ? translateMorph(world, proposal, policy) : translateProposal(world, proposal);
  if (!translation.applicable) {
    const blocked = (translation as Partial<MorphTranslation>).blockedReason;
    const reason = blocked ?? `${translation.rejected} of ${translation.outcomes.length} operations were rejected; the proposal cannot be applied.`;
    return { ok: false, code: 'NOT_APPLICABLE', reason, translation };
  }
  const meta = batchMetaFor(translation, {
    mode: ctx.mode,
    kind: ctx.kind,
    ...(ctx.model ? { model: ctx.model } : {}),
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx.recordingId ? { recordingId: ctx.recordingId } : {}),
    ...(ctx.kind === 'morph' ? { extraDetails: { policy: describePolicy(policy) } } : {}),
  });
  const label = clip(meta.label, FUTURE_LIMITS.maxLabelLength);
  const applied: FutureResult<FutureView> = manager.apply(futureId, translation.events, { label, ...(meta.details ? { details: meta.details } : {}) });
  if (!applied.ok) return { ok: false, code: 'FUTURE_REFUSED', reason: `${applied.code}: ${applied.reason}`, translation };
  return { ok: true, future: applied.value, translation };
}

/** Clips to at most `max` UTF-16 code units without splitting a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}
