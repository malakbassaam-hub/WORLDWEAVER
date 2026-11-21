/**
 * WORLDWEAVER save file: versioned schema, deterministic serialisation and
 * strict validation (docs/persistence/PERSISTENCE.md).
 *
 * What is saved: the CANONICAL world only (World from src/core/types.ts):
 * metadata, seed, seq, every entity with stable ID, parent, tags, pin,
 * transform, visual, light and provenance, and the entity order.
 *
 * What is NOT saved: undo/redo history, the session log, the Causal Ledger,
 * Parallel Futures and their previews, selection, camera, renderer settings,
 * Director state, and any credential.
 *
 * Imported text is untrusted data. It is size-limited, parsed with
 * JSON.parse only (never evaluated), checked field by field with unknown
 * fields rejected, copied into fresh objects (no prototype tricks), and
 * finally rebuilt through the real reducer, so a loaded world obeys exactly
 * the same rules as a world built by live edits. Any failure returns an error
 * and produces no world at all (atomic).
 *
 * No DOM, no storage, no network.
 */
import { canonical, fingerprint, worldFingerprint } from '../core/fingerprint';
import { applyEvent, createEmptyWorld, EMISSIVE_MAX, NAME_MAX_LENGTH } from '../core/reducer';
import { asEntityId, type Entity, type EntityDraft, type EntityId, type EventSource, type World } from '../core/types';
import { ARCHETYPES } from '../director/schema';

export const SAVE_FORMAT = 'worldweaver.world';
/** Current save-file version. Bump only with a migration in MIGRATIONS. */
export const SAVE_VERSION = 1;

export const SAVE_LIMITS = Object.freeze({
  /** UTF-8 bytes of the file text. */
  maxBytes: 2 * 1024 * 1024,
  maxEntities: 1000,
  maxDepth: 32,
  maxIdLength: 128,
  maxKindLength: 40,
  maxTags: 16,
  maxTagLength: 40,
  maxWorldTextLength: 120,
});

export type LoadErrorCode = 'TOO_LARGE' | 'NOT_JSON' | 'NOT_A_SAVE' | 'UNSUPPORTED_VERSION' | 'INVALID' | 'CHECKSUM' | 'UNSAFE';

export interface LoadIssue {
  readonly path: string;
  readonly message: string;
}

export type LoadResult =
  | { readonly ok: true; readonly world: World; readonly version: number; readonly savedAt: string | null; readonly migratedFrom: number | null; readonly checksum: string }
  | { readonly ok: false; readonly code: LoadErrorCode; readonly message: string; readonly issues: readonly LoadIssue[] };

/** The file envelope (version 1). */
export interface SaveFileV1 {
  readonly format: typeof SAVE_FORMAT;
  readonly version: 1;
  /** Informational only; not part of the checksum. ISO 8601 or null. */
  readonly savedAt: string | null;
  /** Fingerprint of the canonical world (non-cryptographic integrity check). */
  readonly checksum: string;
  readonly world: World;
}

export type SaveErrorCode = 'INVALID_WORLD' | 'TOO_LARGE' | 'UNSAFE';

export type SerializeResult = { readonly ok: true; readonly text: string; readonly checksum: string; readonly bytes: number } | { readonly ok: false; readonly code: SaveErrorCode; readonly message: string };

/** Strings that look like a Google API key are never written to a save file. */
const API_KEY_LIKE = /AIza[0-9A-Za-z_-]{30,}/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9:._-]+$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SOURCES: ReadonlySet<string> = new Set<EventSource>(['system', 'user', 'director']);
const KNOWN_ARCHETYPES: ReadonlySet<string> = new Set(ARCHETYPES);

export function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

// ---------------------------------------------------------------- serialise

/** Deterministic: the same world and `savedAt` always give byte-identical text. */
export function serializeWorld(world: World, options: { savedAt?: string | null } = {}): SerializeResult {
  const check = validateWorldObject(world, 'world');
  if (check.length > 0) return { ok: false, code: 'INVALID_WORLD', message: `The world cannot be saved: ${check[0]!.path}: ${check[0]!.message}` };
  const body = canonical(world);
  if (API_KEY_LIKE.test(body)) return { ok: false, code: 'UNSAFE', message: 'The world contains text that looks like an API key, so it was not saved.' };
  const checksum = fingerprint(body);
  const savedAt = options.savedAt ?? null;
  const text = `{"format":${JSON.stringify(SAVE_FORMAT)},"version":${SAVE_VERSION},"savedAt":${savedAt === null ? 'null' : JSON.stringify(savedAt)},"checksum":${JSON.stringify(checksum)},"world":${body}}`;
  const bytes = utf8Bytes(text);
  if (bytes > SAVE_LIMITS.maxBytes) return { ok: false, code: 'TOO_LARGE', message: `The save would be ${bytes} bytes; the limit is ${SAVE_LIMITS.maxBytes}.` };
  return { ok: true, text, checksum, bytes };
}

