/**
 * Deterministic content fingerprints for worlds, entities and records.
 *
 * - `canonical(value)`: JSON with sorted object keys, so key order never
 *   changes a fingerprint. Non-finite numbers are encoded explicitly.
 * - `fingerprint(text)`: 64-bit hash (two independent 32-bit lanes) as
 *   16 hex characters. It detects accidental corruption and naive edits; it
 *   is NOT cryptographic and must not be presented as tamper-proof against a
 *   determined attacker (a SHA-256 chain is the planned production upgrade,
 *   docs/architecture/CAUSAL_LEDGER.md).
 * - `entityFingerprint` is cached per entity object. The reducer shares
 *   unchanged entity objects between states, so a world fingerprint only
 *   rehashes entities that actually changed.
 *
 * No three.js, no DOM, no I/O.
 */
import type { Entity, World } from './types';

export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : `"#${String(value)}"`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 64-bit non-cryptographic hash (cyrb-style two-lane mix) as 16 hex chars. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const entityCache = new WeakMap<Entity, string>();

export function entityFingerprint(entity: Entity): string {
  let fp = entityCache.get(entity);
  if (fp === undefined) {
    fp = fingerprint(canonical(entity));
    entityCache.set(entity, fp);
  }
  return fp;
}

/**
 * Fingerprint of a world's CONTENT: metadata, entity order and every entity
 * (including provenance). `seq` is deliberately excluded, so an undo that
 * restores an earlier state yields that state's fingerprint again.
 */
export function worldFingerprint(world: World): string {
  const parts: string[] = [canonical([world.schemaVersion, world.id, world.name, world.biome, world.seed])];
  for (const id of world.order) {
    const e = world.entities[id];
    parts.push(`${id}=${e ? entityFingerprint(e) : 'missing'}`);
  }
  return fingerprint(parts.join('\n'));
}

/** A reference to one world state: its seq and its content fingerprint. */
export interface StateRef {
  readonly seq: number;
  readonly fingerprint: string;
}

export function stateRef(world: World): StateRef {
  return { seq: world.seq, fingerprint: worldFingerprint(world) };
}
