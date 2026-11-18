import { asEntityId, type EntityId } from './types';

/**
 * Deterministic pseudo-random generator (mulberry32).
 * Same seed => same sequence on every platform. Not cryptographic.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() on empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}

/** FNV-1a 32-bit hash. Used to derive stable per-entity seeds from IDs. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic ID factory. IDs depend only on the namespace and call order,
 * so regenerating a world from the same seed yields identical IDs.
 */
export function createIdFactory(namespace: string): (slug: string) => EntityId {
  let counter = 0;
  const used = new Set<string>();
  return (slug: string) => {
    counter += 1;
    const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entity';
    const id = `${namespace}:${clean}-${counter.toString(36).padStart(3, '0')}`;
    if (used.has(id)) throw new Error(`Duplicate entity id generated: ${id}`);
    used.add(id);
    return asEntityId(id);
  };
}
