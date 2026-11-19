/**
 * World Morph domain logic (docs/WORLD_MORPH_PLAN.md).
 *
 * A Morph restyles many unpinned entities with ONE World Proposal (schema v2,
 * no new operation types). Pinned entities are preserved by three layers:
 *   1. model guidance (prompt; untrusted),
 *   2. translator rules: the built-in pinned check plus `morphGuard` (pinned
 *      ancestors, children of pinned entities),
 *   3. `checkPinnedInvariant`: before apply, every pinned entity's data, world
 *      pose and effective visibility must be unchanged in the preview.
 *
 * STATUS: implemented and unit-tested, NOT enabled. The policy defaults below
 * are approved (WW-031, 2026-11-19); live Gemini behaviour for morph prompts
 * is unverified (WW-025). Nothing here performs network requests.
 */
import { checkPinnedInvariant, pinClosure, quotedName, type PinnedViolation } from '../core/pins';
import { hashString } from '../core/random';
import type { WorldStore } from '../core/store';
import type { EntityId, World, WorldEvent } from '../core/types';
import { applyTranslation, type ApplyContext, type ApplyOutcome } from './apply';
import type { WorldProposal } from './schema';
import { translateProposal, type GuardRejection, type OperationGuard, type Translation } from './translate';

// ---------------------------------------------------------------- policy

export interface MorphPolicy {
  /**
   * D-WM-1. 'reject-proposal': any pin-rule rejection blocks the whole morph.
   * 'drop-operation': pin-rule rejections are dropped and listed; the rest may
   * apply. Non-pin rejections (unknown refs, invalid values) always block.
   */
  readonly onPinViolation: 'reject-proposal' | 'drop-operation';
  /** D-WM-2. Also protect ancestors of pinned entities from move, hide/show and remove. */
  readonly protectAncestors: boolean;
  /** D-WM-3. Allow adding new children directly under a pinned entity. */
  readonly allowAddToPinned: boolean;
}

/**
 * Defaults approved by Malak on 2026-11-19 (WW-031):
 * - Policy A, D-WM-1: a morph that would modify an existing pinned entity is
 *   rejected as a whole ('reject-proposal').
 * - Policy B, D-WM-2: ancestors of pinned entities are protected from changes
 *   that would affect the pinned descendant (move, hide/show, remove).
 * - Policy C, D-WM-3: new children may be added under pinned entities, as long
 *   as the pinned entity's data, world pose and visibility stay unchanged
 *   (enforced by `checkPinnedInvariant`).
 */
export const APPROVED_MORPH_POLICY: MorphPolicy = Object.freeze({
  onPinViolation: 'reject-proposal',
  protectAncestors: true,
  allowAddToPinned: true,
});

export const MORPH_POLICY_STATUS = Object.freeze({
  approved: true,
  issue: 'WW-031',
  approvedBy: 'Malak',
  approvedOn: '2026-11-19',
  note: 'Policies A, B and C (D-WM-1 to D-WM-3) are approved. D-WM-4 (transition duration) is still a proposal. Approval does not enable World Morph: it stays off until the live test (WW-025) and studio integration (WW-030) gates pass.',
});

export function describePolicy(policy: MorphPolicy): string {
  return `${policy.onPinViolation};ancestors=${policy.protectAncestors ? 'protected' : 'free'};addToPinned=${policy.allowAddToPinned ? 'allowed' : 'blocked'}`;
}

// ---------------------------------------------------------------- pin closure

// Moved to src/core/pins.ts so Parallel Futures can share them; re-exported unchanged.
export { checkPinnedInvariant, pinClosure, type PinClosure, type PinnedViolation } from '../core/pins';

/** Order-independent fingerprint of the pinned set (FNV-1a over sorted IDs). */
export function pinnedHash(pinned: readonly EntityId[]): string {
  return hashString([...pinned].sort().join('\n')).toString(36);
}

// ---------------------------------------------------------------- guard

const name = quotedName;

function eventTarget(event: WorldEvent): EntityId {
  return event.type === 'entity/added' ? event.entity.id : event.id;
}

