import { describe, expect, it } from 'vitest';
import { canonical } from '../core/fingerprint';
import { WorldStore } from '../core/store';
import type { World } from '../core/types';
import { buildCrystalKingdom } from '../worlds/crystalKingdom';
import { browserStorage, LocalSaveSlots, SAVE_KEYS, type StorageLike } from './localSave';
import { serializeWorld } from './saveFile';

/** In-memory storage with optional faults. */
class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  quotaOn: Set<string> = new Set();
  corruptOn: Set<string> = new Set();
  throwOnRead = false;
  writes: string[] = [];
  getItem(k: string) {
    if (this.throwOnRead) throw new Error('blocked');
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.quotaOn.has(k)) {
      const e = new Error('full');
      (e as Error & { name: string }).name = 'QuotaExceededError';
      throw e;
    }
    this.writes.push(k);
    this.map.set(k, this.corruptOn.has(k) ? v.slice(0, v.length - 10) : v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

function edit(world: World, name: string): World {
  const store = new WorldStore(world);
  const r = store.dispatch({ type: 'entity/renamed', id: world.order[4]!, name, source: 'user' });
  if (!r.ok) throw new Error(r.reason);
  return store.getState();
}

describe('local save slots', () => {
  it('saves and restores after a simulated reload (new slots object over the same storage)', () => {
    const storage = new FakeStorage();
    const w = edit(buildCrystalKingdom(), 'Saved Spire');
    expect(new LocalSaveSlots(storage).save(w, '2026-11-20T10:00:00Z')).toMatchObject({ ok: true, backedUp: false });
    const after = new LocalSaveSlots(storage).load();
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(canonical(after.world)).toBe(canonical(w));
      expect(after).toMatchObject({ slot: 'current', savedAt: '2026-11-20T10:00:00Z', currentProblem: null });
    }
    expect(storage.map.has(SAVE_KEYS.pending)).toBe(false);
  });

  it('keeps the previous good save as the backup', () => {
    const storage = new FakeStorage();
    const slots = new LocalSaveSlots(storage);
    const a = edit(buildCrystalKingdom(), 'First');
    const b = edit(buildCrystalKingdom(), 'Second');
    slots.save(a, 't1');
    expect(slots.save(b, 't2')).toMatchObject({ ok: true, backedUp: true });
    expect(slots.info('current')).toMatchObject({ present: true, valid: true, savedAt: 't2' });
    expect(slots.info('backup')).toMatchObject({ present: true, valid: true, savedAt: 't1' });
    // Saving identical text again does not overwrite the backup with itself.
    expect(slots.save(b, 't2')).toMatchObject({ ok: true, backedUp: false });
    expect(slots.info('backup').savedAt).toBe('t1');
  });

  it('recovers from a damaged current save using the backup, without deleting anything', () => {
    const storage = new FakeStorage();
    const slots = new LocalSaveSlots(storage);
    const a = edit(buildCrystalKingdom(), 'Good One');
    slots.save(a, 't1');
    slots.save(edit(buildCrystalKingdom(), 'Good Two'), 't2');
    storage.map.set(SAVE_KEYS.current, storage.map.get(SAVE_KEYS.current)!.replace('Good Two', 'Bad Two!'));
    const r = slots.load();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.slot).toBe('backup');
      expect(r.currentProblem).toMatch(/checksum/);
      expect(canonical(r.world)).toBe(canonical(a));
    }
    expect(storage.map.has(SAVE_KEYS.current)).toBe(true);
    expect(slots.rawText('current')).toContain('Bad Two!');
  });

  it('reports both slots damaged, or empty storage, without inventing a world', () => {
    const storage = new FakeStorage();
    const slots = new LocalSaveSlots(storage);
    expect(slots.load()).toMatchObject({ ok: false, code: 'EMPTY' });
    storage.map.set(SAVE_KEYS.current, '{not json');
    expect(slots.load()).toMatchObject({ ok: false, code: 'DAMAGED' });
    storage.map.set(SAVE_KEYS.backup, '{"format":"worldweaver.world","version":9}');
    const r = slots.load();
    expect(r).toMatchObject({ ok: false, code: 'DAMAGED' });
    if (!r.ok) expect(r.message).toMatch(/Both local saves are damaged/);
  });

  it('a full storage leaves the previous save intact, at every write step', () => {
    for (const failing of [SAVE_KEYS.pending, SAVE_KEYS.backup, SAVE_KEYS.current]) {
      const storage = new FakeStorage();
      const slots = new LocalSaveSlots(storage);
      const first = edit(buildCrystalKingdom(), 'Kept');
      slots.save(first, 't1');
      storage.quotaOn.add(failing);
      const r = slots.save(edit(buildCrystalKingdom(), 'Lost'), 't2');
      expect(r, failing).toMatchObject({ ok: false, code: 'QUOTA' });
      if (!r.ok) expect(r.message).toMatch(/previous save is unchanged/);
      const back = slots.load();
      expect(back.ok && back.slot === 'current' && canonical(back.world) === canonical(first), failing).toBe(true);
      expect(storage.map.has(SAVE_KEYS.pending)).toBe(false);
    }
  });

  it('a write that does not read back correctly is detected and the old save kept', () => {
    const storage = new FakeStorage();
    const slots = new LocalSaveSlots(storage);
    const first = edit(buildCrystalKingdom(), 'Original');
    slots.save(first, 't1');
    storage.corruptOn.add(SAVE_KEYS.pending);
    expect(slots.save(edit(buildCrystalKingdom(), 'Garbled'), 't2')).toMatchObject({ ok: false, code: 'VERIFY_FAILED' });
    storage.corruptOn = new Set([SAVE_KEYS.current]);
    expect(slots.save(edit(buildCrystalKingdom(), 'Garbled'), 't3')).toMatchObject({ ok: false, code: 'VERIFY_FAILED' });
    storage.corruptOn = new Set();
    const back = slots.load();
    expect(back.ok && canonical(back.world) === canonical(first)).toBe(true);
  });

  it('unavailable storage: save and load fail clearly; Node has no localStorage', () => {
    const slots = new LocalSaveSlots(null);
    expect(slots.available).toBe(false);
    expect(slots.save(buildCrystalKingdom(), null)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(slots.load()).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(browserStorage()).toBeNull();
    const blocked = new FakeStorage();
    blocked.throwOnRead = true;
    expect(new LocalSaveSlots(blocked).info('current')).toMatchObject({ present: false, problem: 'Storage unavailable.' });
  });

  it('stores nothing but save-file text under its own keys; clear removes them', () => {
    const storage = new FakeStorage();
    const slots = new LocalSaveSlots(storage);
    slots.save(buildCrystalKingdom(), 't1');
    slots.save(edit(buildCrystalKingdom(), 'Two'), 't2');
    expect([...storage.map.keys()].sort()).toEqual([SAVE_KEYS.backup, SAVE_KEYS.current].sort());
    for (const v of storage.map.values()) expect(v.startsWith('{"format":"worldweaver.world"')).toBe(true);
    expect(slots.clear()).toBe(true);
    expect(storage.map.size).toBe(0);
  });

  it('refuses to save an invalid world', () => {
    const slots = new LocalSaveSlots(new FakeStorage());
    const bad = { ...buildCrystalKingdom(), seq: -1 } as World;
    expect(slots.save(bad, null)).toMatchObject({ ok: false, code: 'INVALID_WORLD' });
    expect(serializeWorld(bad).ok).toBe(false);
  });
});