/** Checksum of a world as stored in its save file. */
export function worldChecksum(world: World): string {
  return fingerprint(canonical(world));
}

// ---------------------------------------------------------------- parse

/** Version migrations: MIGRATIONS[n] turns a version-n envelope into version n+1. None needed yet. */
const MIGRATIONS: Readonly<Record<number, (envelope: Record<string, unknown>) => Record<string, unknown>>> = {};

const fail = (code: LoadErrorCode, message: string, issues: LoadIssue[] = []): LoadResult => ({ ok: false, code, message, issues });

/**
 * Parses and validates save-file text. Never throws. On success the world is
 * a fresh object graph rebuilt through the reducer; on failure nothing is
 * returned that could be applied.
 */
export function parseSaveFile(text: unknown): LoadResult {
  if (typeof text !== 'string') return fail('NOT_A_SAVE', 'The file is not text.');
  if (text.length > SAVE_LIMITS.maxBytes || utf8Bytes(text) > SAVE_LIMITS.maxBytes) return fail('TOO_LARGE', `The file is larger than ${SAVE_LIMITS.maxBytes / (1024 * 1024)} MB.`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('NOT_JSON', 'The file is not valid JSON.');
  }
  const unsafe = findUnsafe(raw, '', 0);
  if (unsafe) return fail('UNSAFE', unsafe.message, [unsafe]);
  if (!isObj(raw) || raw.format !== SAVE_FORMAT) return fail('NOT_A_SAVE', 'This is not a WORLDWEAVER world file.');
  let envelope: Record<string, unknown> = raw;
  const version = envelope.version;
  if (!Number.isInteger(version) || (version as number) < 1) return fail('NOT_A_SAVE', 'The file has no valid version number.');
  if ((version as number) > SAVE_VERSION) return fail('UNSUPPORTED_VERSION', `This file was saved by a newer WORLDWEAVER (format version ${String(version)}). This version reads up to ${SAVE_VERSION}.`);
  let migratedFrom: number | null = null;
  for (let v = version as number; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return fail('UNSUPPORTED_VERSION', `No migration from format version ${v}.`);
    envelope = step(envelope);
    migratedFrom ??= version as number;
  }

  const issues: LoadIssue[] = [];
  onlyKeys(envelope, ['format', 'version', 'savedAt', 'checksum', 'world'], '', issues);
  const savedAt = envelope.savedAt;
  if (savedAt !== null && savedAt !== undefined && (typeof savedAt !== 'string' || savedAt.length > 40 || CONTROL.test(savedAt))) issues.push({ path: 'savedAt', message: 'Must be a short date string or null.' });
  if (typeof envelope.checksum !== 'string' || !/^[0-9a-f]{16}$/.test(envelope.checksum)) issues.push({ path: 'checksum', message: 'Missing or malformed checksum.' });
  issues.push(...validateWorldObject(envelope.world, 'world'));
  if (issues.length > 0) return fail('INVALID', `The world file is invalid: ${issues[0]!.path ? `${issues[0]!.path}: ` : ''}${issues[0]!.message}`, issues.slice(0, 20));

  const world = rebuild(envelope.world as Record<string, unknown>);
  if (!world.ok) return fail('INVALID', `The world file is invalid: ${world.issue.path}: ${world.issue.message}`, [world.issue]);
  const checksum = worldChecksum(world.world);
  if (checksum !== envelope.checksum) return fail('CHECKSUM', 'The world file is damaged: its checksum does not match its content.');
  return { ok: true, world: world.world, version: SAVE_VERSION, savedAt: typeof savedAt === 'string' ? savedAt : null, migratedFrom, checksum };
}

