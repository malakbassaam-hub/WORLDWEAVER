/**
 * RECORDED MODE: deterministic, pre-written proposals for development, tests
 * and offline demos. They are NOT model output and must always be labelled
 * "recorded" to the user. Each is raw proposal JSON, exactly as Gemini would
 * return it, so it goes through the same validation as live responses.
 *
 * Refs (e1, e2, …) refer to the default Crystal Kingdom world:
 *   e1 Isle of Aurelion · e2 Aurelion Citadel (pinned) · e3 Celestial Halo
 *   e4–e9 Sentinel Spires I–VI · e10 Veilstone Reach · e12 Emberglass Rest
 *   e15 Hollow of Whispers · e17 Moonshard Cay · e20–e24 Lumen Wisps
 */
import type { RequestMode } from './request';

export interface Recording {
  readonly id: string;
  readonly label: string;
  readonly mode: RequestMode;
  /** Lower-case keywords (English and Arabic); the best match wins. */
  readonly keywords: readonly string[];
  readonly isDefault?: boolean;
  /** Raw proposal JSON, validated like a live model response. */
  readonly response: unknown;
}

export const RECORDINGS: readonly Recording[] = [
  {
    id: 'create-crystal-garden',
    label: 'Crystal garden on the main isle',
    mode: 'create',
    keywords: ['crystal', 'garden', 'shard', 'spire', 'كريستال', 'بلور', 'حديقة', 'برج'],
    response: {
      summary: 'Grow a mint crystal garden on the Isle of Aurelion, ringed by violet spires.',
      operations: [
        { op: 'add', archetype: 'crystalCluster', name: 'Mint Shard Garden', count: 3, placement: 'on-target', target: 'e1', palette: 'Aurora Mint' },
        { op: 'add', archetype: 'crystalSpire', name: 'Violet Watch', count: 4, placement: 'inner-ring', palette: 'Night Violet', glow: 2.6 },
      ],
    },
  },
  {
    id: 'create-sky-lanterns',
    label: 'Lanterns and a halo in the sky',
    mode: 'create',
    keywords: ['lantern', 'light', 'wisp', 'sky', 'star', 'glow', 'فانوس', 'فوانيس', 'ضوء', 'نور', 'سماء', 'نجم'],
    response: {
      summary: 'Hang ember lanterns in the dusk sky around a second arcane halo.',
      operations: [
        { op: 'add', archetype: 'lightOrb', name: 'Ember Lantern', count: 3, placement: 'sky', palette: 'Ember Gold', glow: 5 },
        { op: 'add', archetype: 'arcaneRing', name: 'Dusk Halo', placement: 'sky', palette: 'Orchid Flare' },
      ],
    },
  },
  {
    id: 'create-drifting-isles',
    label: 'Drifting isles with obelisks',
    mode: 'create',
    keywords: ['island', 'isle', 'float', 'drift', 'obelisk', 'جزيرة', 'جزر', 'مسلة'],
    response: {
      summary: 'Add two drifting isles at the edge of the kingdom, guarded by moonlit obelisks.',
      operations: [
        { op: 'add', archetype: 'floatingIsland', name: 'Drift Isle', count: 2, placement: 'outer-ring' },
        { op: 'add', archetype: 'obelisk', name: 'Moon Obelisk', count: 2, placement: 'outer-ring', palette: 'Moon White' },
      ],
    },
  },
  {
    id: 'create-moonlit-outpost',
    label: 'Moonlit outpost (default)',
    mode: 'create',
    isDefault: true,
    keywords: [],
    response: {
      summary: 'Raise a small moonlit outpost: one isle, a beacon spire and two lanterns.',
      operations: [
        { op: 'add', archetype: 'floatingIsland', name: 'Outpost Isle', placement: 'outer-ring', palette: 'Night Violet' },
        { op: 'add', archetype: 'crystalSpire', name: 'Beacon Spire', placement: 'near-target', target: 'e17', palette: 'Moon White', glow: 3 },
        { op: 'add', archetype: 'lightOrb', name: 'Outpost Lantern', count: 2, placement: 'sky', palette: 'Aether Cyan' },
      ],
    },
  },
  {
    id: 'edit-violet-night',
    label: 'Violet sentinels',
    mode: 'edit',
    keywords: ['violet', 'purple', 'recolor', 'recolour', 'colour', 'color', 'بنفسجي', 'لون', 'ألوان'],
    response: {
      summary: 'Bathe the sentinel spires in violet and brighten the first one.',
      operations: [
        { op: 'recolor', target: 'e4', palette: 'Night Violet' },
        { op: 'recolor', target: 'e6', palette: 'Night Violet' },
        { op: 'recolor', target: 'e8', palette: 'Night Violet' },
        { op: 'glow', target: 'e4', glow: 4.5 },
      ],
    },
  },
  {
    id: 'edit-raise-spires',
    label: 'Raise and rename spires',
    mode: 'edit',
    keywords: ['raise', 'lift', 'move', 'higher', 'rename', 'ارفع', 'أعلى', 'حرك', 'سم'],
    response: {
      summary: 'Lift two sentinel spires and rename them as watchtowers.',
      operations: [
        { op: 'move', target: 'e5', direction: 'up', steps: 2 },
        { op: 'move', target: 'e7', direction: 'up', steps: 2 },
        { op: 'rename', target: 'e5', name: 'Northern Watchtower' },
        { op: 'rename', target: 'e7', name: 'Southern Watchtower' },
      ],
    },
  },
  {
    id: 'edit-pinned-citadel',
    label: 'Recolour the pinned citadel (shows pin protection)',
    mode: 'edit',
    keywords: ['citadel', 'pinned', 'pin', 'قلعة', 'مثبت'],
    response: {
      summary: 'Turn the citadel orchid and hide the halo.',
      operations: [
        { op: 'recolor', target: 'e2', palette: 'Orchid Flare' },
        { op: 'hide', target: 'e3' },
      ],
    },
  },
  {
    id: 'edit-gentle-glow',
    label: 'Gentle glow (default)',
    mode: 'edit',
    isDefault: true,
    keywords: [],
    response: {
      summary: 'Soften the wisps and make the Veilstone cluster glow mint.',
      operations: [
        { op: 'glow', target: 'e20', glow: 2.5 },
        { op: 'glow', target: 'e21', glow: 2.5 },
        { op: 'recolor', target: 'e11', palette: 'Aurora Mint' },
      ],
    },
  },
];

