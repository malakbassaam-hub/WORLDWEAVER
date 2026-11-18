/**
 * Strict validation of browser → proxy requests. The browser is same-origin,
 * but the proxy still validates everything: it spends the user's quota.
 */
import { PROPOSAL_LIMITS, REF_PATTERN } from '../../src/director/schema';

export const REQUEST_LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxPromptChars: 2_000,
  maxEntities: PROPOSAL_LIMITS.maxWorldEntities,
  maxNameChars: PROPOSAL_LIMITS.maxNameLength,
  maxShortText: 120,
} as const;

export type RequestMode = 'create' | 'edit';

export interface ContextEntityInput {
  readonly ref: string;
  readonly name: string;
  readonly kind: string;
  readonly archetype: string | null;
  readonly palette: string;
  readonly visible: boolean;
  readonly pinned: boolean;
  readonly parentRef: string | null;
}

export interface DirectorRequest {
  readonly mode: RequestMode;
  readonly prompt: string;
  readonly world: {
    readonly worldName: string;
    readonly biome: string;
    readonly entityCount: number;
    readonly entities: readonly ContextEntityInput[];
  };
}

export type RequestValidation = { readonly ok: true; readonly request: DirectorRequest } | { readonly ok: false; readonly message: string };

// Prompts may contain newlines and tabs; nothing else from C0/C1, no bidi controls.
const UNSAFE_PROMPT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u2028\u2029\ufeff]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const ROOT_KEYS = ['mode', 'prompt', 'world'];
const WORLD_KEYS = ['worldName', 'biome', 'entityCount', 'entities'];
const ENTITY_KEYS = ['ref', 'name', 'kind', 'archetype', 'palette', 'visible', 'pinned', 'parentRef'];

class Invalid extends Error {}

function plain(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Invalid(`${what} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(obj: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const key of Object.keys(obj)) if (!keys.includes(key)) throw new Invalid(`${what} has an unknown property.`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(obj, key)) throw new Invalid(`${what} is missing "${key}".`);
}

function text(value: unknown, what: string, max: number, pattern = UNSAFE_TEXT, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Invalid(`${what} must be text.`);
  if (LONE_SURROGATE.test(value) || pattern.test(value)) throw new Invalid(`${what} contains characters that are not allowed.`);
  const clean = value.normalize('NFC').trim();
  if (!allowEmpty && clean.length === 0) throw new Invalid(`${what} must not be empty.`);
  if (clean.length > max) throw new Invalid(`${what} is too long (maximum ${max} characters).`);
  return clean;
}

function ref(value: unknown, what: string, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !REF_PATTERN.test(value)) throw new Invalid(`${what} must be an entity ref like "e7".`);
  return value;
}

export function validateDirectorRequest(input: unknown): RequestValidation {
  try {
    const root = plain(input, 'Request');
    exactKeys(root, ROOT_KEYS, 'Request');
    if (root.mode !== 'create' && root.mode !== 'edit') throw new Invalid('mode must be "create" or "edit".');
    const prompt = text(root.prompt, 'prompt', REQUEST_LIMITS.maxPromptChars, UNSAFE_PROMPT);

    const world = plain(root.world, 'world');
    exactKeys(world, WORLD_KEYS, 'world');
    const worldName = text(world.worldName, 'world.worldName', REQUEST_LIMITS.maxShortText);
    const biome = text(world.biome, 'world.biome', REQUEST_LIMITS.maxShortText, UNSAFE_TEXT, true);
    if (!Array.isArray(world.entities)) throw new Invalid('world.entities must be an array.');
    if (world.entities.length > REQUEST_LIMITS.maxEntities) throw new Invalid(`world.entities has more than ${REQUEST_LIMITS.maxEntities} items.`);
    if (typeof world.entityCount !== 'number' || world.entityCount !== world.entities.length) {
      throw new Invalid('world.entityCount must equal the number of entities.');
    }
    const seen = new Set<string>();
    const entities = world.entities.map((raw, i): ContextEntityInput => {
      const what = `world.entities[${i}]`;
      const e = plain(raw, what);
      exactKeys(e, ENTITY_KEYS, what);
      const r = ref(e.ref, `${what}.ref`, false) as string;
      if (seen.has(r)) throw new Invalid(`${what}.ref is duplicated.`);
      seen.add(r);
      if (typeof e.visible !== 'boolean' || typeof e.pinned !== 'boolean') throw new Invalid(`${what} visible/pinned must be booleans.`);
      return {
        ref: r,
        name: text(e.name, `${what}.name`, REQUEST_LIMITS.maxNameChars),
        kind: text(e.kind, `${what}.kind`, 40),
        archetype: e.archetype === null ? null : text(e.archetype, `${what}.archetype`, 40),
        palette: text(e.palette, `${what}.palette`, 40),
        visible: e.visible,
        pinned: e.pinned,
        parentRef: ref(e.parentRef, `${what}.parentRef`, true),
      };
    });
    return { ok: true, request: { mode: root.mode, prompt, world: { worldName, biome, entityCount: entities.length, entities } } };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, message: error.message };
    throw error;
  }
}