// ---------------------------------------------------------------- structural checks

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function findUnsafe(v: unknown, path: string, depth: number): LoadIssue | null {
  if (depth > SAVE_LIMITS.maxDepth) return { path, message: 'The file is nested too deeply.' };
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findUnsafe(v[i], `${path}[${i}]`, depth + 1);
      if (r) return r;
    }
  } else if (isObj(v)) {
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) return { path: path ? `${path}.${k}` : k, message: 'The file contains a forbidden key.' };
      const r = findUnsafe(v[k], path ? `${path}.${k}` : k, depth + 1);
      if (r) return r;
    }
  } else if (typeof v === 'string' && API_KEY_LIKE.test(v)) {
    return { path, message: 'The file contains text that looks like an API key and was refused.' };
  }
  return null;
}

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], path: string, issues: LoadIssue[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) issues.push({ path: path ? `${path}.${k}` : k, message: 'Unknown field.' });
}

function text(v: unknown, path: string, max: number, issues: LoadIssue[], opts: { allowEmpty?: boolean } = {}): v is string {
  if (typeof v !== 'string') return void issues.push({ path, message: 'Must be text.' }), false;
  if (CONTROL.test(v)) return void issues.push({ path, message: 'Contains control or bidirectional-override characters.' }), false;
  if ((!opts.allowEmpty && v.trim().length === 0) || v.length > max) return void issues.push({ path, message: `Must be ${opts.allowEmpty ? '0' : '1'} to ${max} characters.` }), false;
  return true;
}

function vec(v: unknown, path: string, issues: LoadIssue[], positive = false): void {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) issues.push({ path, message: 'Must be three finite numbers.' });
  else if (positive && v.some((n) => (n as number) <= 0)) issues.push({ path, message: 'Must be positive.' });
}

function seqInt(v: unknown, path: string, max: number, issues: LoadIssue[]): void {
  if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > max) issues.push({ path, message: `Must be a whole number from 0 to ${max}.` });
}

/** Field-by-field check of a world-shaped value. Returns all issues (empty = structurally valid). */
export function validateWorldObject(value: unknown, path: string): LoadIssue[] {
  const issues: LoadIssue[] = [];
  if (!isObj(value)) return [{ path, message: 'Must be an object.' }];
  const w = value;
  onlyKeys(w, ['schemaVersion', 'id', 'name', 'biome', 'seed', 'seq', 'entities', 'order'], path, issues);
  if (w.schemaVersion !== 1) issues.push({ path: `${path}.schemaVersion`, message: 'Unsupported world schema version.' });
  text(w.id, `${path}.id`, SAVE_LIMITS.maxIdLength, issues);
  text(w.name, `${path}.name`, SAVE_LIMITS.maxWorldTextLength, issues);
  text(w.biome, `${path}.biome`, SAVE_LIMITS.maxWorldTextLength, issues);
  if (!Number.isInteger(w.seed) || (w.seed as number) < 0 || (w.seed as number) > 0xffffffff) issues.push({ path: `${path}.seed`, message: 'Must be a 32-bit unsigned integer.' });
  seqInt(w.seq, `${path}.seq`, Number.MAX_SAFE_INTEGER, issues);
  const seq = Number.isSafeInteger(w.seq) ? (w.seq as number) : 0;
  if (!isObj(w.entities)) issues.push({ path: `${path}.entities`, message: 'Must be an object.' });
  if (!Array.isArray(w.order)) issues.push({ path: `${path}.order`, message: 'Must be a list.' });
  if (issues.length > 0 || !isObj(w.entities) || !Array.isArray(w.order)) return issues;

  const entities = w.entities;
  const order = w.order as unknown[];
  const keys = Object.keys(entities);
  if (order.length > SAVE_LIMITS.maxEntities || keys.length > SAVE_LIMITS.maxEntities) return [...issues, { path: `${path}.order`, message: `A world may hold at most ${SAVE_LIMITS.maxEntities} entities.` }];
  const seen = new Set<string>();
  order.forEach((id, i) => {
    const p = `${path}.order[${i}]`;
    if (typeof id !== 'string') return issues.push({ path: p, message: 'Must be an entity ID.' });
    if (seen.has(id)) return issues.push({ path: p, message: `Duplicate entity ID "${id}".` });
    seen.add(id);
    if (!Object.prototype.hasOwnProperty.call(entities, id)) issues.push({ path: p, message: `No entity with ID "${id}".` });
    return undefined;
  });
  for (const k of keys) if (!seen.has(k)) issues.push({ path: `${path}.entities.${k}`, message: 'Entity is missing from the order list.' });

  const position = new Map<string, number>();
  order.forEach((id, i) => typeof id === 'string' && position.set(id, i));
  for (const k of keys) issues.push(...validateEntity(entities[k], k, `${path}.entities.${k}`, entities, position, seq));
  return issues;
}

