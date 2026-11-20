/**
 * Ask the AI Director for a proposal INSIDE a Parallel Future.
 *
 * Same pipeline as the studio Director, against the future's own world:
 *   request (injected; the studio passes `requestProposal`, which only talks to
 *   the same-origin proxy) → `parseProposalText` (strict validation of untrusted
 *   model text) → translation and the future's step checks (`applyProposalToFuture`).
 *
 * The original world is never touched. If the future changed while the
 * request was running, the response is discarded (no silent re-targeting).
 * No network code here; no secrets; model text is data only.
 */
import type { FuturesManager, FutureView } from '../core/futures';
import { buildWorldContext } from './context';
import type { ClientResult, DirectorRequestBody } from './client';
import { PROMPT_MAX_CHARS } from './controller';
import { applyProposalToFuture } from './futures';
import type { MorphTranslation } from './morph';
import type { Translation } from './translate';
import { parseProposalText, type ValidationIssue } from './validate';

export type FutureTask = 'edit' | 'morph';

export type FutureRequestOutcome =
  | {
      readonly ok: true;
      readonly future: FutureView;
      readonly translation: Translation | MorphTranslation;
      readonly mode: 'live' | 'recorded';
      readonly recordingLabel?: string;
    }
  | {
      readonly ok: false;
      readonly code: 'INVALID_PROMPT' | 'NO_FUTURE' | 'CANCELLED' | 'REQUEST_FAILED' | 'STALE_FUTURE' | 'INVALID_PROPOSAL' | 'NOT_APPLICABLE' | 'FUTURE_REFUSED';
      readonly reason: string;
      readonly issues?: readonly ValidationIssue[];
      readonly retryAfterSec?: number;
      readonly translation?: Translation | MorphTranslation;
    };

export type ProposalRequest = (body: DirectorRequestBody, signal: AbortSignal) => Promise<ClientResult>;

export async function requestFutureProposal(
  manager: FuturesManager,
  futureId: string,
  rawPrompt: string,
  task: FutureTask,
  request: ProposalRequest,
  signal: AbortSignal,
): Promise<FutureRequestOutcome> {
  const prompt = typeof rawPrompt === 'string' ? rawPrompt.normalize('NFC').trim() : '';
  if (prompt.length === 0 || prompt.length > PROMPT_MAX_CHARS) return { ok: false, code: 'INVALID_PROMPT', reason: `Describe the change in 1 to ${PROMPT_MAX_CHARS} characters.` };
  const world = manager.state(futureId);
  const before = manager.get(futureId);
  if (!world || !before) return { ok: false, code: 'NO_FUTURE', reason: 'This future is no longer open.' };

  const ctx = buildWorldContext(world);
  const body: DirectorRequestBody = { mode: task, prompt, world: { worldName: ctx.worldName, biome: ctx.biome, entityCount: ctx.entityCount, entities: ctx.entities } };
  let result: ClientResult;
  try {
    result = await request(body, signal);
  } catch {
    return signal.aborted ? { ok: false, code: 'CANCELLED', reason: 'The request was cancelled.' } : { ok: false, code: 'REQUEST_FAILED', reason: 'The Director request failed unexpectedly.' };
  }
  if (signal.aborted) return { ok: false, code: 'CANCELLED', reason: 'The request was cancelled.' };
  if (!result.ok) {
    if (result.code === 'CANCELLED') return { ok: false, code: 'CANCELLED', reason: result.message };
    return { ok: false, code: 'REQUEST_FAILED', reason: result.message, issues: result.issues, ...(result.retryAfterSec !== undefined ? { retryAfterSec: result.retryAfterSec } : {}) };
  }

  const now = manager.get(futureId);
  if (!now || now.status !== 'open') return { ok: false, code: 'NO_FUTURE', reason: 'This future was closed while the Director was working.' };
  if (now.state.fingerprint !== before.state.fingerprint || now.state.seq !== before.state.seq) {
    return { ok: false, code: 'STALE_FUTURE', reason: 'This future changed while the Director was working. The response was discarded; ask again.' };
  }

  const parsed = parseProposalText(result.text);
  if (!parsed.ok) return { ok: false, code: 'INVALID_PROPOSAL', reason: 'The Director response did not pass validation, so nothing was changed.', issues: parsed.errors };

  const applied = applyProposalToFuture(manager, futureId, parsed.proposal, {
    kind: task,
    mode: result.mode,
    requestId: result.requestId,
    ...(result.model ? { model: result.model } : {}),
    ...(result.recordingId ? { recordingId: result.recordingId } : {}),
  });
  if (!applied.ok) {
    const code = applied.code === 'NO_FUTURE' ? 'NO_FUTURE' : applied.code === 'INVALID_PROPOSAL' ? 'INVALID_PROPOSAL' : applied.code;
    return { ok: false, code, reason: applied.reason, ...(applied.translation ? { translation: applied.translation } : {}) };
  }
  return { ok: true, future: applied.future, translation: applied.translation, mode: result.mode, ...(result.recordingLabel ? { recordingLabel: result.recordingLabel } : {}) };
}