/** Translator guard enforcing the morph pin rules against the preview world. */
export function morphGuard(policy: MorphPolicy): OperationGuard {
  return ({ events, preview }) => {
    const closure = pinClosure(preview);
    for (const event of events) {
      if (event.type === 'entity/added') {
        const parent = event.entity.parentId;
        if (!policy.allowAddToPinned && parent && preview.entities[parent]?.pinned) {
          return reject(`Adding “${event.entity.name}” under pinned ${name(preview, parent)} is not allowed by the morph policy.`, 'pinned-parent');
        }
        continue;
      }
      if (!policy.protectAncestors) continue;
      const id = eventTarget(event);
      const child = closure.protects.get(id);
      if (!child) continue;
      if (event.type === 'entity/transformed') {
        return reject(`Moving ${name(preview, id)} would move pinned ${name(preview, child)}.`, 'pinned-ancestor');
      }
      if (event.type === 'entity/removed') {
        return reject(`Removing ${name(preview, id)} would remove the parent of pinned ${name(preview, child)}.`, 'pinned-ancestor');
      }
      if (event.type === 'entity/visualChanged' && event.patch.visible !== undefined) {
        const verb = event.patch.visible ? 'Showing' : 'Hiding';
        return reject(`${verb} ${name(preview, id)} would change the visibility of pinned ${name(preview, child)}.`, 'pinned-ancestor');
      }
    }
    return null;
  };
}

function reject(reason: string, rule: GuardRejection['rule']): GuardRejection {
  return rule ? { reason, rule } : { reason };
}

// ---------------------------------------------------------------- translate + apply

export interface MorphTranslation extends Translation {
  readonly kind: 'morph';
  readonly policy: MorphPolicy;
  readonly policyApproved: boolean;
  readonly pinned: readonly EntityId[];
  readonly protectedAncestors: readonly EntityId[];
  readonly pinnedHash: string;
  /** Operations rejected by pin rules (always listed, even when dropped). */
  readonly pinRejections: number;
  /** Invariant violations found in the preview (must be empty to apply). */
  readonly violations: readonly PinnedViolation[];
  /** Why the morph cannot be applied, if `applicable` is false. */
  readonly blockedReason?: string;
}

export function translateMorph(world: World, proposal: WorldProposal, policy: MorphPolicy = APPROVED_MORPH_POLICY): MorphTranslation {
  const t = translateProposal(world, proposal, { guard: morphGuard(policy) });
  const closure = pinClosure(world);
  const violations = checkPinnedInvariant(world, t.preview, closure.pinned);
  const rejected = t.outcomes.filter((o) => o.status === 'rejected');
  const pinRejections = rejected.filter((o) => o.rule !== undefined).length;
  const otherRejections = rejected.length - pinRejections;

  let blockedReason: string | undefined;
  if (t.events.length === 0) blockedReason = 'The morph contains no applicable changes.';
  else if (violations.length > 0) blockedReason = violations.map((v) => v.message).join(' ');
  else if (otherRejections > 0) blockedReason = `${otherRejections} operation${otherRejections === 1 ? ' was' : 's were'} rejected; a morph is applied completely or not at all.`;
  else if (pinRejections > 0 && policy.onPinViolation === 'reject-proposal') {
    blockedReason = `${pinRejections} operation${pinRejections === 1 ? '' : 's'} would change pinned entities; the morph policy rejects the whole morph.`;
  }

  return {
    ...t,
    applicable: blockedReason === undefined,
    kind: 'morph',
    policy,
    policyApproved: MORPH_POLICY_STATUS.approved,
    pinned: closure.pinned,
    protectedAncestors: closure.protectedAncestors,
    pinnedHash: pinnedHash(closure.pinned),
    pinRejections,
    violations,
    ...(blockedReason !== undefined ? { blockedReason } : {}),
  };
}

/**
 * Applies a morph as ONE atomic batch (one undo step). Re-checks the pinned
 * invariant against the store's current state and the translation's preview.
 */
export function applyMorph(store: WorldStore, morph: MorphTranslation, ctx: Omit<ApplyContext, 'kind' | 'extraDetails'>): ApplyOutcome {
  if (!morph.applicable) {
    return { ok: false, code: 'NOT_APPLICABLE', reason: morph.blockedReason ?? 'The morph cannot be applied.' };
  }
  const current = store.getState();
  if (current.seq === morph.baseSeq) {
    const recheck = checkPinnedInvariant(current, morph.preview, morph.pinned);
    if (recheck.length > 0) return { ok: false, code: 'NOT_APPLICABLE', reason: recheck.map((v) => v.message).join(' ') };
  }
  return applyTranslation(store, morph, {
    ...ctx,
    kind: 'morph',
    extraDetails: {
      pinnedCount: String(morph.pinned.length),
      pinnedHash: morph.pinnedHash,
      policy: describePolicy(morph.policy),
      policyApproved: String(morph.policyApproved),
      pinRejections: String(morph.pinRejections),
    },
  });
}
