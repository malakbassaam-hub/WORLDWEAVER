/**
 * Human-readable descriptions of proposal operations for the review screen.
 * Plain text only; the UI renders it with textContent.
 */
import type { World } from '../core/types';
import { buildWorldContext } from './context';
import type { ProposalArchetype, ProposalOperation } from './schema';
import type { Translation } from './translate';

const ARCHETYPE_NAMES: Readonly<Record<ProposalArchetype, string>> = {
  floatingIsland: 'floating isle',
  crystalSpire: 'crystal spire',
  crystalCluster: 'crystal cluster',
  crystalCitadel: 'crystal citadel',
  arcaneRing: 'arcane ring',
  lightOrb: 'light orb',
  obelisk: 'obelisk',
};

const PLACEMENT_NAMES: Readonly<Record<string, string>> = {
  center: 'at the centre',
  'inner-ring': 'in the inner ring',
  'outer-ring': 'in the outer ring',
  sky: 'in the sky',
  'on-target': 'on',
  'near-target': 'near',
};

export interface ChangeSummary {
  readonly operations: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
}

export function summarizeTranslation(t: Translation): ChangeSummary {
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const e of t.events) {
    if (e.type === 'entity/added') added += 1;
    else if (e.type === 'entity/removed') removed += 1;
    else changed += 1;
  }
  return { operations: t.outcomes.length, accepted: t.accepted, rejected: t.rejected, added, changed, removed };
}

/** Describes operations against the world the proposal was made for. */
export function describeOperations(world: World, operations: readonly ProposalOperation[]): string[] {
  const ctx = buildWorldContext(world);
  const nameOf = (ref: string | undefined) => {
    if (!ref) return 'an entity';
    const e = ctx.entities.find((x) => x.ref === ref);
    return e ? `“${e.name}”` : `unknown entity ${ref}`;
  };
  return operations.map((op) => {
    switch (op.op) {
      case 'add': {
        const n = op.count ?? 1;
        const what = `${n} × ${ARCHETYPE_NAMES[op.archetype]}${n > 1 ? 's' : ''} “${op.name}”`;
        const where = op.placement === 'on-target' || op.placement === 'near-target' ? `${PLACEMENT_NAMES[op.placement]} ${nameOf(op.target)}` : PLACEMENT_NAMES[op.placement];
        const look = [op.palette, op.glow !== undefined ? `glow ${op.glow}` : null].filter(Boolean).join(', ');
        return `Add ${what} ${where}${look ? ` (${look})` : ''}`;
      }
      case 'remove':
        return `Remove ${nameOf(op.target)}`;
      case 'rename':
        return `Rename ${nameOf(op.target)} to “${op.name}”`;
      case 'recolor':
        return `Recolour ${nameOf(op.target)} to ${op.palette}`;
      case 'glow':
        return `Set the glow of ${nameOf(op.target)} to ${op.glow}`;
      case 'move':
        return `Move ${nameOf(op.target)} ${op.direction}${op.steps && op.steps > 1 ? ` × ${op.steps}` : ''}`;
      case 'show':
        return `Show ${nameOf(op.target)}`;
      case 'hide':
        return `Hide ${nameOf(op.target)}`;
    }
  });
}
