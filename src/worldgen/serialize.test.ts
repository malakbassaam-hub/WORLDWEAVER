import { beforeAll, describe, expect, it } from 'vitest';
import { generateWorldDeterministic } from './generate';
import { MAX_BLUEPRINT_BYTES, blueprintFingerprint, checkBlueprintShape, parseBlueprint, serializeBlueprint, upgradeBlueprint } from './serialize';
import { BLUEPRINT_VERSION, type WorldBlueprint } from './types';
import { validateBlueprint } from './validate';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

let bp: WorldBlueprint;
let text: string;

beforeAll(() => {
  const r = generateWorldDeterministic({ prompt: 'منارة على جرف بجانب البحر مع قرية صغيرة وشلال وجسر', seed: 5, strategies: ['composition-first'] });
  if (!r.ok || !r.candidates[0]) throw new Error('generation failed');
  bp = r.candidates[0].blueprint;
  const s = serializeBlueprint(bp);
  if (!s.ok) throw new Error(s.error);
  text = s.text;
});

/** Parses JSON into a plain mutable tree for building malformed inputs. */
const tree = (): { [k: string]: Json } => JSON.parse(text) as { [k: string]: Json };
const shuffleKeys = (v: Json): Json => {
  if (Array.isArray(v)) return v.map(shuffleKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, shuffleKeys(v[k] as Json)]));
  return v;
};

describe('serializeBlueprint / parseBlueprint', () => {
  it('round-trips exactly, including Arabic text', () => {
    const parsed = parseBlueprint(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.blueprint).toEqual(bp);
    const again = serializeBlueprint(parsed.blueprint);
    expect(again.ok && again.text).toBe(text);
    expect(parsed.blueprint.identity.title).toMatch(/[\u0600-\u06FF]/);
  });

  it('produces canonical output regardless of key order', () => {
    const shuffled = JSON.stringify(shuffleKeys(tree()));
    expect(shuffled).not.toBe(text);
    const parsed = parseBlueprint(shuffled);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(blueprintFingerprint(parsed.blueprint)).toBe(blueprintFingerprint(bp));
    const again = serializeBlueprint(parsed.blueprint);
    expect(again.ok && again.text).toBe(text);
  });

  it('parsed blueprints still pass semantic validation', () => {
    const parsed = parseBlueprint(text);
    expect(parsed.ok && validateBlueprint(parsed.blueprint).valid).toBe(true);
  });

  it('fingerprints change when content changes', () => {
    const t = tree();
    const identity = t.identity as { [k: string]: Json };
    identity.title = 'Edited';
    const parsed = parseBlueprint(JSON.stringify(t));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(blueprintFingerprint(parsed.blueprint)).not.toBe(blueprintFingerprint(bp));
    expect(blueprintFingerprint(bp)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses to serialise non-finite numbers', () => {
    const broken = structuredClone(bp) as { space: { extent: number } } & WorldBlueprint;
    broken.space.extent = Number.POSITIVE_INFINITY;
    const s = serializeBlueprint(broken);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toContain('$.space.extent');
  });
});

describe('parseBlueprint rejects untrusted input', () => {
  const reject = (input: unknown, pattern: RegExp) => {
    const r = parseBlueprint(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(pattern);
  };

  it('non-text and malformed JSON', () => {
    reject(42, /JSON text/);
    reject('{"schema":', /not valid JSON/);
    reject('[]', /JSON object/);
  });

  it('wrong schema and unsupported versions', () => {
    const t = tree();
    reject(JSON.stringify({ ...t, schema: 'other' }), /Not a WorldBlueprint/);
    reject(JSON.stringify({ ...t, version: BLUEPRINT_VERSION + 1 }), /newer than this build/);
    reject(JSON.stringify({ ...t, version: 0 }), /positive integer/);
    reject(JSON.stringify({ ...t, version: '1' }), /positive integer/);
  });

  it('missing and unknown fields', () => {
    const missing = tree();
    delete missing.terrain;
    reject(JSON.stringify(missing), /\$\.terrain is missing/);
    const extra = tree();
    extra.script = 'alert(1)';
    reject(JSON.stringify(extra), /unknown field "script"/);
    const nested = tree();
    const structures = nested.structures as { [k: string]: Json }[];
    structures[0]!.onClick = 'x';
    reject(JSON.stringify(nested), /structures\[0\] has unknown field "onClick"/);
  });

  it('wrong types, enums, infinities and colours', () => {
    const t1 = tree();
    (t1.theme as { [k: string]: Json }).biome = 'lava';
    reject(JSON.stringify(t1), /theme\.biome/);
    // JSON numbers like 1e999 parse to Infinity.
    const t2 = text.replace(/"extent":\d+(\.\d+)?/, '"extent":1e999');
    reject(t2, /space\.extent must be a finite number/);
    const t3 = tree();
    ((t3.theme as { [k: string]: Json }).palette as Json[])[0] = 'red';
    reject(JSON.stringify(t3), /#rrggbb/);
    const t4 = tree();
    ((t4.structures as { [k: string]: Json }[])[0]!.transform as { [k: string]: Json }).position = [1, 2];
    reject(JSON.stringify(t4), /position must be 3 finite numbers/);
  });

  it('oversized input', () => {
    reject(' '.repeat(MAX_BLUEPRINT_BYTES + 1), /limit is/);
  });

  it('bounds the number of errors reported', () => {
    const t = tree();
    for (const s of t.structures as { [k: string]: Json }[]) s.height = 'tall';
    for (const v of t.vegetation as { [k: string]: Json }[]) v.count = 'many';
    expect(checkBlueprintShape(t).length).toBeLessThanOrEqual(25);
  });
});

describe('upgradeBlueprint', () => {
  it('passes the current version through unchanged', () => {
    const t = tree();
    const r = upgradeBlueprint(t);
    expect(r.ok && r.value).toBe(t);
  });
});
