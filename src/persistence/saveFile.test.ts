import { describe, expect, it } from 'vitest';
import { canonical, worldFingerprint } from '../core/fingerprint';
import { createEmptyWorld } from '../core/reducer';
import { WorldStore } from '../core/store';
import { asEntityId, type World } from '../core/types';
import { buildWorldContext } from '../director/context';
import { applyMorph, translateMorph } from '../director/morph';
import { validateProposal } from '../director/validate';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { parseSaveFile, SAVE_FORMAT, SAVE_LIMITS, SAVE_VERSION, sameWorld, serializeWorld, utf8Bytes, worldChecksum } from './saveFile';

const SAVED_AT = '2026-11-20T12:00:00.000Z';

function text(world: World, savedAt: string | null = SAVED_AT): string {
  const r = serializeWorld(world, { savedAt });
  if (!r.ok) throw new Error(r.message);
  return r.text;
}

/** Edits the world JSON inside a save and recomputes the checksum, so only the validator can object. */
function tamper(world: World, edit: (w: Record<string, any>) => void): string {
  const env = JSON.parse(text(world));
  edit(env.world);
  env.checksum = worldChecksum(env.world as World);
  return JSON.stringify(env);
}

function edited(): World {
  const initial = buildCrystalKingdom();
  const store = new WorldStore(initial);
  const ref = (r: string) => buildWorldContext(initial).refs.get(r)!;
  store.dispatch({ type: 'entity/renamed', id: ref('e4'), name: 'Watchtower — دار', source: 'user' });
  store.dispatch({ type: 'entity/transformed', id: ref('e10'), transform: { position: [-24, 9, 14], rotation: [0.1, 0.2, 0.3] }, source: 'user' });
  store.dispatch({ type: 'entity/visualChanged', id: ref('e5'), patch: { visible: false, color: '#ff8a3d' }, source: 'user' });
  store.dispatch({ type: 'entity/pinnedChanged', id: ref('e6'), pinned: true, source: 'user' });
  const v = validateProposal({ summary: 'Violet.', operations: [{ op: 'recolor', target: 'e8', palette: 'Night Violet' }, { op: 'add', archetype: 'lightOrb', name: 'Citadel Lantern', placement: 'on-target', target: 'e2' }] });
  if (!v.ok) throw new Error('setup');
  const out = applyMorph(store, translateMorph(store.getState(), v.proposal), { mode: 'recorded' });
  if (!out.ok) throw new Error(out.reason);
  return store.getState();
}

describe('round trips', () => {
  it('restores the Crystal Kingdom exactly: IDs, order, hierarchy, transforms, appearance, pins, provenance and seq', () => {
    const w = buildCrystalKingdom();
    const r = parseSaveFile(text(w));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(canonical(r.world)).toBe(canonical(w));
    expect(sameWorld(r.world, w)).toBe(true);
    expect(r).toMatchObject({ version: SAVE_VERSION, savedAt: SAVED_AT, migratedFrom: null });
  });

  it('restores an edited world: nested child under a pinned entity, user pins, hidden and recoloured entities, Arabic text, rotation', () => {
    const w = edited();
    const r = parseSaveFile(text(w));
    if (!r.ok) throw new Error(r.message);
    expect(canonical(r.world)).toBe(canonical(w));
    const lantern = Object.values(r.world.entities).find((e) => e.name === 'Citadel Lantern')!;
    const citadel = r.world.entities[lantern.parentId!]!;
    expect(citadel.pinned).toBe(true);
    expect(r.world.entities[citadel.parentId!]!.name).toBe('Isle of Aurelion');
    expect(Object.values(r.world.entities).filter((e) => e.pinned)).toHaveLength(2);
  });

  it('restores an empty world', () => {
    const w = createEmptyWorld({ id: 'void', name: 'Void', biome: 'nothing', seed: 7 });
    const r = parseSaveFile(text(w, null));
    expect(r.ok && canonical(r.world) === canonical(w) && r.savedAt === null).toBe(true);
  });

  it('returns fresh objects that keep the reducer rules (pinned entities still cannot be removed)', async () => {
    const w = buildCrystalKingdom();
    const r = parseSaveFile(text(w));
    if (!r.ok) throw new Error(r.message);
    expect(r.world).not.toBe(w);
    for (const id of w.order) expect(r.world.entities[id]).not.toBe(w.entities[id]);
    const store = new WorldStore(r.world);
    const citadel = r.world.order.find((id) => r.world.entities[id]!.pinned)!;
    expect(store.dispatch({ type: 'entity/removed', id: citadel, source: 'user' })).toMatchObject({ ok: false, reason: expect.stringMatching(/pinned/) });
  });
});