function validateEntity(value: unknown, key: string, path: string, entities: Record<string, unknown>, position: ReadonlyMap<string, number>, seq: number): LoadIssue[] {
  const issues: LoadIssue[] = [];
  if (!isObj(value)) return [{ path, message: 'Must be an object.' }];
  const e = value;
  onlyKeys(e, ['id', 'name', 'kind', 'parentId', 'tags', 'pinned', 'components', 'provenance'], path, issues);
  if (e.id !== key) issues.push({ path: `${path}.id`, message: 'Must equal the entity key.' });
  else if (key.length === 0 || key.length > SAVE_LIMITS.maxIdLength || !ID.test(key)) issues.push({ path: `${path}.id`, message: 'IDs may contain letters, digits, ":", ".", "_" and "-" only.' });
  if (text(e.name, `${path}.name`, NAME_MAX_LENGTH, issues) && e.name !== e.name.trim()) issues.push({ path: `${path}.name`, message: 'Must not start or end with spaces.' });
  text(e.kind, `${path}.kind`, SAVE_LIMITS.maxKindLength, issues);
  if (e.parentId !== null) {
    if (typeof e.parentId !== 'string' || !Object.prototype.hasOwnProperty.call(entities, e.parentId)) issues.push({ path: `${path}.parentId`, message: 'Parent entity not found.' });
    else if (e.parentId === key) issues.push({ path: `${path}.parentId`, message: 'An entity cannot be its own parent.' });
    else if ((position.get(e.parentId) ?? Infinity) >= (position.get(key) ?? -1)) issues.push({ path: `${path}.parentId`, message: 'A parent must come before its children in the order list.' });
  }
  if (!Array.isArray(e.tags) || e.tags.length > SAVE_LIMITS.maxTags) issues.push({ path: `${path}.tags`, message: `Must be a list of at most ${SAVE_LIMITS.maxTags} tags.` });
  else e.tags.forEach((t, i) => text(t, `${path}.tags[${i}]`, SAVE_LIMITS.maxTagLength, issues));
  if (typeof e.pinned !== 'boolean') issues.push({ path: `${path}.pinned`, message: 'Must be true or false.' });

  const c = e.components;
  if (!isObj(c)) issues.push({ path: `${path}.components`, message: 'Must be an object.' });
  else {
    onlyKeys(c, ['transform', 'visual', 'light'], `${path}.components`, issues);
    const t = c.transform;
    if (!isObj(t)) issues.push({ path: `${path}.components.transform`, message: 'Must be an object.' });
    else {
      onlyKeys(t, ['position', 'rotation', 'scale'], `${path}.components.transform`, issues);
      vec(t.position, `${path}.components.transform.position`, issues);
      vec(t.rotation, `${path}.components.transform.rotation`, issues);
      vec(t.scale, `${path}.components.transform.scale`, issues, true);
    }
    if (c.visual !== undefined) {
      const v = c.visual;
      const vp = `${path}.components.visual`;
      if (!isObj(v)) issues.push({ path: vp, message: 'Must be an object.' });
      else {
        onlyKeys(v, ['archetype', 'color', 'emissive', 'emissiveIntensity', 'visible'], vp, issues);
        if (typeof v.archetype !== 'string' || !KNOWN_ARCHETYPES.has(v.archetype)) issues.push({ path: `${vp}.archetype`, message: 'Unknown archetype.' });
        if (typeof v.color !== 'string' || !HEX.test(v.color)) issues.push({ path: `${vp}.color`, message: 'Must be a #rrggbb colour.' });
        if (typeof v.emissive !== 'string' || !HEX.test(v.emissive)) issues.push({ path: `${vp}.emissive`, message: 'Must be a #rrggbb colour.' });
        if (typeof v.emissiveIntensity !== 'number' || !Number.isFinite(v.emissiveIntensity) || v.emissiveIntensity < 0 || v.emissiveIntensity > EMISSIVE_MAX) issues.push({ path: `${vp}.emissiveIntensity`, message: `Must be 0 to ${EMISSIVE_MAX}.` });
        if (typeof v.visible !== 'boolean') issues.push({ path: `${vp}.visible`, message: 'Must be true or false.' });
      }
    }
    if (c.light !== undefined) {
      const l = c.light;
      const lp = `${path}.components.light`;
      if (!isObj(l)) issues.push({ path: lp, message: 'Must be an object.' });
      else {
        onlyKeys(l, ['color', 'intensity', 'range'], lp, issues);
        if (typeof l.color !== 'string' || !HEX.test(l.color)) issues.push({ path: `${lp}.color`, message: 'Must be a #rrggbb colour.' });
        if (typeof l.intensity !== 'number' || !Number.isFinite(l.intensity) || l.intensity < 0 || l.intensity > 1000) issues.push({ path: `${lp}.intensity`, message: 'Must be 0 to 1000.' });
        if (typeof l.range !== 'number' || !Number.isFinite(l.range) || l.range <= 0 || l.range > 100000) issues.push({ path: `${lp}.range`, message: 'Must be greater than 0.' });
      }
    }
  }

  const p = e.provenance;
  const pp = `${path}.provenance`;
  if (!isObj(p)) issues.push({ path: pp, message: 'Must be an object.' });
  else {
    onlyKeys(p, ['createdBy', 'createdAtSeq', 'lastModifiedBy', 'lastModifiedSeq'], pp, issues);
    if (typeof p.createdBy !== 'string' || !SOURCES.has(p.createdBy)) issues.push({ path: `${pp}.createdBy`, message: 'Unknown source.' });
    if (typeof p.lastModifiedBy !== 'string' || !SOURCES.has(p.lastModifiedBy)) issues.push({ path: `${pp}.lastModifiedBy`, message: 'Unknown source.' });
    seqInt(p.createdAtSeq, `${pp}.createdAtSeq`, seq, issues);
    seqInt(p.lastModifiedSeq, `${pp}.lastModifiedSeq`, seq, issues);
    if (Number.isSafeInteger(p.createdAtSeq) && Number.isSafeInteger(p.lastModifiedSeq) && (p.lastModifiedSeq as number) < (p.createdAtSeq as number)) issues.push({ path: `${pp}.lastModifiedSeq`, message: 'Cannot be earlier than createdAtSeq.' });
  }
  return issues;
}