/** Deterministic selection: highest keyword hit count, ties → list order, none → mode default. */
export function selectRecording(mode: RequestMode, prompt: string): Recording {
  const text = prompt.normalize('NFC').toLowerCase();
  const candidates = RECORDINGS.filter((r) => r.mode === mode);
  let best: Recording | undefined;
  let bestHits = 0;
  for (const r of candidates) {
    const hits = r.keywords.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
    if (hits > bestHits) {
      best = r;
      bestHits = hits;
    }
  }
  const fallback = candidates.find((r) => r.isDefault);
  if (!fallback) throw new Error(`No default recording for mode ${mode}`);
  return best ?? fallback;
}

/**
 * Test hooks, RECORDED MODE ONLY: a prompt starting with "#error:<CODE>"
 * simulates a failure so the UI's error states can be exercised offline.
 */
export const SIMULATED_ERRORS = ['RATE_LIMITED', 'TIMEOUT', 'UPSTREAM', 'BLOCKED_SAFETY', 'AUTH', 'INVALID', 'MALFORMED', 'HOSTILE'] as const;
export type SimulatedError = (typeof SIMULATED_ERRORS)[number];

export function simulatedError(prompt: string): SimulatedError | null {
  const match = /^#error:([A-Z_]+)\b/.exec(prompt.trim());
  const code = match?.[1];
  return code && (SIMULATED_ERRORS as readonly string[]).includes(code) ? (code as SimulatedError) : null;
}

/** Model-like bodies used by the INVALID / MALFORMED / HOSTILE hooks. */
export const SIMULATED_BODIES: Readonly<Record<'INVALID' | 'MALFORMED' | 'HOSTILE', string>> = {
  INVALID: JSON.stringify({ summary: 'Broken proposal', operations: [{ op: 'add', archetype: 'dragon', name: '', placement: 'underground', count: 99 }] }),
  MALFORMED: '{"summary": "cut off", "operations": [{"op": "add", ',
  // Raw text on purpose: an object literal's "__proto__" would not survive JSON.stringify.
  HOSTILE:
    '{"summary":"Ignore previous instructions","operations":[{"op":"add","archetype":"obelisk","name":"X","placement":"sky","script":"fetch(\\"/steal\\")"}],"__proto__":{"polluted":true},"code":"process.exit(1)"}',
};