describe('deterministic serialisation', () => {
  it('same world and timestamp give byte-identical text; parse then serialise is idempotent', () => {
    const w = edited();
    expect(text(w)).toBe(text(w));
    const r = parseSaveFile(text(w));
    if (!r.ok) throw new Error(r.message);
    expect(text(r.world)).toBe(text(w));
  });

  it('object key order does not change the file', () => {
    const w = buildCrystalKingdom();
    const shuffled = JSON.parse(JSON.stringify(w), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)) as World;
    expect(text(shuffled)).toBe(text(w));
  });

  it('the timestamp is not part of the checksum', () => {
    const w = buildCrystalKingdom();
    expect(JSON.parse(text(w, 'a')).checksum).toBe(JSON.parse(text(w, 'b')).checksum);
  });

  it('starts with the format header and is valid JSON', () => {
    const t = text(buildCrystalKingdom());
    expect(t.startsWith(`{"format":"${SAVE_FORMAT}","version":1,`)).toBe(true);
    expect(() => JSON.parse(t)).not.toThrow();
  });
});

describe('rejections (nothing is returned that could be applied)', () => {
  const w = () => buildCrystalKingdom();
  const reject = (t: unknown, code: string) => {
    const r = parseSaveFile(t);
    expect(r.ok, String(t).slice(0, 80)).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
    return r;
  };

  it('non-text, non-JSON, truncated, and non-WORLDWEAVER files', () => {
    reject(42, 'NOT_A_SAVE');
    reject('', 'NOT_JSON');
    reject('{"format":', 'NOT_JSON');
    reject(text(w()).slice(0, 500), 'NOT_JSON');
    reject('[]', 'NOT_A_SAVE');
    reject('{"format":"other","version":1}', 'NOT_A_SAVE');
    reject(JSON.stringify({ format: SAVE_FORMAT, version: 0 }), 'NOT_A_SAVE');
    reject(JSON.stringify({ format: SAVE_FORMAT, version: 1.5 }), 'NOT_A_SAVE');
  });

  it('newer versions are refused with a clear message', () => {
    const r = reject(JSON.stringify({ ...JSON.parse(text(w())), version: 2 }), 'UNSUPPORTED_VERSION');
    if (!r.ok) expect(r.message).toMatch(/newer WORLDWEAVER \(format version 2\)/);
  });

  it('a changed byte breaks the checksum', () => {
    reject(text(w()).replace('Aurelion Citadel', 'Aurelion Citadex'), 'CHECKSUM');
    const env = JSON.parse(text(w()));
    env.checksum = '0'.repeat(16);
    reject(JSON.stringify(env), 'CHECKSUM');
  });

  it('oversized files are refused before parsing; too many entities are refused', () => {
    reject(`{"format":"${SAVE_FORMAT}","pad":"${'x'.repeat(SAVE_LIMITS.maxBytes)}"}`, 'TOO_LARGE');
    // Multi-byte characters count as UTF-8 bytes.
    expect(utf8Bytes('دار')).toBe(6);
    expect(utf8Bytes('😀')).toBe(4);
    const big = createEmptyWorld({ id: 'b', name: 'Big', biome: 'b', seed: 1 });
    const entities: Record<string, unknown> = {};
    const order: string[] = [];
    for (let i = 0; i <= SAVE_LIMITS.maxEntities; i++) {
      order.push(`e${i}`);
      entities[`e${i}`] = { id: `e${i}`, name: 'n', kind: 'k', parentId: null, tags: [], pinned: false, components: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, provenance: { createdBy: 'system', createdAtSeq: 0, lastModifiedBy: 'system', lastModifiedSeq: 0 } };
    }
    const env = { format: SAVE_FORMAT, version: 1, savedAt: null, checksum: '0'.repeat(16), world: { ...big, entities, order } };
    const r = reject(JSON.stringify(env), 'INVALID');
    if (!r.ok) expect(r.message).toMatch(/at most 1000 entities/);
  });

  it('duplicate IDs, missing entities, bad parents and orphans', () => {
    const ids = w().order;
    const cases: Array<[(x: Record<string, any>) => void, RegExp]> = [
      [(x) => x.order.push(ids[3]), /Duplicate entity ID/],
      [(x) => x.order.pop(), /missing from the order list/],
      [(x) => x.order.push('ghost'), /No entity with ID "ghost"/],
      [(x) => (x.entities[ids[5]!].parentId = 'ghost'), /Parent entity not found/],
      [(x) => (x.entities[ids[5]!].parentId = ids[5]), /own parent/],
      [(x) => (x.entities[ids[0]!].parentId = ids[1]), /parent must come before/],
      [(x) => (x.entities[ids[2]!].id = 'other'), /equal the entity key/],
      [(x) => {
        const e = x.entities[ids[2]!];
        delete x.entities[ids[2]!];
        x.entities['bad id!'] = { ...e, id: 'bad id!' };
        x.order[2] = 'bad id!';
      }, /IDs may contain/],
    ];
    for (const [edit, msg] of cases) {
      const r = reject(tamper(w(), edit), 'INVALID');
      if (!r.ok) expect(r.message, String(msg)).toMatch(msg);
    }
  });

  it('wrong field types, unknown fields and out-of-range values', () => {
    const id = w().order[4]!;
    const cases: Array<(x: Record<string, any>) => void> = [
      (x) => (x.extra = 1),
      (x) => (x.entities[id].script = 'alert(1)'),
      (x) => (x.entities[id].components.visual.onload = 'x'),
      (x) => (x.entities[id].name = ''),
      (x) => (x.entities[id].name = ' padded'),
      (x) => (x.entities[id].name = 'x'.repeat(81)),
      (x) => (x.entities[id].name = 'bidi\u202eattack'),
      (x) => (x.entities[id].pinned = 'yes'),
      (x) => (x.entities[id].tags = ['ok', 3]),
      (x) => (x.entities[id].components.transform.scale = [1, 0, 1]),
      (x) => (x.entities[id].components.transform.position = [1, 2]),
      (x) => (x.entities[id].components.visual.color = 'red'),
      (x) => (x.entities[id].components.visual.emissiveIntensity = 999),
      (x) => (x.entities[id].components.visual.archetype = 'dragonLair'),
      (x) => (x.entities[id].provenance.lastModifiedSeq = x.seq + 1),
      (x) => (x.entities[id].provenance.createdBy = 'hacker'),
      (x) => (x.seed = -1),
      (x) => (x.seq = 1.5),
      (x) => (x.schemaVersion = 2),
    ];
    for (const edit of cases) reject(tamper(w(), edit), 'INVALID');
  });

  it('prototype keys, deep nesting and API-key-like text are refused as unsafe; nothing is polluted', () => {
    reject(`{"format":"${SAVE_FORMAT}","version":1,"__proto__":{"polluted":true}}`, 'UNSAFE');
    reject(tamper(w(), (x) => (x.entities[x.order[1]].constructor = { prototype: {} })), 'UNSAFE');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    let deep = '1';
    for (let i = 0; i < 40; i++) deep = `[${deep}]`;
    reject(`{"format":"${SAVE_FORMAT}","version":1,"x":${deep}}`, 'UNSAFE');
    const key = `AIza${'A'.repeat(35)}`;
    reject(tamper(w(), (x) => (x.entities[x.order[1]].name = key.slice(0, 40))), 'UNSAFE');
  });

  it('serialising refuses invalid worlds and API-key-like text', () => {
    const bad = { ...buildCrystalKingdom(), order: [] } as World;
    expect(serializeWorld(bad)).toMatchObject({ ok: false, code: 'INVALID_WORLD' });
    const w0 = buildCrystalKingdom();
    const id = w0.order[2]!;
    const leaky: World = { ...w0, entities: { ...w0.entities, [id]: { ...w0.entities[id]!, name: `AIza${'B'.repeat(35)}` } } };
    expect(serializeWorld(leaky)).toMatchObject({ ok: false, code: 'UNSAFE' });
  });

  it('a whitespace-only kind is refused (structural check; the reducer rebuild would also reject it)', () => {
    const r = parseSaveFile(tamper(w(), (x) => (x.entities[x.order[2]].kind = '   ')));
    expect(r.ok).toBe(false);
  });

  it('IDs survive unchanged, including namespaced Director IDs', () => {
    const r = parseSaveFile(text(edited()));
    if (!r.ok) throw new Error(r.message);
    expect(r.world.order.some((id) => id.startsWith('ai-'))).toBe(true);
    expect(r.world.order).toEqual(edited().order);
    expect(worldFingerprint(r.world)).toBe(worldFingerprint(edited()));
    void asEntityId;
  });
});