// ---------------------------------------------------------------- rebuild through the reducer

type Vec = [number, number, number];
const v3 = (v: unknown): Vec => [...(v as number[])] as Vec;

/**
 * Rebuilds a structurally valid world by applying one `entity/added` event per
 * entity, in order, through the real reducer (same validation as live edits),
 * then restores the saved provenance and seq. Returns fresh objects only.
 */
function rebuild(w: Record<string, unknown>): { ok: true; world: World } | { ok: false; issue: LoadIssue } {
  let world = createEmptyWorld({ id: w.id as string, name: w.name as string, biome: w.biome as string, seed: w.seed as number });
  const entities = w.entities as Record<string, Record<string, unknown>>;
  for (const id of w.order as string[]) {
    const e = entities[id]!;
    const c = e.components as Record<string, Record<string, unknown> | undefined>;
    const t = c.transform!;
    const draft: EntityDraft = {
      id: asEntityId(id),
      name: e.name as string,
      kind: e.kind as string,
      parentId: e.parentId === null ? null : asEntityId(e.parentId as string),
      tags: [...(e.tags as string[])],
      pinned: e.pinned as boolean,
      components: {
        transform: { position: v3(t.position), rotation: v3(t.rotation), scale: v3(t.scale) },
        ...(c.visual ? { visual: { archetype: c.visual.archetype as string, color: c.visual.color as `#${string}`, emissive: c.visual.emissive as `#${string}`, emissiveIntensity: c.visual.emissiveIntensity as number, visible: c.visual.visible as boolean } } : {}),
        ...(c.light ? { light: { color: c.light.color as `#${string}`, intensity: c.light.intensity as number, range: c.light.range as number } } : {}),
      },
    };
    const r = applyEvent(world, { type: 'entity/added', entity: draft, source: 'system' });
    if (!r.ok) return { ok: false, issue: { path: `world.entities.${id}`, message: r.reason } };
    world = r.world;
  }
  const restored: Record<string, Entity> = {};
  for (const id of world.order) {
    const p = entities[id]!.provenance as Record<string, unknown>;
    restored[id] = {
      ...world.entities[id]!,
      provenance: { createdBy: p.createdBy as EventSource, createdAtSeq: p.createdAtSeq as number, lastModifiedBy: p.lastModifiedBy as EventSource, lastModifiedSeq: p.lastModifiedSeq as number },
    };
  }
  return { ok: true, world: { ...world, seq: w.seq as number, entities: restored, order: [...world.order] as EntityId[] } };
}

/** True if two worlds have identical content and seq (helper for UIs and tests). */
export function sameWorld(a: World, b: World): boolean {
  return a.seq === b.seq && worldFingerprint(a) === worldFingerprint(b);
}
